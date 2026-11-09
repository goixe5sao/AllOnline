import { effectivePlan, PLAN_KINDS } from "@/core/ai-plan";
import { getUser, type AppUser } from "../services/users";
import { alertKey, alertMessage, alertsSchema, fixtureAlerts, vnSession, type AlertFeed, type StockAlert } from "@/core/stock-alerts";
import type { Db } from "../db";
import type { BotSender } from "../zalo/transport";
import { inVnSession } from "../market/service";

export interface AlertsProvider { fixture: boolean; load(since: string): Promise<ReturnType<typeof alertsSchema.parse>> }
export class FixtureAlertsProvider implements AlertsProvider {
  fixture = true;
  async load() { return fixtureAlerts(); }
}
export class StockVnAlertsProvider implements AlertsProvider {
  fixture = false;
  constructor(private url: string, private token: string) {}
  async load(since: string) {
    const url = new URL("/api/ai/alerts", this.url); url.searchParams.set("since", since);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("StockVN alerts unavailable");
    return alertsSchema.parse(await response.json());
  }
}
/** No published Bot proactive window was found. Unknown policy must never imply permission. */
export function zaloAlertEligibility(lastInbound: number | null, now: number, verifiedWindowSeconds?: number) {
  if (!verifiedWindowSeconds || !Number.isFinite(verifiedWindowSeconds) || verifiedWindowSeconds <= 0) return "policy_unknown";
  if (lastInbound === null || lastInbound > now || now - lastInbound >= verifiedWindowSeconds * 1000) return "window_closed";
  return null;
}
export class StockAlerts {
  private busy = false;
  private timer?: ReturnType<typeof setInterval>;
  private asOf: string | null = null;
  private error?: string;
  constructor(private db: Db, readonly provider: AlertsProvider, private sender: BotSender,
    private options: { dailyCap?: number; verifiedWindowSeconds?: number; log?: (message: string) => void } = {}) {}
  start() { if (this.timer) return; void this.tick(); this.timer = setInterval(() => void this.tick(), 60_000); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  async tick(now = Date.now()) {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.provider.fixture || inVnSession(now)) {
        // Overlap covers equal timestamps and a previous interrupted poll; the ledger dedupes.
        const latest = await this.db.query<{ since: string | null }>("select max(alert->>'createdAt') as since from app.stock_alerts where fixture=$1", [this.provider.fixture]);
        const since = new Date(new Date(latest.rows[0]?.since ?? now - 86400_000).getTime() - 60_000).toISOString();
        const result = alertsSchema.parse(await this.provider.load(since));
        for (const alert of result.alerts) {
          if (Date.parse(alert.createdAt) > now) continue;
          await this.ingest(alert);
        }
        this.asOf = result.asOf; this.error = undefined;
      }
      await this.deliver(now);
    } catch { this.error = "Không cập nhật được cảnh báo; dữ liệu có thể đã cũ."; this.log("poll_or_queue_failed"); }
    finally { this.busy = false; }
  }
  private log(reason: string) { (this.options.log ?? console.info)(`[stock-alerts] ${reason}`); }
  async ingest(alert: StockAlert) {
    const a = alertsSchema.parse({ asOf: alert.createdAt, alerts: [alert] }).alerts[0];
    const key = `${this.provider.fixture ? "fixture" : "stockvn"}:${alertKey(a)}`;
    await this.db.tx(async q => {
      const inserted = await q.query("insert into app.stock_alerts(dedupe_key,session_day,fixture,alert) values($1,$2,$3,$4) on conflict do nothing returning dedupe_key", [key, vnSession(a.createdAt), this.provider.fixture, a]);
      if (!inserted.rows.length) return;
      const followers = await q.query<AppUser>("select u.* from app.stock_follows f join app.users u on u.id=f.user_id where f.symbol=$1", [a.symbol]);
      for (const u of followers.rows) if (PLAN_KINDS[effectivePlan(u)].includes(a.kind)) await q.query("insert into app.stock_alert_deliveries(alert_key,user_id,day) values($1,$2,$3) on conflict do nothing", [key,u.id,vnSession(a.createdAt)]);
    });
  }
  async feed(user: AppUser): Promise<AlertFeed> {
    const plan = effectivePlan(user);
    const rows = await this.db.query<{ alert: StockAlert }>("select alert from app.stock_alerts a where fixture=$1 and alert->>'kind'=any($2::text[]) and ($3::boolean or exists(select 1 from app.stock_follows f where f.user_id=$4 and f.symbol=a.alert->>'symbol')) order by alert->>'createdAt' desc, dedupe_key limit 100", [this.provider.fixture,PLAN_KINDS[plan],plan !== "basic",user?.id ?? null]);
    return { alerts: rows.rows.map(r => r.alert), fixture: this.provider.fixture, asOf: this.asOf, error: this.error };
  }

  async follows(userId: string) {
    return (await this.db.query<{ symbol: string }>("select symbol from app.stock_follows where user_id=$1 order by symbol", [userId])).rows.map(r => r.symbol);
  }
  async follow(userId: string, symbol: string, on: boolean) {
    if (on) await this.db.query("insert into app.stock_follows(user_id,symbol) values($1,$2) on conflict do nothing", [userId,symbol]);
    else await this.db.query("delete from app.stock_follows where user_id=$1 and symbol=$2", [userId,symbol]);
  }
  async deliver(now = Date.now()) {
    const jobs = await this.db.query<{ alert_key: string; user_id: string; alert: StockAlert; fixture: boolean }>("select d.alert_key,d.user_id,a.alert,a.fixture from app.stock_alert_deliveries d join app.stock_alerts a on a.dedupe_key=d.alert_key where d.status='queued' and a.fixture=$1 order by a.created_at limit 100", [this.provider.fixture]);
    for (const job of jobs.rows) {
      const claim = await this.db.tx(async q => {
        // Lock the account to serialize daily-cap reservations across jobs/processes.
        await q.query("select id from app.users where id=$1 for update", [job.user_id]);
        const pending = await q.query("select 1 from app.stock_alert_deliveries where alert_key=$1 and user_id=$2 and status='queued' for update", [job.alert_key,job.user_id]);
        if (!pending.rows.length) return null;
        const links = await q.query<{ chat_id: string; last_inbound_at: Date }>("select c.chat_id,c.last_inbound_at from app.user_identities i join app.stock_zalo_contacts c on c.provider_uid=i.provider_uid where i.provider='zalo_oa' and i.user_id=$1 order by c.last_inbound_at desc limit 1", [job.user_id]);
        const link = links.rows[0];
        const following = await q.query("select 1 from app.stock_follows where user_id=$1 and symbol=$2", [job.user_id, job.alert.symbol]);
        const allowed = PLAN_KINDS[effectivePlan(await getUser(q, job.user_id), now)].includes(job.alert.kind);
        let reason = !allowed ? "plan" : !following.rows.length ? "unfollowed" : vnSession(job.alert.createdAt) !== vnSession(now) ? "stale_session" : !link ? "no_linked_chat" : zaloAlertEligibility(new Date(link.last_inbound_at).getTime(), now, this.options.verifiedWindowSeconds);
        const count = await q.query<{ n: number }>("select count(*)::int as n from app.stock_alert_deliveries where user_id=$1 and day=$2 and status in ('sending','sent','failed')", [job.user_id,vnSession(now)]);
        if (!reason && count.rows[0].n >= (this.options.dailyCap ?? 5)) reason = "daily_cap";
        await q.query("update app.stock_alert_deliveries set status=$3,reason=$4,day=$5 where alert_key=$1 and user_id=$2", [job.alert_key,job.user_id,reason ? "skipped" : "sending",reason,vnSession(now)]);
        return reason ? { reason } : { chatId: link.chat_id };
      });
      if (!claim) continue;
      if (claim.reason) { this.log(claim.reason); continue; }
      // At-most-once attempt: never retry ambiguous transport failures or interrupted sends.
      let sent = false;
      try { sent = await this.sender.sendText(claim.chatId!, alertMessage(job.alert, job.fixture)); } catch { /* redacted below */ }
      await this.db.query("update app.stock_alert_deliveries set status=$3,reason=$4 where alert_key=$1 and user_id=$2", [job.alert_key,job.user_id,sent ? "sent" : "failed",sent ? null : "transport_failed"]);
      if (!sent) this.log("transport_failed");
    }
  }
}
