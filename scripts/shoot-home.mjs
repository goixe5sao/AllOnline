import puppeteer from "puppeteer-core";
/**
 * Home page screenshots on desktop / tablet / phone (real headless Chrome), the Open Graph
 * image (public/og.png, 1200×630 crop of the hero) and a quick SEO sanity check of the HTML.
 *   BASE=http://localhost:3100 node scripts/shoot-home.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);

// SEO: the server HTML (no JavaScript) must already contain the content.
const html = await (await fetch(BASE + "/")).text();
check(/<title>[^<]*Sân khấu 3D[^<]*<\/title>/.test(html), "title in server HTML");
check(/<meta name="description" content="[^"]{80,}/.test(html), "meta description");
check(/<link rel="canonical" href="https?:\/\/[^"]+"/.test(html), "canonical link");
check(html.includes('property="og:image"'), "Open Graph image");
check(html.includes("application/ld+json") && html.includes('"FAQPage"'), "JSON-LD (WebSite, WebApplication, FAQPage)");
check((html.match(/<h1[\s>]/g) ?? []).length === 1, "exactly one h1");
check(html.includes("Phòng đang mở") && html.includes("/join/"), "public rooms rendered on the server");
const robots = await (await fetch(BASE + "/robots.txt")).text();
check(robots.includes("Sitemap:") && robots.includes("Disallow: /admin"), "robots.txt");
const sitemap = await (await fetch(BASE + "/sitemap.xml")).text();
check(sitemap.includes("<urlset") && sitemap.includes("/join/"), "sitemap.xml lists public rooms");

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 120000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
for (const [name, w, h, mobile] of [
  ["desktop", 1440, 900, false],
  ["tablet", 820, 1180, true],
  ["mobile", 390, 844, true],
]) {
  const p = await (await browser.createBrowserContext()).newPage();
  p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`${name} console: ${m.text()}`));
  await p.setViewport({ width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await p.goto(BASE + "/", { waitUntil: "networkidle0" });
  await sleep(1200);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `${name}: no horizontal scroll (${overflow}px)`);
  await p.screenshot({ path: `${OUT}/home-${name}.png` });
  await p.screenshot({ path: `${OUT}/home-${name}-full.png`, fullPage: true });
  if (name === "desktop" || name === "mobile") {
    // slides on the stage screen + house lights
    const tab = (label) => p.evaluate((l) => [...document.querySelectorAll(".st-tabs button")].find((b) => b.textContent?.startsWith(l))?.click(), label);
    await tab("Phòng đang mở");
    await sleep(900);
    check(await p.evaluate(() => document.querySelector("#phong-dang-mo")?.classList.contains("on")), `${name}: rooms slide opens from its tab`);
    await p.screenshot({ path: `${OUT}/home-${name}-slide-rooms.png` });
    await tab("Kiểu sân khấu");
    await sleep(900);
    await p.screenshot({ path: `${OUT}/home-${name}-slide-types.png` });
    await p.click(".lsw");
    await sleep(1200);
    check(await p.evaluate(() => document.querySelector(".theater")?.classList.contains("lights-on")), `${name}: light switch turns the house lights on`);
    await p.screenshot({ path: `${OUT}/home-${name}-lights-on.png` });
    await p.click(".lsw");
    await tab("Giới thiệu");
    await sleep(900);
    await p.evaluate(() => document.querySelector("#quay-ve")?.scrollIntoView());
    await sleep(600);
    await p.screenshot({ path: `${OUT}/home-${name}-lobby.png` });
    await p.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);

    // site theme: light (☀ in the header), remembered after a reload, then back to dark
    await p.click(".hn-theme");
    await sleep(900);
    check(await p.evaluate(() => document.documentElement.dataset.theme === "light"), `${name}: header button switches the site to the light theme`);
    await p.screenshot({ path: `${OUT}/home-${name}-light.png` });
    await p.click(".lsw");
    await sleep(1000);
    await p.screenshot({ path: `${OUT}/home-${name}-light-lights-on.png` });
    await p.click(".lsw");
    await p.evaluate(() => document.querySelector("#quay-ve")?.scrollIntoView());
    await sleep(600);
    await p.screenshot({ path: `${OUT}/home-${name}-light-lobby.png` });
    await p.reload({ waitUntil: "networkidle0" });
    check(await p.evaluate(() => document.documentElement.dataset.theme === "light"), `${name}: light theme is remembered after reload`);
    if (name === "desktop") {
      await p.goto(BASE + "/login", { waitUntil: "networkidle0" });
      check(await p.evaluate(() => getComputedStyle(document.body).backgroundColor === "rgb(246, 247, 244)"), "other pages follow the light theme");
      await p.screenshot({ path: `${OUT}/login-light.png` });
      await p.click(".theme-toggle");
      await sleep(400);
      check(await p.evaluate(() => getComputedStyle(document.body).backgroundColor === "rgb(16, 22, 20)"), "other pages switch to dark with their own button");
      await p.screenshot({ path: `${OUT}/login-dark.png` });
      await p.goto(BASE + "/", { waitUntil: "networkidle0" });
    } else {
      await p.click(".hn-theme");
    }
    await sleep(400);
    await p.evaluate(() => window.scrollTo(0, 0));
  }
  if (name === "mobile") {
    await p.click(".hn-burger");
    await sleep(300);
    await p.screenshot({ path: `${OUT}/home-mobile-menu.png` });
  }
  if (name === "desktop") {
    await p.setViewport({ width: 1200, height: 630 });
    await sleep(500);
    await p.screenshot({ path: "public/og.png" });
  }
  await p.close();
}

// Signed-in member: "Phòng của tôi" with the visibility switch.
const m = await (await browser.createBrowserContext()).newPage();
await m.setViewport({ width: 1440, height: 900 });
await m.goto(BASE + "/login", { waitUntil: "networkidle0" });
await m.evaluate(async () => {
  // Demo login makes a fresh account each time → give it a room of its own first.
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "MsMai", asAppOwner: true }) });
  await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ useTrial: true, config: { name: "Phòng riêng của tôi", description: "", map: "carpet", avatarGroups: ["people"], officialCapacity: 10, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "" } }),
  });
});
await m.goto(BASE + "/#phong-dang-mo", { waitUntil: "networkidle0" });
await m.waitForSelector(".mr", { timeout: 20000 });
await m.evaluate(() => document.querySelector("#my-rooms-h")?.scrollIntoView());
await sleep(800);
await m.screenshot({ path: `${OUT}/home-signed-in.png` });
check(await m.evaluate(() => !!document.querySelector(".mr-toggle input")), "member sees “Hiện trên trang chủ” switch on own rooms");

console.log("errors:", errors.length ? errors : "none");
await browser.close();
process.exit(failed ? 1 : 0);
