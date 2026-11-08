import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';

// Check decoded UTF-8 source, independently of the Windows terminal code page.
async function checkEncoding(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await checkEncoding(path);
    else if (/\.(tsx?|css|json)$/.test(path)) assert.ok(!/Ã|á»|áº|Ä|â€|ðŸ|\uFFFD/.test(await readFile(path, 'utf8')), `mojibake in ${path}`);
  }
}
await checkEncoding('src');

const base = 'http://localhost:3100';
assert.equal((await (await fetch(base + '/api/me')).json()).mode, 'demo');
const out = 'docs/screenshots/ui/after';
await mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const report = [];
try {
  for (const width of [390, 1440]) for (const theme of ['dark', 'light']) {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.setViewport({ width, height: width === 390 ? 844 : 900 });
      await page.evaluateOnNewDocument(t => localStorage.setItem('ao-theme', t), theme);
      await page.goto(base + '/login', { waitUntil: 'networkidle0' });
      const fixtureName = 'Kiểm tra giao dịch';
      await page.evaluate(async displayName => {
        await fetch('/api/auth/demo-login', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ displayName, asAppOwner: true }) });
        await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 100 }) });
      }, fixtureName);
      await page.goto(base + '/rooms/new', { waitUntil: 'networkidle0' });
      await page.waitForSelector('.room-flow');
      assert.equal(await page.evaluate(async () => (await (await fetch('/api/me')).json()).user.displayName), fixtureName);
      await page.screenshot({ path: `${out}/header-${width}-${theme}.png` });
      await page.click('[aria-label="Mở menu tài khoản"]');
      assert.ok(await page.$eval('dialog[open]', el => el.textContent.includes('Kiểm tra giao dịch')));
      await page.screenshot({ path: `${out}/header-user-${width}-${theme}.png` });
      await page.keyboard.press('Escape');
      if (width === 390) {
        await page.click('[aria-label="Mở điều hướng"]');
        assert.ok(await page.$('dialog[open] nav'));
        await page.screenshot({ path: `${out}/header-menu-${width}-${theme}.png` });
        await page.keyboard.press('Escape');
      }
      await page.type('[data-step="0"] input[type="text"]', 'Đêm nhạc mùa thu');
      await page.type('textarea', 'Không gian gặp gỡ và âm nhạc');
      for (let step = 0; step < 4; step++) {
        await page.waitForFunction(() => !document.querySelector('.room-total').textContent.includes('Đang tính'));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow ${width} ${theme} step ${step + 1}`);
        await page.screenshot({ path: `${out}/rooms-new-step-${step + 1}-${width}-${theme}.png`, fullPage: true });
        if (step < 3) await page.evaluate(() => [...document.querySelectorAll('.room-actions button')].find(b => b.textContent === 'Tiếp tục').click());
      }
      if (width === 390) {
        await page.click('.room-total');
        assert.ok(await page.$eval('#room-summary', el => getComputedStyle(el).display !== 'none'));
        await page.screenshot({ path: `${out}/rooms-new-summary-${width}-${theme}.png`, fullPage: true });
        await page.click('.room-total');
      }
      // The exact pre-redesign default payload, including every field and screen normalization.
      const quote = await page.evaluate(async () => {
        const catalog = await (await fetch('/api/catalog')).json();
        return { hours: catalog.durationOptions[0], map: catalog.maps.find(m => m.enabled).code };
      });
      let captured;
      await page.setRequestInterception(true);
      page.on('request', req => {
        if (req.url() === base + '/api/rooms' && req.method() === 'POST') {
          captured = JSON.parse(req.postData());
          req.respond({ status: 200, contentType: 'application/json', body: '{"orderId":"payload-check"}' });
        } else if (req.isNavigationRequest() && req.url().endsWith('/orders/payload-check')) {
          req.respond({ status: 200, contentType: 'text/html', body: '<p>Payload captured</p>' });
        } else req.continue();
      });
      await page.click('button[type="submit"]');
      await page.waitForFunction(() => location.pathname === '/orders/payload-check');
      assert.deepEqual(captured, {
        config: { name: 'Đêm nhạc mùa thu', description: 'Không gian gặp gỡ và âm nhạc', map: quote.map, avatarGroups: ['people'], officialCapacity: 20, waitingEnabled: true, entryMode: 'auto_assign', durationHours: quote.hours, openEnded: false, isPublic: true, password: '', initialScreen: { kind: 'text', text: 'Chào mừng đến với phòng!' }, scheduledAt: null, stageStyle: 'glam' }, useTrial: false,
      });
      assert.deepEqual(errors, []);
      await page.goto(base + '/styleguide', { waitUntil: 'networkidle0' });
      assert.ok(await page.$eval('fieldset', el => { const probe = document.createElement('div'); probe.style.color = 'var(--border)'; el.append(probe); const ok = getComputedStyle(el).borderTopColor === getComputedStyle(probe).color; probe.remove(); return ok; }));
      await page.screenshot({ path: `${out}/styleguide-${width}-${theme}.png`, fullPage: true });
      report.push({ width, theme, errors, overflow: false, utf8Fixture: fixtureName, payload: captured, steps: 4, headerMenus: 'pass', fieldset: 'token border' });
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(`${out}/t3-report.json`, JSON.stringify(report, null, 2));
console.log('PASS: 16 step screenshots, header menus, UTF-8 fixture, exact payloads, overflow and fieldset in both themes/sizes');
