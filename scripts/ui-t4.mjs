import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';

const base = 'http://localhost:3100';
assert.equal((await (await fetch(base + '/api/me')).json()).mode, 'demo');
const out = 'docs/screenshots/ui/after';
await mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = [];
try {
  for (const width of [390, 1440]) for (const theme of ['dark', 'light']) {
    const context = await browser.createBrowserContext();
    try {
      await context.overridePermissions(base, ['clipboard-read', 'clipboard-sanitized-write']);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.setViewport({ width, height: width === 390 ? 844 : 900 });
      await page.evaluateOnNewDocument(t => localStorage.setItem('ao-theme', t), theme);
      const capture = async name => {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow: ${name}/${width}/${theme}`);
        await page.screenshot({ path: `${out}/${name}-${width}-${theme}.png`, fullPage: true });
      };
      await page.goto(base + '/login?next=/account', { waitUntil: 'networkidle0' });
      await capture('login');
      await page.click('[role=tab]:nth-child(2)');
      const request = page.waitForRequest(r => r.url().endsWith('/api/auth/zalo/code') && r.method() === 'POST');
      await page.click('.zalo-box button.zalo-btn');
      assert.deepEqual(JSON.parse((await request).postData()), {});
      await page.waitForSelector('.zalo-code code');
      const bot = await page.evaluate(async () => (await (await fetch('/api/catalog')).json()).zaloBot.url);
      assert.equal(await page.$eval('.zalo-steps a.zalo-btn', e => e.href), bot);
      assert.equal(await page.$eval('.auth-qr', e => getComputedStyle(e).display !== 'none'), width === 1440);
      assert.ok(await page.$('.auth-qr svg path'));
      await page.click('.zalo-code button');
      await page.waitForFunction(() => document.querySelector('.zalo-code button').textContent.includes('Đã chép'));
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await page.$eval('.zalo-code code', e => e.textContent));
      await capture('login-zalo');
      await page.click('[role=tab]:first-child');
      await page.type('input[type=text]', 'Khách mời mùa thu');
      await page.click('form button');
      await page.waitForFunction(() => location.pathname === '/account');
      await page.waitForSelector('#bot-sim');
      await page.click('.account-section input[type=text]', { clickCount: 3 });
      await page.type('.account-section input[type=text]', 'Minh Anh');
      await page.click('.account-section form button');
      await page.waitForFunction(() => document.body.textContent.includes('Đã lưu tên.'));
      await capture('account');
      const fixture = await page.evaluate(async () => {
        const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error(JSON.stringify(d)); return d; };
        await post('/api/auth/demo-login', { displayName: 'Người tổ chức', asAppOwner: true });
        await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 100 }) });
        return post('/api/rooms', { useTrial: true, config: { name: 'Đêm nhạc mùa thu', description: 'Gặp gỡ, chia sẻ và tận hưởng những giai điệu cùng nhau.', map: 'tables', avatarGroups: ['animals'], officialCapacity: 10, waitingEnabled: false, entryMode: 'auto_assign', durationHours: 6, isPublic: true, password: '', scheduledAt: Date.now() + 7200000 } });
      });
      assert.ok(fixture.inviteCode);
      await page.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); });
      await page.goto(`${base}/join/${fixture.inviteCode}`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.join-form');
      assert.equal(await page.$eval('.event-host strong', e => e.textContent), 'Người tổ chức');
      assert.ok(await page.$('.event-count'));
      assert.ok(await page.$('a[href$="calendar.ics"]'));
      await capture('join');
      const payloads = [];
      await page.setRequestInterception(true);
      page.on('request', r => {
        const path = new URL(r.url()).pathname;
        if (['/api/guest', '/api/join'].includes(path)) payloads.push({ path, body: JSON.parse(r.postData()) });
        if (r.isNavigationRequest() && path.startsWith('/room/')) r.respond({ status: 200, contentType: 'text/html', body: '<p>Joined</p>' }); else r.continue();
      });
      await page.type('form input[maxlength="60"]', 'Khách Lan');
      await page.click('.join-actions button');
      await page.waitForFunction(() => location.pathname.startsWith('/room/'));
      assert.deepEqual(payloads, [{ path: '/api/guest', body: { displayName: 'Khách Lan' } }, { path: '/api/join', body: { inviteCode: fixture.inviteCode, password: '' } }]);
      assert.deepEqual(errors, []);
      // Render real email forms with a browser-only mode fixture. No live auth requests.
      page.removeAllListeners('request');
      const authPayloads = [];
      page.on('request', r => {
        const path = new URL(r.url()).pathname;
        if (path === '/api/me') r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null, mode: 'supabase' }) });
        else if (['/api/auth/login', '/api/auth/signup'].includes(path)) {
          authPayloads.push({ path, body: JSON.parse(r.postData()) });
          r.respond({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'fixture', message: 'Kiểm tra lại thông tin đăng nhập.' }) });
        } else r.continue();
      });
      await page.goto(base + '/login', { waitUntil: 'networkidle0' });
      await page.waitForSelector('input[type=email]');
      await capture('login-email');
      await page.type('input[type=email]', 'minh@example.com');
      await page.type('input[type=password]', 'example-password');
      await page.click('form button');
      await page.waitForSelector('.auth-form .notice.error');
      assert.deepEqual(authPayloads[0], { path: '/api/auth/login', body: { email: 'minh@example.com', password: 'example-password' } });
      await page.goto(base + '/login?mode=signup', { waitUntil: 'networkidle0' });
      await page.waitForSelector('input[type=email]');
      await capture('login-signup');
      await page.type('form input[type=text]', 'Minh');
      await page.type('input[type=email]', 'minh@example.com');
      await page.type('input[type=password]', 'example-password');
      await page.click('form button');
      await page.waitForSelector('.auth-form .notice.error');
      assert.deepEqual(authPayloads[1], { path: '/api/auth/signup', body: { email: 'minh@example.com', password: 'example-password', displayName: 'Minh' } });
      report.push({ width, theme, errors, overflow: false, botUrl: bot, copy: 'pass', demoLoginAndAccountSave: 'pass', guestJoinPayloads: payloads });
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(`${out}/t4-report.json`, JSON.stringify(report, null, 2));
console.log('PASS: T-4 screenshots, QR, copy, demo login, account save, calendar, guest join payloads in four viewport/theme combinations');
