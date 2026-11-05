import puppeteer from "puppeteer-core";
/**
 * Zalo bot + payments in real Chrome (demo server, bot simulator on /account):
 * sign up via the bot → one-time login link → link a web account (LK) → reminder → SePay
 * webhook opens a paid room and the bot tells the payer → screenshot to review → admin approves.
 * Needs a DEMO server started with SEPAY_API_KEY=test-sepay ZALO_OA_ID=demo-oa:
 *   BASE=http://localhost:3100 node scripts/e2e-zalo.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 120000 });
const errors = [];
async function page(vp = { width: 1100, height: 900 }) {
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setViewport(vp);
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
}
const post = (p, path, body) => p.evaluate(async (path, body) => { const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; }, path, body);
const say = async (p, text) => {
  await p.type("#bot-sim input[type=text]", text);
  await p.click("#bot-sim button.btn.primary");
  await sleep(900);
  return p.evaluate(() => [...document.querySelectorAll("#bot-sim .sim-msg.bot")].map((e) => e.textContent).pop() ?? "");
};

// ---- 1. a newcomer signs up by chatting with the bot (simulator lives on /account of any member) ----
const helper = await page();
await helper.goto(BASE + "/login", { waitUntil: "networkidle0" });
check(await helper.evaluate(() => document.body.textContent?.includes("bot Sân Khấu Online trên Zalo")), "login page offers the Zalo bot");
await helper.screenshot({ path: `${OUT}/zalo-login.png` });
await post(helper, "/api/auth/demo-login", { displayName: "Người thử bot" });
await helper.goto(BASE + "/account", { waitUntil: "networkidle0" });
await helper.waitForSelector("#bot-sim");
let reply = await say(helper, "Đăng ký");
check(reply.includes("Đã tạo tài khoản") && reply.includes("/api/auth/zalo/bot-login"), "ĐĂNG KÝ → new account + one-time login link");
const link = reply.match(/https?:\/\/\S+/)[0].replace(/^https?:\/\/[^/]+/, BASE);
const newcomer = await page();
await newcomer.goto(link, { waitUntil: "networkidle0" });
const me = await newcomer.evaluate(async () => (await (await fetch("/api/me")).json()).user);
check(me && !me.isGuest && me.displayName.startsWith("Zalo"), "login link signs the newcomer in (no password)");
await newcomer.goto(link, { waitUntil: "networkidle0" });
check(newcomer.url().includes("/login?error=link") || (await newcomer.evaluate(() => location.search.includes("error=link"))), "the same link cannot be used twice");
await helper.screenshot({ path: `${OUT}/zalo-bot-signup.png` });

// ---- 2. the room owner links Zalo, creates a paid room, pays by bank transfer (SePay) ----
const owner = await page();
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
await post(owner, "/api/auth/demo-login", { displayName: "Chị Hoa", asAppOwner: true });
await owner.evaluate(() => fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qr_bank_bin: "970436", qr_account_no: "0123456789", qr_account_name: "ALLONLINE" }) }));
await owner.goto(BASE + "/account", { waitUntil: "networkidle0" });
await owner.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Lấy mã liên kết"))?.click());
await sleep(700);
const code = await owner.evaluate(() => document.body.textContent?.match(/LK (\d{6})/)?.[1]);
reply = await say(owner, `LK ${code}`);
check(reply.includes("Đã liên kết"), "LK <code> links the web account to Zalo");
await owner.reload({ waitUntil: "networkidle0" });
check(await owner.evaluate(() => document.body.textContent?.includes("✓ Bot Zalo đã liên kết")), "account page shows the link");
const order = await post(owner, "/api/rooms", { useTrial: false, config: { name: "Workshop Robot", description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 10, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: true, password: "", scheduledAt: Date.now() + 40 * 60_000 } });
const orderView = await owner.evaluate(async (id) => (await (await fetch(`/api/orders/${id}`)).json()), order.body.orderId);
const orderCode = orderView.order.code;
reply = await say(owner, "ĐƠN");
check(reply.includes(orderCode), "ĐƠN shows the pending order and the transfer content");
// SePay posts the incoming transfer (server-to-server, API key header)
const sepay = await fetch(BASE + "/api/payments/sepay", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Apikey test-sepay" },
  body: JSON.stringify({ id: Date.now(), gateway: "Vietcombank", transactionDate: "2026-11-05 20:01:00", accountNumber: "0123456789", content: `IBFT ${orderCode} thanh toan`, transferType: "in", transferAmount: orderView.order.amount_vnd, referenceCode: "FT1" }),
});
const sj = await sepay.json();
check(sj.outcome === "fulfilled", `SePay transfer confirms the order (${sj.outcome})`);
const bad = await fetch(BASE + "/api/payments/sepay", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Apikey wrong" }, body: "{}" });
check(bad.status === 401, "SePay webhook rejects a wrong key");
reply = await say(owner, "lịch");
await owner.screenshot({ path: `${OUT}/zalo-bot-owner.png` });

// ---- 3. a screenshot for a second order goes to review; the admin approves it ----
const order2 = await post(owner, "/api/rooms", { useTrial: false, config: { name: "Phòng thứ hai", description: "", map: "carpet", avatarGroups: ["people"], officialCapacity: 10, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "" } });
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
// sent from the same simulator chat (the follower id linked above)
await owner.evaluate((png) => {
  const input = document.querySelector("#bot-sim input[type=file]");
  const dt = new DataTransfer();
  const bin = atob(png.split(",")[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  dt.items.add(new File([arr], "chuyen-khoan.png", { type: "image/png" }));
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, png);
await sleep(2500);
reply = await owner.evaluate(() => [...document.querySelectorAll("#bot-sim .sim-msg.bot")].map((e) => e.textContent).pop() ?? "");
check(/Quản trị viên|ngân hàng báo tiền/.test(reply), "screenshot alone does not open the room (review / wait for bank)");
await owner.screenshot({ path: `${OUT}/zalo-bot-receipt.png` });
await owner.goto(BASE + "/admin", { waitUntil: "networkidle0" });
await owner.evaluate(() => [...document.querySelectorAll("[role=tab]")].find((b) => b.textContent?.includes("Biên lai"))?.click());
await sleep(1200);
await owner.screenshot({ path: `${OUT}/admin-proofs.png`, fullPage: true });
owner.on("dialog", (d) => d.accept());
await owner.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Duyệt")?.click());
await sleep(1500);
const st = await owner.evaluate(async (id) => (await (await fetch(`/api/orders/${id}`)).json()).order.status, order2.body.orderId);
check(st === "paid", `admin approves the screenshot → order paid (${st})`);

console.log("errors:", errors.length ? errors : "none");
await browser.close();
process.exit(failed ? 1 : 0);
