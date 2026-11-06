import puppeteer from "puppeteer-core";
import { orb } from "./orb.mjs";
/**
 * "Trang web tự cuộn" in a demo room (needs internet): the demo host does not type a link —
 * the one button puts goixe5sao.vn on screen; a second demo room gets the same shared photo
 * at once (other sites are refused by demoContentAllowed, see tests/demo.test.ts).
 *   BASE=http://localhost:3100 node scripts/e2e-demo-web.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 240000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
async function page(vp = { width: 1200, height: 800 }) {
  const p = await (await browser.createBrowserContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.setViewport(vp);
  await p.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem("ao-gfx", "lite");
    } catch {
      /* ignore */
    }
  });
  return p;
}
const admin = await page();
await admin.goto(BASE + "/login", { waitUntil: "networkidle0" });
await admin.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ ứng dụng", asAppOwner: true }) });
});
await admin.goto(BASE + "/", { waitUntil: "networkidle0" });
const rooms = await admin.evaluate(async () => (await (await fetch("/api/demo")).json()).rooms);
check(rooms.length >= 2, `${rooms.length} demo rooms`);

const buttons = (p) => p.$$eval(".web-panel button", (x) => x.map((b) => b.textContent ?? ""));
async function host(code, name) {
  const p = await page();
  await p.goto(`${BASE}/join/${code}?as=host`, { waitUntil: "networkidle0" });
  await p.type("form input[maxlength='60']", name);
  await p.click("form button.btn.primary");
  await p.waitForSelector(".orb", { timeout: 90000 });
  await sleep(1500);
  await orb(p, "control");
  await p.waitForSelector(".side-panel");
  const opt = await p.evaluate(() => [...document.querySelectorAll(".side-panel label.field select option")].find((o) => o.value === "web")?.textContent ?? "");
  check(/goixe5sao/.test(opt), `${name}: “${opt}” in the content list`);
  await p.evaluate(() => {
    const sel = [...document.querySelectorAll(".side-panel label.field")].find((l) => l.textContent?.includes("Loại nội dung"))?.querySelector("select");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, "web");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await p.waitForSelector(".web-panel");
  return p;
}

const a = await host(rooms[0].inviteCode, "Lan");
check((await a.$$('.web-panel input[aria-label="Link trang web"]')).length === 0, "no link box in a demo room");
check(/goixe5sao\.vn/.test(await a.$eval(".web-panel", (e) => e.textContent)), "panel says the page is goixe5sao.vn");
await a.screenshot({ path: `${OUT}/demo-web-panel.png` });
let t0 = Date.now();
await a.evaluate(() => [...document.querySelectorAll(".web-panel button")].find((b) => b.textContent?.includes("goixe5sao"))?.click());
const shown = await a.waitForSelector(".web-scroll img", { timeout: 90000 }).then(() => true).catch(() => false);
check(shown, `goixe5sao.vn on screen (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (!shown) console.log("panel:", await a.evaluate(() => document.querySelector(".web-panel")?.innerText));
check(/goixe5sao\.vn/.test(await a.$eval(".web-label", (e) => e.textContent).catch(() => "")), "label shows goixe5sao.vn");
check(!(await buttons(a)).some((t) => t.includes("Chụp lại")), "no “Chụp lại” in a demo room");
await sleep(9000);
await a.screenshot({ path: `${OUT}/demo-web-scrolling.png` });

// second demo room: same photo, at once
const b = await host(rooms[1].inviteCode, "Minh");
t0 = Date.now();
await b.evaluate(() => [...document.querySelectorAll(".web-panel button")].find((x) => x.textContent?.includes("goixe5sao"))?.click());
const fast = await b.waitForSelector(".web-scroll img", { timeout: 30000 }).then(() => true).catch(() => false);
const sec = (Date.now() - t0) / 1000;
check(fast && sec < 5, `second demo room: shared photo, ${sec.toFixed(1)} s`);
const srcs = (p) => p.$$eval(".web-scroll img", (x) => x.map((i) => new URL(i.src).pathname).join());
check((await srcs(a)) === (await srcs(b)), "both rooms show the same photo");

console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
