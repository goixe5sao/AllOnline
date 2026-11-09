import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate, openPglite, type Db } from "../server/db";
import { StockAlerts, FixtureAlertsProvider, StockVnAlertsProvider, zaloAlertEligibility } from "../server/ai-stock/alerts";
import { alertCopy, alertKey, alertMessage, alertSchema, fixtureAlerts, type StockAlert } from "../src/core/stock-alerts";
import { CaptureSender } from "../server/zalo/transport";
const VIP = { id: "00000000-0000-0000-0000-000000000000", email: null, display_name: "Owner", role: "app_owner", is_demo: false, is_guest: false } as const;

let db: Db, uid: string, sender: CaptureSender;
const now = Date.parse("2026-11-09T08:00:00Z");
const sample = (patch: Partial<StockAlert> = {}): StockAlert => ({ ...fixtureAlerts(now).alerts[0], ...patch });
const service = (options: ConstructorParameters<typeof StockAlerts>[3] = {}) => new StockAlerts(db, new FixtureAlertsProvider(), sender, { log: () => {}, ...options });
beforeAll(async () => { db = await openPglite(); await migrate(db); }, 30000);
afterAll(async () => { await db.close(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
beforeEach(async () => {
  await db.exec("truncate app.stock_alerts cascade; truncate app.stock_follows; truncate app.stock_zalo_contacts");
  uid = randomUUID(); sender = new CaptureSender();
  await db.query("insert into app.users(id,display_name) values($1,'Alert tester')", [uid]);
  await db.query("insert into app.user_identities(provider,provider_uid,user_id) values('zalo_oa',$1,$2)", [uid,uid]);
  await db.query("insert into app.stock_zalo_contacts(provider_uid,chat_id,last_inbound_at) values($1,'private-chat',$2)", [uid,new Date(now-1000)]);
  await service().follow(uid,"FPT",true);
});
it.each(alertSchema.shape.kind.options)("uses non-imperative copy for %s, withholding all percentages without stats", kind => {
  const a = sample({kind});
  expect(alertCopy(a)).not.toMatch(/%|hãy|mua ngay|bán ngay|phải mua|phải bán/i);
  expect(alertCopy(a)).toMatch(/bạn/);
  expect(alertMessage(a,true)).toContain("DỮ LIỆU MẪU");
});
it("shows conditional stats, sample, horizon, CI and base rate only with approved stats", () => {
  const a = fixtureAlerts(now).alerts[1];
  expect(alertCopy(a)).toContain("81%"); expect(alertCopy(a)).toContain("n=214");
  expect(alertCopy(a)).toContain("10 phiên"); expect(alertCopy(a)).toContain("54%");
  expect(alertCopy(sample({kind:'break_resistance'}))).toContain("chưa xác nhận khối lượng");
  expect(alertCopy(sample({kind:'break_resistance',candle:'close_beyond_with_volume'}))).toContain("Tín hiệu mạnh");
});
it("dedupes across IDs/kinds/restarts per symbol, numeric level, beat and VN session", async () => {
  const s = service(); await s.ingest(sample());
  await service().ingest(sample({id:'other',kind:'break_resistance'}));
  await s.ingest(sample({beat:'close'})); await s.ingest(sample({level:137}));
  await s.ingest(sample({createdAt:'2026-11-10T03:00:00Z'}));
  expect((await s.feed(VIP)).alerts).toHaveLength(4);
  expect(alertKey(sample({createdAt:'2026-11-09T18:00:00Z'}))).toContain('2026-11-10');
});
it("persists isolated follows, supports unfollow, and cascades account deletion", async () => {
  expect(await service().follows(uid)).toEqual(['FPT']);
  expect(await service().follows(randomUUID())).toEqual([]);
  await service().follow(uid,'FPT',false); expect(await service().follows(uid)).toEqual([]);
  await service().follow(uid,'FPT',true); await db.query('delete from app.users where id=$1',[uid]);
  expect(await service().follows(uid)).toEqual([]);
});
it("fails closed for unknown/expired/future inbound windows, allowing only verified windows", () => {
  expect(zaloAlertEligibility(now-1000,now)).toBe('policy_unknown');
  for(const window of [0,-1,NaN,Infinity]) expect(zaloAlertEligibility(now,now,window)).toBe('policy_unknown');
  for(const inbound of [null,now+1,now-60000]) expect(zaloAlertEligibility(inbound,now,60)).toBe('window_closed');
  expect(zaloAlertEligibility(now-59999,now,60)).toBeNull();
});
it("queues then logs/skips unknown policy without sending", async () => {
  const log=vi.fn(), s=service({log}); await s.ingest(sample()); await s.deliver(now);
  expect(sender.sent).toHaveLength(0); expect(log).toHaveBeenCalledWith('[stock-alerts] policy_unknown');
  expect((await db.query('select status,reason from app.stock_alert_deliveries')).rows).toEqual([{status:'skipped',reason:'policy_unknown'}]);
});
it("reserves a per-user daily cap durably, sending to chat ID once despite repeated workers", async () => {
  const s=service({verifiedWindowSeconds:60,dailyCap:2});
  for(let i=0;i<4;i++) await s.ingest(sample({level:130+i}));
  await Promise.all([s.deliver(now),service({verifiedWindowSeconds:60,dailyCap:2}).deliver(now)]);
  expect(sender.sent).toHaveLength(2); expect(sender.sent.every(m=>m.to==='private-chat')).toBe(true);
  const rows=(await db.query<{status:string;reason:string}>('select status,reason from app.stock_alert_deliveries')).rows;
  expect(rows.filter(r=>r.status==='sent')).toHaveLength(2); expect(rows.filter(r=>r.reason==='daily_cap')).toHaveLength(2);
});
it.each(['unfollowed','window_closed','stale_session','no_linked_chat'])("skips %s", async reason => {
  const s=service({verifiedWindowSeconds:60}); await s.ingest(sample());
  if(reason==='unfollowed') await s.follow(uid,'FPT',false);
  if(reason==='no_linked_chat') await db.exec('truncate app.stock_zalo_contacts');
  await s.deliver(reason==='window_closed'?now+60000:reason==='stale_session'?now+86400000:now);
  expect(sender.sent).toHaveLength(0);
  expect((await db.query('select reason from app.stock_alert_deliveries')).rows[0].reason).toBe(reason);
});
it("does not retry ambiguous send failures", async () => {
  const send=vi.spyOn(sender,'sendText').mockRejectedValue(new Error('secret transport details'));
  const s=service({verifiedWindowSeconds:60}); await s.ingest(sample()); await s.deliver(now); await s.deliver(now);
  expect(send).toHaveBeenCalledTimes(1);
  expect((await db.query('select status from app.stock_alert_deliveries')).rows[0].status).toBe('failed');
});
it("keeps real and fixture queues separate when the configured provider changes", async () => {
  const real=new StockAlerts(db,{fixture:false,load:async()=>fixtureAlerts(now)},sender,{verifiedWindowSeconds:60});
  await real.ingest(sample());
  await service({verifiedWindowSeconds:60}).deliver(now);
  expect(sender.sent).toHaveLength(0);
  expect((await db.query('select status from app.stock_alert_deliveries')).rows[0].status).toBe('queued');
  await real.deliver(now); expect(sender.sent).toHaveLength(1);
});
it("ignores future alerts and does not queue deliveries for guests", async () => {
  await db.query('update app.users set is_guest=true where id=$1',[uid]);
  const s=service(); await s.tick(Date.parse('2026-11-09T04:00:00Z'));
  expect((await s.feed(VIP)).alerts).toHaveLength(1);
  expect((await db.query('select * from app.stock_alert_deliveries')).rows).toHaveLength(0);
});
it("polls every 60 seconds and keeps history on upstream failure", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const provider=new FixtureAlertsProvider(), load=vi.spyOn(provider,'load');
  const s=new StockAlerts(db,provider,sender,{log:()=>{}}); s.start();
  await vi.waitFor(()=>expect(load).toHaveBeenCalledTimes(1));
  await vi.waitFor(async()=>expect((await s.feed(VIP)).alerts).toHaveLength(2));
  await vi.advanceTimersByTimeAsync(60000); await vi.waitFor(()=>expect(load).toHaveBeenCalledTimes(2));
  s.stop(); load.mockRejectedValue(new Error('private token')); await s.tick(now);
  expect((await s.feed(VIP)).alerts).toHaveLength(2); expect((await s.feed(VIP)).error).toBeTruthy();
});
it("uses Bearer/since, validates responses, and avoids polling real provider outside the session", async () => {
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(fixtureAlerts(now)))); vi.stubGlobal('fetch',fetcher);
  const provider=new StockVnAlertsProvider('https://fixture.invalid','mock-token');
  await provider.load('2026-11-09T00:00:00Z');
  expect(String(fetcher.mock.calls[0][0])).toContain('/api/ai/alerts?since=');
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer mock-token');
  fetcher.mockResolvedValue(new Response('{}')); await expect(provider.load('x')).rejects.toThrow();
  fetcher.mockClear(); await new StockAlerts(db,provider,sender).tick(Date.parse('2026-11-08T03:00:00Z'));
  expect(fetcher).not.toHaveBeenCalled();
});
