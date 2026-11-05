import puppeteer from "puppeteer-core";
import { orb, orbLabel } from "./orb.mjs";
/**
 * Alien-future stage on every map + the owner's stage-light switch (seen by guests at once).
 * One browser, few pages at a time (software 3D is heavy on the CPU).
 *   BASE=http://localhost:3100 node scripts/shoot-stage.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 240000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
const vp = { width: 1280, height: 760 };
const owner = await (await browser.createBrowserContext()).newPage();
owner.on("pageerror", (e) => errors.push(e.message));
await owner.setViewport(vp);
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
await owner.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ phòng", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 50 }) });
});
const makeRoom = (map) =>
  owner.evaluate(async (map) => {
    const groups = map === "drive_in" ? ["vehicles"] : ["people"];
    return (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Đêm nhạc Tương Lai", description: "", map, avatarGroups: groups, officialCapacity: 20, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "", stageStyle: "glam", initialScreen: { kind: "text", text: "Đêm nhạc Tương Lai ✨" } } }) })).json();
  }, map);

async function guest(room, name) {
  const g = await (await browser.createBrowserContext()).newPage();
  g.on("pageerror", (e) => errors.push(e.message));
  await g.setViewport(vp);
  await g.goto(`${BASE}/join/${room.inviteCode}`, { waitUntil: "networkidle0" });
  await g.type("form input[maxlength='60']", name);
  await g.click("form button.btn.primary");
  await g.waitForSelector(".orb", { timeout: 90000 });
  await sleep(6000);
  return g;
}

for (const map of ["hall", "carpet", "tables", "drive_in"]) {
  const room = await makeRoom(map);
  check(!!room.inviteCode, `${map}: room created`);
  const g = await guest(room, "Khách " + map);
  await g.screenshot({ path: `${OUT}/stage-${map}.png` });
  console.log("shot", map);
  if (map === "hall") {
    check((await orbLabel(g, "lights")) === null, "guest has no stage-light switch");
    await owner.goto(`${BASE}/room/${room.roomId}`, { waitUntil: "networkidle0" });
    await owner.waitForSelector(".orb", { timeout: 90000 });
    await sleep(5000);
    await owner.screenshot({ path: `${OUT}/stage-hall-owner.png` });
    check((await orbLabel(owner, "lights")) === "Tắt đèn sân khấu", "owner: “Tắt đèn sân khấu” in the orb");
    await orb(owner, "lights");
    await sleep(4000);
    check((await orbLabel(owner, "lights")) === "Bật đèn sân khấu", "owner: switch shows “Bật đèn sân khấu” after turning off");
    await g.screenshot({ path: `${OUT}/stage-hall-lights-off.png` });
    await orb(owner, "lights");
    await sleep(1500);
    await g.screenshot({ path: `${OUT}/stage-hall-lights-coming-on.png` });
    await sleep(4000);
    await g.screenshot({ path: `${OUT}/stage-hall-lights-on-again.png` });
    await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
  }
  await g.close();
}
console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
