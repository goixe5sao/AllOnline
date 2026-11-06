import puppeteer from "puppeteer-core";
/**
 * "Tạo phòng" page, every case, in real Chrome (no 3D on this page, light on the CPU):
 * the "Slot & giá" box must never hang on "Đang tính…" — every mistake shows a reason and is
 * recoverable once fixed — and every kind of room can be created (trial, paid, promo 100 %,
 * open-ended deposit) with the chosen options stored.
 *   BASE=http://localhost:3100 node scripts/e2e-create-room.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 120000 });
const errors = [];

async function login(name, asAppOwner = false) {
  const p = await (await browser.createBrowserContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.setViewport({ width: 1280, height: 900 });
  await p.goto(BASE + "/login", { waitUntil: "networkidle0" });
  await p.evaluate(async (b) => fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }), { displayName: name, asAppOwner });
  return p;
}
const api = (p, path, method = "GET", body) => p.evaluate(async (a) => { const r = await fetch(a.path, { method: a.method, headers: { "Content-Type": "application/json" }, body: a.body ? JSON.stringify(a.body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, { path, method, body });

/** State of the "Slot & giá" box once it settles (no request in flight). */
async function box(p, waitMs = 6000) {
  const t0 = Date.now();
  let s;
  do {
    await sleep(150);
    s = await p.evaluate(() => {
      const card = [...document.querySelectorAll(".card")].find((c) => c.querySelector("h2")?.textContent?.startsWith("Slot & giá"));
      const txt = card?.textContent ?? "";
      const row = (label) => [...(card?.querySelectorAll("tr") ?? [])].find((tr) => tr.textContent?.includes(label))?.querySelector("strong")?.textContent ?? null;
      const btn = document.querySelector("form button.btn.primary");
      return {
        quoting: txt.includes("· đang tính…"),
        stuck: !!card && [...card.querySelectorAll("p.muted")].some((e) => e.textContent === "Đang tính…"),
        error: [...(card?.querySelectorAll(".notice.error") ?? [])].map((e) => e.textContent).join(" | "),
        warn: [...(card?.querySelectorAll(".notice.warn") ?? [])].map((e) => e.textContent).join(" | "),
        waiting: row("Chỗ chờ"),
        total: row("Tổng slot"),
        price: card?.querySelector(".notice .row strong, .notice strong")?.textContent ?? null,
        amountText: txt,
        submit: btn?.textContent ?? "",
        submitEnabled: !!btn && !btn.disabled,
        hours: [...document.querySelectorAll("label.field")].find((l) => l.textContent?.trim().startsWith("Thời hạn"))?.querySelector("select")?.value ?? null,
      };
    });
  } while ((s.quoting || s.stuck) && Date.now() - t0 < waitMs);
  return s;
}
const capInput = "form input[type=number]";
async function setCap(p, v) {
  await p.click(capInput, { clickCount: 3 });
  await p.keyboard.press("Backspace");
  if (v !== "") await p.type(capInput, String(v));
}
const field = (p, labelStart) => p.evaluateHandle((t) => [...document.querySelectorAll("label.field")].find((l) => l.textContent?.trim().startsWith(t))?.querySelector("input,textarea,select"), labelStart);
async function typeInto(p, labelStart, text) {
  const el = await field(p, labelStart);
  await el.click({ clickCount: 3 });
  await p.keyboard.press("Backspace");
  await el.type(text);
}
const clickText = (p, sel, text) => p.evaluate((a) => [...document.querySelectorAll(a.sel)].find((e) => e.textContent?.includes(a.text))?.click(), { sel, text });
const checkBox = (p, text, on) => p.evaluate((a) => { const l = [...document.querySelectorAll("label.check")].find((e) => e.textContent?.includes(a.text)); const i = l?.querySelector("input"); if (i && i.checked !== a.on) i.click(); return !!i; }, { text, on });
async function screen(p, kind, value) {
  await p.select("form .field .row select", kind);
  await sleep(100);
  if (value !== undefined) {
    const inp = await p.$("form .field .row input[type=text]");
    await inp.click({ clickCount: 3 });
    await p.keyboard.press("Backspace");
    await inp.type(value);
  }
}
async function duration(p, v) {
  await p.evaluate((v) => { const s = [...document.querySelectorAll("label.field")].find((l) => l.textContent?.trim().startsWith("Thời hạn"))?.querySelector("select"); if (s) { const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, String(v)); s.dispatchEvent(new Event("change", { bubbles: true })); } }, v);
}
async function openNew(p) {
  await p.goto(BASE + "/rooms/new", { waitUntil: "networkidle0" });
  await p.waitForSelector(capInput);
}
const ok = (s) => !s.stuck && !s.error && s.total !== null;

// ---------- the owner of the app (budget control) and a normal member ----------
const admin = await login("Chủ ứng dụng", true);
const cat = (await api(admin, "/api/catalog")).json;
const ratio = cat.waitingRatio;
const maxCap = cat.maxRoomCapacity;
const tMax = cat.trial.maxCapacity;
const tHours = cat.trial.maxHours;
const longest = Math.max(...cat.durationOptions);
await api(admin, "/api/admin/settings", "PATCH", { total_slot_budget: 3000, trial_rooms_per_account: 1 });
console.log(`catalog: max ${maxCap} chỗ, trial ≤ ${tMax} chỗ / ${tHours} giờ, durations ${cat.durationOptions}, waiting ${ratio}`);

const p = await login("Khách tạo phòng");
await openNew(p);
let s = await box(p);
check(ok(s) && s.submitEnabled, `default: price box filled, no error, submit on (${s.total} slot, “${s.submit}”)`);
check(Number(s.waiting) === Math.floor(20 * ratio) && Number(s.total) === 20 + Math.floor(20 * ratio), `default: waiting = floor(20 × ${ratio}) and total adds up (${s.waiting} / ${s.total})`);
await p.screenshot({ path: `${OUT}/create-default.png`, fullPage: true });

// capacity: limits, empty, recovery
for (const [v, expectOk] of [[1, true], [maxCap, true], [maxCap + 1, false], [5000, false], [20, true]]) {
  await setCap(p, v);
  s = await box(p);
  if (expectOk) check(!s.stuck && !/Tối đa/.test(s.error) && s.total !== null, `capacity ${v}: quoted (${s.total} slot)`);
  else check(!s.stuck && /Tối đa \d+ chỗ/.test(s.error) && !s.submitEnabled, `capacity ${v}: “${s.error.slice(0, 50)}”, submit off`);
}
await setCap(p, "");
s = await box(p);
check(!s.stuck && /số chỗ/.test(s.error) && !s.submitEnabled, `capacity empty: “${s.error.slice(0, 40)}”, submit off`);
await setCap(p, 20);
s = await box(p);
check(ok(s) && s.submitEnabled, "capacity fixed: back to normal");
check((await p.$eval(capInput, (e) => e.value)) === "20", "clearing then typing 20 shows “20” (not “020”)");
for (const v of ["0", "-5", "2.5"]) {
  await setCap(p, v);
  s = await box(p);
  check(!s.stuck && /số chỗ/.test(s.error) && !s.submitEnabled && !/NaN/.test(s.amountText), `capacity ${v}: “${s.error.slice(0, 40)}”, submit off`);
}
await setCap(p, 20);
s = await box(p);
check(ok(s) && s.submitEnabled, "capacity 20 again: normal");

// slot budget: not enough system slots
await api(admin, "/api/admin/settings", "PATCH", { total_slot_budget: 30 });
await setCap(p, 40);
s = await box(p);
check(!s.stuck && /Không đủ slot/.test(s.error) && !s.submitEnabled, "system budget 30 < 48 slots: “Không đủ slot”, submit off");
await api(admin, "/api/admin/settings", "PATCH", { total_slot_budget: 3000 });
await setCap(p, 21);
await setCap(p, 20);
s = await box(p);
check(ok(s) && s.submitEnabled, "budget raised: back to normal");

// name with spaces only (server trims → used to fail and hang)
await typeInto(p, "Tên phòng", "     ");
s = await box(p);
check(ok(s), "name = spaces only: still quoted (falls back to “Phòng mới”)");
await typeInto(p, "Tên phòng", "Đêm nhạc Tương Lai");

// screen content: chart code, long text, YouTube, blank
await screen(p, "chart", "FPT CORP");
s = await box(p);
check(!s.stuck && !s.submitEnabled && (await p.evaluate(() => document.body.textContent.includes("Mã chứng khoán chỉ gồm"))), "chart code “FPT CORP”: explained next to the field, submit off, price box not stuck");
await screen(p, "chart", "VNĐ");
s = await box(p);
check(!s.stuck && !s.submitEnabled, "chart code with a Vietnamese letter: same");
await screen(p, "chart", "fpt");
s = await box(p);
check(ok(s) && s.submitEnabled, "chart code fixed (fpt → FPT): back to normal");
await screen(p, "text", "x".repeat(800));
s = await box(p);
check(ok(s) && s.submitEnabled && (await p.evaluate(() => document.body.textContent.includes("Chỉ hiện 500 ký tự đầu"))), "screen text 800 chars: quoted, note “Chỉ hiện 500 ký tự đầu”");
await screen(p, "youtube", "not a link");
s = await box(p);
check(!s.stuck && (await p.evaluate(() => document.body.textContent.includes("Link YouTube không hợp lệ"))), "YouTube bad link: flagged, box not stuck");
await screen(p, "youtube", "https://youtu.be/dQw4w9WgXcQ");
s = await box(p);
check(ok(s) && s.submitEnabled, "YouTube valid link: normal");
await screen(p, "blank");
s = await box(p);
check(ok(s) && s.submitEnabled, "screen blank: normal");

// waiting area off / on
await checkBox(p, "Cho người chờ", false);
s = await box(p);
check(ok(s) && Number(s.waiting) === 0 && Number(s.total) === 20, `waiting off: 0 waiting, total 20 (${s.waiting}/${s.total})`);
await checkBox(p, "Cho người chờ", true);

// every MAP (drive-in switches the avatar group to vehicles), no group selected
for (const m of cat.maps.filter((x) => x.enabled)) {
  await clickText(p, ".choice", m.name);
  s = await box(p);
  check(ok(s) && s.submitEnabled, `MAP ${m.name}: quoted, submit on`);
}
await clickText(p, ".choice", cat.maps[0].name);
await sleep(300);
const groupBoxes = await p.$$eval("form .field .row label.check input", (els) => els.length);
await p.evaluate(() => [...document.querySelectorAll("form .field .row label.check input")].forEach((i) => i.checked && i.click()));
s = await box(p);
check(!s.stuck && /nhóm đối tượng/.test(s.error) && !s.submitEnabled, `no avatar group (${groupBoxes} boxes): explained, submit off`);
await p.evaluate(() => document.querySelector("form .field .row label.check input")?.click());
s = await box(p);
check(ok(s) && s.submitEnabled, "group re-selected: normal");

// entry modes, public, password, schedule, stage style — the box keeps working
await clickText(p, ".choice", "Vào từ cổng");
await checkBox(p, "Hiện phòng trên trang chủ", false);
await typeInto(p, "Mật mã phòng", "1234");
await clickText(p, ".choice", "Đơn sắc");
s = await box(p);
check(ok(s) && s.submitEnabled, "gate entry + private + password + Đơn sắc: normal");

// every duration, then open-ended
let prices = [];
for (const h of cat.durationOptions) {
  await duration(p, h);
  s = await box(p);
  const m = s.amountText.match(/Giá([\d.]+)\s?₫/);
  prices.push(m ? m[1] : null);
  check(ok(s) && s.hours === String(h) && s.submitEnabled, `${h} giờ: quoted (${m ? m[1] + " ₫" : "?"})`);
}
check(new Set(prices).size === prices.length, `price changes with the duration (${prices.join(" / ")})`);
await duration(p, "open");
s = await box(p);
check(ok(s) && /Đặt cọc trước/.test(s.amountText) && /đặt cọc/.test(s.submit), `open-ended: deposit shown, button “${s.submit}”`);
await duration(p, cat.durationOptions[0]);

// promo codes
await p.type('input[aria-label="Mã giảm giá"]', "SAIMA");
await clickText(p, "button", "Áp dụng");
s = await box(p);
check(!s.stuck && (await p.evaluate(() => [...document.querySelectorAll("small")].some((e) => e.style.color && e.textContent.length > 3))), "wrong promo code: reason shown, box not stuck");
await clickText(p, "button", "Bỏ mã");
await p.type('input[aria-label="Mã giảm giá"]', "ASDFG");
await clickText(p, "button", "Áp dụng");
s = await box(p);
check(ok(s) && /0\s?₫/.test(s.amountText) && /miễn phí/.test(s.submit), `ASDFG: 0 ₫, button “${s.submit}”`);
await clickText(p, "button", "Bỏ mã");

// trial: from the longest duration, then too many seats
await duration(p, longest);
await setCap(p, 20);
await box(p);
await checkBox(p, "Dùng thử miễn phí", true);
s = await box(p);
check(ok(s) && Number(s.hours) <= tHours && /dùng thử/.test(s.submit), `trial from ${longest} giờ: duration cut to ${s.hours} giờ, box OK, “${s.submit}”`);
await setCap(p, tMax + 10);
s = await box(p);
check(!s.stuck && /Dùng thử tối đa/.test(s.error) && !s.submitEnabled, `trial with ${tMax + 10} seats: “${s.error.slice(0, 45)}”, submit off`);
await setCap(p, tMax);
s = await box(p);
check(ok(s) && s.submitEnabled, `trial with ${tMax} seats: normal`);
await p.screenshot({ path: `${OUT}/create-trial.png`, fullPage: true });

// many fast changes: the box shows the LAST value (late answers ignored)
await checkBox(p, "Dùng thử miễn phí", false);
for (const v of [3, 17, 9, 44, 12, 8]) await setCap(p, v);
s = await box(p);
check(ok(s) && Number(s.total) === 8 + Math.floor(8 * ratio), `fast typing 3→…→8: box shows 8 seats (${s.total} slot)`);

// signed out in another tab: an error, not an endless wait
const cookies = await p.cookies();
await p.deleteCookie(...cookies);
await setCap(p, 11);
s = await box(p);
check(!s.stuck && s.error.length > 0 && !s.submitEnabled, `session lost: “${s.error.slice(0, 50)}”, submit off`);
await p.setCookie(...cookies);
await setCap(p, 12);
s = await box(p);
check(ok(s), "signed in again: normal");

// ---------- create every kind of room ----------
async function create(pg, setup) {
  await openNew(pg);
  await setup(pg);
  const st = await box(pg);
  await Promise.all([pg.waitForNavigation({ timeout: 30000 }).catch(() => null), pg.click("form button.btn.primary")]);
  await sleep(500);
  return { url: pg.url(), st };
}
let r = await create(p, async (pg) => {
  await typeInto(pg, "Tên phòng", "Phòng dùng thử");
  await setCap(pg, 10);
  await checkBox(pg, "Dùng thử miễn phí", true);
});
check(/\/room\//.test(r.url), `create trial → straight into the room (${r.url.replace(BASE, "")})`);

r = await create(p, async (pg) => {
  await typeInto(pg, "Tên phòng", "Phòng trả phí");
  await setCap(pg, 30);
  await duration(pg, 12);
});
check(/\/orders\//.test(r.url), `create paid 30 chỗ / 12 giờ → order page (${r.url.replace(BASE, "")})`);

r = await create(p, async (pg) => {
  await typeInto(pg, "Tên phòng", "Phòng mã ASDFG");
  await clickText(pg, ".choice", "Vào từ cổng");
  await checkBox(pg, "Hiện phòng trên trang chủ", false);
  await typeInto(pg, "Mật mã phòng", "9999");
  await clickText(pg, ".choice", "Đơn sắc");
  await pg.$eval('input[type="datetime-local"]', (el) => {
    const d = new Date(Date.now() + 3 * 86400_000);
    const v = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await pg.type('input[aria-label="Mã giảm giá"]', "ASDFG");
  await clickText(pg, "button", "Áp dụng");
});
check(/\/room\//.test(r.url), `create with ASDFG (0 ₫) → straight into the room`);
const id = r.url.match(/room\/([0-9a-f-]+)/)?.[1];
const mine = (await api(p, "/api/rooms/mine")).json;
const room = (mine.rooms ?? mine).find?.((x) => x.id === id);
check(room && room.entry_mode === "gate_entry" && room.is_public === false && room.stage_style === "plain" && room.scheduled_at, `options stored: gate entry, private, Đơn sắc, scheduled (${room ? [room.entry_mode, room.is_public, room.stage_style, !!room.scheduled_at].join(", ") : "room not found"})`);
const join = await api(p, `/api/rooms/${id}`);
check(join.status === 200, "room readable after creation");

r = await create(p, async (pg) => {
  await typeInto(pg, "Tên phòng", "Phòng vô thời hạn");
  await duration(pg, "open");
});
check(/\/orders\//.test(r.url) && (await p.evaluate(() => /cọc|1\.000\.000/.test(document.body.textContent))), `create open-ended → deposit order page`);

console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
