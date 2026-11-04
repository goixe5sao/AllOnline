/**
 * Listed VN symbols for the owner's stock picker. Same UNOFFICIAL source StockVN uses
 * (Vietcap/VCI `/api/price/symbols/getAll`), filtered to stocks/ETFs on HOSE/HNX/UPCOM.
 * Refreshed at most once a day; indices are seeded by migration 008.
 */
import type { Db, Queryable } from "../db";

const BOARDS: Record<string, string> = { HSX: "HOSE", HNX: "HNX", UPCOM: "UPCOM" };
const LISTED_TYPES = new Set(["STOCK", "ETF"]);

export interface ListedSymbol {
  symbol: string;
  name: string;
  exchange: string;
  kind: "index" | "stock" | "etf";
}

interface VciSymbol {
  symbol?: string;
  board?: string;
  type?: string;
  organName?: string;
  enOrganName?: string;
}

/** Pure parser (unit-tested). */
export function parseVciSymbols(data: VciSymbol[]): ListedSymbol[] {
  const out = new Map<string, ListedSymbol>();
  for (const it of data) {
    const symbol = (it.symbol ?? "").trim().toUpperCase();
    const exchange = BOARDS[it.board ?? ""];
    if (!symbol || !exchange || !LISTED_TYPES.has(it.type ?? "") || !/^[A-Z0-9]{3,10}$/.test(symbol)) continue;
    out.set(symbol, { symbol, name: it.organName || it.enOrganName || symbol, exchange, kind: it.type === "ETF" ? "etf" : "stock" });
  }
  return [...out.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function fetchVciSymbols(): Promise<ListedSymbol[]> {
  const base = "https://trading.vietcap.com.vn";
  const r = await fetch(`${base}/api/price/symbols/getAll`, {
    headers: { Referer: `${base}/`, Origin: base, Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseVciSymbols((await r.json()) as VciSymbol[]);
}

/** Refreshes the symbol table if it is empty or older than a day. Never touches index rows. */
export async function refreshSymbols(db: Db, fetchImpl = fetchVciSymbols): Promise<number> {
  const r = (await db.query<{ n: number; last: Date | null }>("select count(*)::int as n, max(updated_at) as last from app.market_symbols where kind <> 'index'")).rows[0];
  if (Number(r.n) > 100 && r.last && Date.now() - new Date(r.last).getTime() < 86400_000) return 0;
  const list = await fetchImpl();
  if (list.length < 100) throw new Error(`symbol list too short (${list.length})`);
  for (let i = 0; i < list.length; i += 500) {
    const c = list.slice(i, i + 500);
    await db.query(
      `insert into app.market_symbols (symbol, name, exchange, kind, updated_at)
       select s, n, e, k, now() from unnest($1::text[], $2::text[], $3::text[], $4::text[]) as x(s, n, e, k)
       on conflict (symbol) do update set name = excluded.name, exchange = excluded.exchange, kind = excluded.kind, updated_at = now()
       where app.market_symbols.kind <> 'index'`,
      [c.map((x) => x.symbol), c.map((x) => x.name), c.map((x) => x.exchange), c.map((x) => x.kind)],
    );
  }
  return list.length;
}

export interface SymbolHit extends ListedSymbol {
  watch: boolean;
  fullHistory: boolean;
}

/** Search by symbol prefix or company name; indices and watchlist first. */
export async function searchSymbols(q: Queryable, query: string, limit = 20): Promise<SymbolHit[]> {
  const term = query.trim().toUpperCase();
  const rows = (
    await q.query<{ symbol: string; name: string; exchange: string; kind: ListedSymbol["kind"]; watch: boolean }>(
      `select s.symbol, s.name, s.exchange, s.kind, (w.symbol is not null) as watch
       from app.market_symbols s left join app.market_watchlist w on w.symbol = s.symbol
       where $1 = '' or s.symbol like $1 || '%' or upper(s.name) like '%' || $1 || '%'
       order by (s.kind = 'index') desc, (w.symbol is not null) desc, (s.symbol = $1) desc, (s.symbol like $1 || '%') desc, s.symbol
       limit $2`,
      [term, limit],
    )
  ).rows;
  return rows.map((r) => ({ ...r, fullHistory: r.kind === "index" || r.watch }));
}
