// Screenshot the live public pages (after a deploy/migration) into docs/screenshots/vps/.
// Usage: node scripts/shoot-live-pages.mjs [base=https://sankhau.pro.vn]
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const base = process.argv[2] ?? "https://sankhau.pro.vn";
const stock = base.replace("://", "://stockvn.");
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const out = "docs/screenshots/vps";
fs.mkdirSync(out, { recursive: true });
const pages = [
  ["home", `${base}/`],
  ["login", `${base}/login`],
  ["stockvn-login", `${stock}/login`],
];
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--use-angle=swiftshader", "--mute-audio"] });
try {
  for (const [name, url] of pages) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 800 });
    const t = Date.now();
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 6000));
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`${res?.status()} ${Date.now() - t}ms ${url} -> ${out}/${name}.png`);
    await page.close();
  }
} finally {
  await browser.close();
}
