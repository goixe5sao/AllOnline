import puppeteer from "puppeteer-core";
/**
 * Open-ended room in real Chrome: choose "Vô thời hạn" → deposit order → (demo) pay →
 * owner panel shows the running bill → close → settlement visible to the owner and in /admin.
 *   BASE=http://localhost:3100 node scripts/e2e-open-ended.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 120000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
const p = await (await browser.createBrowserContext()).newPage();
p.on("pageerror", (e) => errors.push(e.message));
p.on("dialog", (d) => d.accept(d.type() === "prompt" ? "Đã chuyển khoản hoàn tiền (test)" : undefined));
await p.setViewport({ width: 1280, height: 900 });
await p.goto(BASE + "/login", { waitUntil: "networkidle0" });
await p.evaluate(async () => fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ phòng vô hạn", asAppOwner: true }) }));

// 1) create form: pick "Vô thời hạn"
await p.goto(BASE + "/rooms/new", { waitUntil: "networkidle0" });
await p.waitForSelector("form select");
await p.type("input[maxlength='120']", "Phòng vô thời hạn");
const sel = await p.evaluateHandle(() => [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "open")));
check(!!(await sel.asElement()), "duration list offers “Vô thời hạn”");
await sel.asElement().select("open");
await sleep(1200);
const notice = await p.evaluate(() => document.body.innerText);
check(/Đặt cọc trước\s+1\.000\.000/.test(notice) && /\/giờ/.test(notice), "form shows deposit 1.000.000 ₫ and the hourly rate");
await p.screenshot({ path: `${OUT}/open-ended-create.png`, fullPage: true });
await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("đặt cọc"))?.click());
await p.waitForFunction(() => location.pathname.startsWith("/orders/"), { timeout: 20000 });
await sleep(800);
check(/vô thời hạn/.test(await p.evaluate(() => document.body.innerText)), "order page says vô thời hạn");
await p.screenshot({ path: `${OUT}/open-ended-order.png` });

// 2) demo payment → room
const orderId = p.url().split("/orders/")[1];
const pay = await p.evaluate(async (id) => (await fetch(`/api/orders/${id}/demo-pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json(), orderId);
check(pay.outcome === "fulfilled" && pay.roomId, "deposit confirmed → room created");

// 3) owner panel: running bill, no countdown/extension
await p.goto(`${BASE}/room/${pay.roomId}`, { waitUntil: "networkidle0" });
await p.waitForSelector(".hud-top");
await p.evaluate(() => [...document.querySelectorAll(".hud-btn")].find((b) => b.textContent === "Điều khiển")?.click());
await sleep(500);
await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Phòng")?.click());
await sleep(1500);
const panel = await p.evaluate(() => document.querySelector(".side-panel")?.textContent ?? document.body.innerText);
check(panel.includes("vô thời hạn") && panel.includes("Nếu tắt bây giờ") && !panel.includes("Tạo đơn gia hạn"), "owner panel: running bill, no extension");
await p.screenshot({ path: `${OUT}/open-ended-panel.png` });

// 4) close → settlement
await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Đóng phòng")?.click());
await sleep(1500);
await p.goto(BASE + "/", { waitUntil: "networkidle0" });
await p.waitForSelector(".mr", { timeout: 20000 });
const mine = await p.evaluate(() => [...document.querySelectorAll(".mr")].map((e) => e.textContent).join(" | "));
check(/Quyết toán: 1 giờ/.test(mine) && /hoàn lại cho bạn/.test(mine), "home → Phòng của tôi shows the settlement (1 h, refund)");
await p.evaluate(() => document.querySelector("#my-rooms-h")?.scrollIntoView());
await sleep(400);
await p.screenshot({ path: `${OUT}/open-ended-settlement-owner.png` });

await p.goto(BASE + "/admin", { waitUntil: "networkidle0" });
await p.evaluate(() => [...document.querySelectorAll("[role=tab]")].find((b) => b.textContent === "Quyết toán")?.click());
await p.waitForFunction(() => document.body.innerText.includes("Cần hoàn tiền"), { timeout: 20000 });
await p.screenshot({ path: `${OUT}/open-ended-admin.png` });
await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Đã xử lý")?.click());
await p.waitForFunction(() => document.body.innerText.includes("Đã xong"), { timeout: 20000 });
check(true, "admin marks the refund as done");

console.log("errors:", errors.length ? errors : "none");
await browser.close();
process.exit(failed ? 1 : 0);
