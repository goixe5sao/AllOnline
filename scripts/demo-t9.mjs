// Worktree-local demo only; blank every credential read by Config before env loading.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
assert.equal(process.cwd().toLowerCase(), path.resolve("D:/ActiveProject/AllOnline-ui").toLowerCase());
for (const match of fs.readFileSync("server/config.ts","utf8").matchAll(/env\("([A-Z0-9_]+)"\)/g)) process.env[match[1]]=" ";
Object.assign(process.env,{NODE_ENV:"development",PORT:"3100",HOST:"127.0.0.1",ALLOW_DEMO_MODE:"1",MARKET_DATA:"off",AI_STOCK_PROVIDER:"fixture",APP_SECRET:"t9-local-demo-only",PUBLIC_ORIGIN:"http://localhost:3100",COOKIE_SECURE:"0",DEMO_DATA_DIR:path.join(process.cwd(),".data-t9")});
const { openPglite, migrate } = await import("../server/db.ts");
const db = await openPglite(path.join(process.env.DEMO_DATA_DIR,"pglite"));
try {
  await migrate(db);
  for (const [i,plan] of ["basic","vip","off"].entries()) {
    await db.query("insert into app.users(id,display_name,ai_plan) values($1,$2,$3) on conflict(id) do update set ai_plan=excluded.ai_plan", [`00000000-0000-4000-8000-00000000000${i+1}`,`T9 local ${plan}`,plan]);
  }
  await db.query("insert into app.market_symbols(symbol,name,exchange,kind) values('FPT','FPT · Local sample','HOSE','stock') on conflict do nothing");
} finally { await db.close(); }
await import("../server/index.ts");
