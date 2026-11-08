import puppeteer from "puppeteer-core";
import { orb } from "./orb.mjs";
/**
 * YouTube on the stage, real Chrome + real YouTube videos:
 *  - owner builds a playlist (titles + lengths come from the server), reorders, removes;
 *  - 🔁 loop: a 19 s video starts again from 0 by itself;
 *  - ⏭ next: when it ends the next video starts — for the owner AND a guest, same moment;
 *    "Video tiếp" skips; ⏹ stop: nothing happens at the end.
 * Needs a DEMO server and internet (youtube.com). Lite graphics to keep the CPU low.
 *   BASE=http://localhost:3100 node scripts/e2e-youtube.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const SHORT = "jNQXAC9IVRw"; // "Me at the zoo", 19 s
const LONG = "dQw4w9WgXcQ"; // 3:33
const THIRD = "aqz-KE-bpKQ"; // 10:35
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 240000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const errors = [];
async function page(vp = { width: 1280, height: 800 }) {
  const p = await (await browser.createBrowserContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.setViewport(vp);
  await p.evaluateOnNewDocument(() => localStorage.setItem("ao-gfx", "lite"));
  return p;
}
const owner = await page();
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
const room = await owner.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ phòng", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 50 }) });
  return (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Phòng chiếu YouTube", description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 20, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "", stageStyle: "plain", initialScreen: { kind: "text", text: "Sắp chiếu" } } }) })).json();
});
await owner.goto(`${BASE}/room/${room.roomId}`, { waitUntil: "networkidle0" });
await owner.waitForSelector(".orb", { timeout: 90000 });
await sleep(2000);
await orb(owner, "control");
await owner.waitForSelector(".side-panel");
const panel = (fn, arg) => owner.evaluate(fn, arg);
await panel(() => {
  document.querySelector('[name="host-content-type"][value="youtube"]').click();
});
await owner.waitForSelector(".yt-panel");
const addLinks = async (text) => {
  await owner.type('.yt-panel input[aria-label="Link YouTube"]', text);
  await owner.keyboard.press("Enter");
  await sleep(300);
};
const listItems = () => owner.$$eval(".yt-list li .yt-t", (els) => els.map((e) => e.textContent ?? ""));
const clickBtn = (text) => owner.evaluate((t) => [...document.querySelectorAll(".side-panel button")].find((b) => b.textContent?.includes(t) && !b.disabled)?.click(), text);
const status = () => owner.evaluate(() => document.querySelector(".side-panel .notice")?.textContent ?? "");
/** Server truth, the same for everyone. */
const screenOf = (p) => p.evaluate(async (id) => {
  const r = await fetch(`/api/rooms/${id}`);
  const j = await r.json();
  const st = j.room?.screen_state ?? null;
  return typeof st === "string" ? JSON.parse(st) : st;
}, room.roomId);
const iframeId = (p) => p.evaluate(() => [...document.querySelectorAll("iframe")].map((f) => f.src).find((s) => s.includes("youtube"))?.match(/embed\/([A-Za-z0-9_-]{11})/)?.[1] ?? null);

// ---- playlist editing
await addLinks(`https://youtu.be/${SHORT} https://www.youtube.com/watch?v=${LONG}`);
await addLinks(`https://www.youtube.com/watch?v=${THIRD}`);
await addLinks(`https://youtu.be/${SHORT}`); // duplicate
check((await owner.evaluate(() => document.querySelector(".yt-panel small")?.textContent ?? "")).includes("đã có"), "duplicate link refused (“đã có trong danh sách”)");
await addLinks("not a link");
check((await owner.evaluate(() => document.querySelector(".yt-panel small")?.textContent ?? "")).includes("không hợp lệ"), "bad link refused");
await owner.click('.yt-panel input[aria-label="Link YouTube"]', { clickCount: 3 });
await owner.keyboard.press("Backspace");
let items = [];
for (let k = 0; k < 20; k++) {
  items = await listItems();
  if (items.length === 3 && items.every((t) => /·/.test(t))) break;
  await sleep(700);
}
check(items.length === 3 && items.every((t) => /·\s*\d+:\d\d/.test(t)), `3 videos with title + length from the server (${items.map((t) => t.slice(0, 28)).join(" | ")})`);
await owner.evaluate(() => document.querySelector('[aria-label="Xoá video 3"]')?.click());
await sleep(200);
check((await listItems()).length === 2, "remove works");
await owner.screenshot({ path: `${OUT}/yt-owner-playlist.png` });

// ---- 🔁 loop: the 19 s video restarts by itself
await clickBtn("Chiếu lặp lại");
await clickBtn("Hiển thị video đầu tiên");
await sleep(800);
await clickBtn("▶ Phát");
const guest = await page();
await guest.goto(`${BASE}/join/${room.inviteCode}`, { waitUntil: "networkidle0" });
await guest.type("form input[maxlength='60']", "Khách xem");
await guest.click("form button.btn.primary");
await guest.waitForSelector(".orb", { timeout: 90000 });
await sleep(4000);
let st = await status();
check(/lặp lại/.test(st) && /đang phát/.test(st), `loop on, playing (“${st.trim()}”)`);
const rev0 = (await screenOf(owner))?.rev;
await sleep(24000); // 19 s video + margin
let sv = await screenOf(owner);
check(sv && sv.rev > rev0 && sv.playing && sv.content.videoId === SHORT && sv.positionSec < 2, `after 24 s the video started again from 0 (rev ${rev0} → ${sv?.rev}, pos ${sv?.positionSec})`);
check((await iframeId(guest)) === SHORT, "guest still plays the same video");

// ---- ⏭ next: SHORT → LONG for everyone (from the start, so the switch is not at the very end)
await clickBtn("Về đầu");
await sleep(500);
await clickBtn("Chiếu tiếp danh sách");
await sleep(600);
st = await status();
check(/danh sách 1\/2/.test(st), `switched live to “next”, no restart (“${st.trim()}”)`);
sv = await screenOf(owner);
check(sv.content.endMode === "next" && sv.content.playlist?.length === 2 && sv.playing, "server has the playlist and keeps playing");
await sleep(24000);
sv = await screenOf(owner);
check(sv.content.videoId === LONG && sv.content.index === 1 && sv.playing && sv.positionSec < 2, `video ended → next one starts (${sv.content.videoId}, ${sv.content.index + 1}/2)`);
let gid = null;
for (let k = 0; k < 20 && gid !== LONG; k++) {
  await sleep(500);
  gid = await iframeId(guest);
}
check(gid === LONG, `guest switched to the next video too (${gid})`);
check(/danh sách 2\/2/.test(await status()), "owner panel shows 2/2");
await guest.screenshot({ path: `${OUT}/yt-guest-next.png` });

// ---- Video tiếp: skip → back to the first (wraps)
await clickBtn("Video tiếp");
await sleep(1000);
sv = await screenOf(owner);
check(sv.content.videoId === SHORT && sv.content.index === 0 && sv.playing, "“Video tiếp” after the last → first video again");

// ---- ⏹ stop: nothing happens at the end
await clickBtn("Dừng lại");
await sleep(600);
const revStop = (await screenOf(owner)).rev;
await sleep(24000);
sv = await screenOf(owner);
check(sv.content.videoId === SHORT && !sv.playing && Math.abs(sv.positionSec - 19) < 1.5, `stop: at the end it stays on the same video, paused at 0:19 (playing=${sv.playing}, pos ${sv.positionSec})`);
check(/tạm dừng/.test(await status()), `owner panel says “tạm dừng” (“${(await status()).trim()}”)`);
await owner.screenshot({ path: `${OUT}/yt-owner-stop.png` });

// ---- guests have no playlist controls and no orb "Điều khiển"
check(!(await guest.$(".yt-panel")) && !(await guest.$('[data-orb="control"]')), "guest has no playlist / control buttons");

console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
