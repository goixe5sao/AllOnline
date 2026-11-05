import puppeteer from "puppeteer-core";
/**
 * "Siêu đẹp" graphics (bloom): screenshot, then the frame-rate watchdog must fall back to
 * "Đầy đủ" on a slow device (headless software rendering is always slow).
 *   BASE=http://localhost:3100 node scripts/shoot-ultra.mjs <outDir>
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
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
const rooms = await owner.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ phòng", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 50 }) });
  const out = [];
  for (const map of ["hall", "drive_in"]) {
    const groups = map === "drive_in" ? ["vehicles"] : ["people"];
    out.push(await (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Đêm nhạc Tương Lai", description: "", map, avatarGroups: groups, officialCapacity: 20, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "", stageStyle: "glam", initialScreen: { kind: "text", text: "Đêm nhạc Tương Lai ✨" } } }) })).json());
  }
  return out;
});
for (const [i, map] of ["hall", "drive_in"].entries()) {
  const g = await (await browser.createBrowserContext()).newPage();
  g.on("pageerror", (e) => errors.push(e.message));
  await g.setViewport(vp);
  await g.evaluateOnNewDocument(() => localStorage.setItem("ao-gfx", "ultra"));
  await g.goto(`${BASE}/join/${rooms[i].inviteCode}`, { waitUntil: "networkidle0" });
  await g.type("form input[maxlength='60']", "Khách " + map);
  await g.click("form button.btn.primary");
  await g.waitForSelector(".orb", { timeout: 90000 });
  await sleep(3500);
  await g.screenshot({ path: `${OUT}/stage-ultra-${map}.png` });
  if (i === 0) {
    // watchdog: software rendering is far below 32 fps → back to "Đầy đủ" with a note
    let gfx = "ultra";
    for (let k = 0; k < 40 && gfx === "ultra"; k++) {
      await sleep(1500);
      gfx = await g.evaluate(() => localStorage.getItem("ao-gfx"));
    }
    check(gfx === "full", `slow device falls back to “Đầy đủ” (${gfx})`);
    const note = await g.evaluate(() => [...document.querySelectorAll(".status-card")].map((e) => e.textContent).join(" | "));
    check(/Siêu đẹp/.test(note), `viewer is told why (${note.slice(0, 80)})`);
  }
  await g.close();
}
console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
