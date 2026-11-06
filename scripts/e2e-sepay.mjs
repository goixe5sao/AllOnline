import puppeteer from "puppeteer-core";
/**
 * Paying by bank transfer: VietQR on the order page + SePay webhook (real Chrome, demo server).
 *  - the order page shows the VietQR (amount + order code) and says the room opens by itself;
 *  - wrong API key refused; outgoing / code-less transfers do not touch the order;
 *  - a short transfer → "còn thiếu" with a QR for the missing amount; topping up → paid, room open;
 *  - the same webhook twice changes nothing; money after "paid" is flagged for a refund check.
 * Needs a DEMO server started with SEPAY_API_KEY=test-sepay:
 *   BASE=http://localhost:3100 node scripts/e2e-sepay.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
let txId = Date.now();
const sepay = async (body, key = "test-sepay") => {
  const r = await fetch(BASE + "/api/payments/sepay", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Apikey ${key}` }, body: JSON.stringify({ gateway: "MBBank", transactionDate: "2026-11-06 09:30:00", accountNumber: "0123456789", referenceCode: "FT" + txId, transferType: "in", ...body }) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new" });
const errors = [];
const p = await (await browser.createBrowserContext()).newPage();
p.on("pageerror", (e) => errors.push(e.message));
await p.setViewport({ width: 900, height: 1100 });
await p.goto(BASE + "/login", { waitUntil: "networkidle0" });
const order = await p.evaluate(async () => {
  const j = (path, method, body) => fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  await j("/api/auth/demo-login", "POST", { displayName: "Chị Lan", asAppOwner: true });
  await j("/api/admin/settings", "PATCH", { qr_bank_bin: "970422", qr_account_no: "0123456789", qr_account_name: "NGUYEN THI LAN", total_slot_budget: 3000 });
  return j("/api/rooms", "POST", { useTrial: false, config: { name: "Đêm nhạc Acoustic", description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 20, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "" } });
});
check(!!order.orderId, `paid order created (${order.orderId ? "ok" : JSON.stringify(order)})`);
const view = () => p.evaluate(async (id) => (await (await fetch(`/api/orders/${id}`)).json()), order.orderId);
let v = await view();
const code = v.order.code;
const amount = v.order.amount_vnd;
await p.goto(`${BASE}/orders/${order.orderId}`, { waitUntil: "networkidle0" });
const qr = await p.$eval(`img[alt^="QR chuyển khoản"]`, (i) => i.src).catch(() => "");
check(qr.includes("img.vietqr.io/image/970422-0123456789") && qr.includes(`amount=${amount}`) && qr.includes(`addInfo=${code}`), `VietQR with bank, amount ${amount} and content ${code}`);
check(/tự mở trong vài giây/.test(await p.evaluate(() => document.body.innerText)), "page says the room opens by itself (SePay on)");
await p.screenshot({ path: `${OUT}/pay-order-qr.png`, fullPage: true });

// ---- things that must not touch the order
check((await sepay({ id: ++txId, content: code, transferAmount: amount }, "wrong")).status === 401, "wrong API key → 401");
const out = await sepay({ id: ++txId, content: code, transferAmount: amount, transferType: "out" });
const noCode = await sepay({ id: ++txId, content: "chuyen tien an trua", transferAmount: amount });
v = await view();
check(out.body?.success === true && noCode.body?.success === true && v.order.status === "pending", "outgoing and code-less transfers: answered {success:true}, order still pending");

// ---- short transfer, then top-up (content typed loosely: lower case, dots)
const half = Math.floor(amount / 2);
const loose = `ck ${code.slice(0, 2).toLowerCase()}.${code.slice(2).toLowerCase()} phong`;
await sepay({ id: ++txId, content: loose, transferAmount: half });
v = await view();
check(v.order.status === "underpaid" && v.payment.due === amount - half, `short transfer → “thiếu tiền”, still due ${v.payment.due}`);
await p.reload({ waitUntil: "networkidle0" });
const qr2 = await p.$eval(`img[alt^="QR chuyển khoản"]`, (i) => i.src).catch(() => "");
check(/Còn thiếu/.test(await p.evaluate(() => document.body.innerText)) && qr2.includes(`amount=${amount - half}`), "page: “Còn thiếu …” with a QR for the missing amount");
await p.screenshot({ path: `${OUT}/pay-order-topup.png`, fullPage: true });
const topUp = { id: ++txId, content: `IBFT ${code}`, transferAmount: amount - half };
await sepay(topUp);
v = await view();
check(v.order.status === "paid" && !!v.room, `top-up → paid, room “${v.room?.name}” opened`);
check(/Đã nhận đủ sau/.test(v.order.review_note ?? ""), `note explains the two transfers (“${v.order.review_note}”)`);
await sleep(4500); // the page refreshes itself every 4 s
check(/Đã xác nhận/.test(await p.evaluate(() => document.body.innerText)), "order page updated by itself to “Đã xác nhận”");
await p.screenshot({ path: `${OUT}/pay-order-paid.png`, fullPage: true });

// ---- replays and extra money
const again = await sepay(topUp);
const v2 = await view();
check(again.body?.success === true && v2.order.status === "paid" && v2.order.review_note === v.order.review_note, "same webhook again (retry) → nothing changes");
await sepay({ id: ++txId, content: code, transferAmount: 50000 });
check(/cần kiểm tra hoàn tiền/.test((await view()).order.review_note ?? ""), "money after the order was paid → flagged for a refund check");

console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
