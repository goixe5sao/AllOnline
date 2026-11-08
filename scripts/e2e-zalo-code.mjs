import puppeteer from "puppeteer-core";
/**
 * Login page: Email / Zalo tabs; Zalo = the page shows a code, the person sends it to the bot,
 * the page signs in by itself. Bot replies go through the demo simulator (/api/zalo/simulate).
 * Needs an isolated DEMO server (no bot credentials required):
 *   BASE=http://localhost:3100 node scripts/e2e-zalo-code.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const bot = async (oaUserId, text) => (await (await fetch(BASE + "/api/zalo/simulate", { method: "POST", headers: { "Content-Type": "application/json", origin: BASE }, body: JSON.stringify({ oaUserId, text }) })).json()).replies?.join("\n") ?? "";

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new" });
const errors = [];
async function page(vp) {
  const p = await (await browser.createBrowserContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.setViewport(vp);
  return p;
}

for (const [name, vp] of [
  ["laptop", { width: 1100, height: 860 }],
  ["mobile", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
]) {
  const p = await page(vp);
  await p.goto(BASE + "/login?next=/rooms/new", { waitUntil: "networkidle0" });
  const tabs = await p.$$eval(".login-tabs [role=tab]", (b) => b.map((x) => x.textContent?.trim()));
  check(tabs.length === 2 && tabs[0].includes("Email") && tabs[1].includes("Zalo"), `${name}: two tabs “Email” / “Zalo” (${tabs.join(" | ")})`);
  if (name === "laptop") await p.screenshot({ path: `${OUT}/login-email-tab.png` });
  await p.click(".login-tabs [role=tab]:nth-child(2)");
  await p.waitForSelector(".zalo-box button.zalo-btn");
  await p.click(".zalo-box button.zalo-btn");
  await p.waitForSelector(".zalo-code code");
  const msg = await p.$eval(".zalo-code code", (e) => e.textContent);
  check(/^DN \d{6}$/.test(msg), `${name}: code shown (“${msg}”)`);
  const href = await p.$eval(".zalo-steps a.zalo-btn", (a) => a.href);
  check(href === "https://zalo.me/demo-bot", `${name}: button opens the bot (${href})`);
  await p.screenshot({ path: `${OUT}/login-zalo-${name}.png` });

  const who = `oa-user-${name}`;
  const wrong = await bot(who, "DN 000000");
  check(/không đúng hoặc đã hết hạn/.test(wrong), `${name}: wrong code → bot says so`);
  const ok = await bot(who, msg.toLowerCase()); // typed in lower case
  check(/Đã đăng nhập/.test(ok) && /tạo tài khoản/.test(ok), `${name}: bot confirms and creates the account (“${ok.split("\n")[0]}”)`);
  await p.waitForFunction(() => location.pathname === "/rooms/new", { timeout: 10000 }).catch(() => {});
  check((await p.evaluate(() => location.pathname)) === "/rooms/new", `${name}: the page signed in by itself and went on to “next”`);
  const me = await p.evaluate(async () => (await (await fetch("/api/me")).json()));
  check(!!me?.user && !me.user.isGuest, `${name}: signed in as an account (${me?.user?.displayName})`);
  const again = await bot(who, msg);
  check(/không đúng hoặc đã hết hạn/.test(again), `${name}: a used code cannot be used again`);
  if (name === "laptop") {
    // second time with the same Zalo → same account, no new one
    const p2 = await page(vp);
    await p2.goto(BASE + "/login?via=zalo", { waitUntil: "networkidle0" });
    await p2.click(".zalo-box button.zalo-btn");
    await p2.waitForSelector(".zalo-code code");
    const m2 = await p2.$eval(".zalo-code code", (e) => e.textContent);
    const r2 = await bot(who, m2.replace("DN ", ""));
    check(/Đã đăng nhập/.test(r2) && !/tạo tài khoản/.test(r2), "same Zalo again → same account (no new one), bare digits work");
    await p2.waitForFunction(() => location.pathname === "/", { timeout: 10000 }).catch(() => {});
    const me2 = await p2.evaluate(async () => (await (await fetch("/api/me")).json()));
    check(me2?.user?.id === me?.user?.id, "both browsers are the same account");
  }
}
console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
