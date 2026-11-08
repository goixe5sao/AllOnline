import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';

// Same headless Chrome tooling as the existing screenshot scripts. Never opens
// multiple contexts; each 3D route gets exactly one screenshot, then closes.
const base = 'http://localhost:3100';
const phase = process.argv[2] ?? 'before';
if (!['before','styleguide','verify'].includes(phase)) throw new Error('Expected before, styleguide or verify');
const mode = await (await fetch(base + '/api/me')).json();
if (mode.mode !== 'demo') throw new Error('UI audit requires a demo server');
const out = `docs/screenshots/ui/${phase === 'before' ? 'before/' : ''}`;
await mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], protocolTimeout: 60000 });
const report = [];
let cookie;
let fixture;
try {
  if (phase !== 'styleguide') {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.goto(base + '/login', { waitUntil: 'networkidle0' });
  fixture = await page.evaluate(async () => {
    const api = async (path, body) => {
      const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json(); if (!r.ok) throw new Error(JSON.stringify(data)); return data;
    };
    await api('/api/auth/demo-login', { displayName: 'Kiểm tra giao diện', asAppOwner: true });
    await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 100 }) });
    const config = { name: 'Đêm nhạc mùa thu', description: 'Không gian gặp gỡ và âm nhạc', map: 'hall', avatarGroups: ['people'], officialCapacity: 20, waitingEnabled: false, entryMode: 'auto_assign', durationHours: 6, password: '' };
    const room = await api('/api/rooms', { useTrial: true, config });
    const order = await api('/api/rooms', { useTrial: false, config });
    return { room, order };
  });
  cookie = await context.cookies();
  await context.close();
  }
  const routes = phase === 'before' ? [ ['login','/login'], ['account','/account'], ['rooms-new','/rooms/new'], ['orders','/orders'], ['order',`/orders/${fixture.order.orderId}`], ['admin','/admin'], ['join',`/join/${fixture.room.inviteCode}`], ['logs',`/room/${fixture.room.roomId}/logs`], ['home','/'], ['room',`/room/${fixture.room.roomId}`] ] : phase === 'styleguide' ? [['styleguide','/styleguide']] : [['login','/login'], ['account','/account'], ['rooms-new','/rooms/new'], ['orders','/orders'], ['order',`/orders/${fixture.order.orderId}`], ['admin','/admin'], ['join',`/join/${fixture.room.inviteCode}`], ['logs',`/room/${fixture.room.roomId}/logs`]];
  for (const [name, route] of routes) {
    const scene = ['home','room'].includes(name);
    for (const width of scene ? [390] : [390,1440]) for (const theme of phase !== 'before' ? ['dark','light'] : ['dark']) {
      const context = await browser.createBrowserContext();
      try {
        if (name !== 'login' && cookie) await context.setCookie(...cookie);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        await page.setViewport({ width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1 });
        await page.evaluateOnNewDocument(theme => { localStorage.setItem('ao-theme',theme); localStorage.setItem('ao-gfx','lite'); }, theme);
        const response = await page.goto(base + route, { waitUntil: scene ? 'domcontentloaded' : 'networkidle0', timeout: 60000 });
        if (scene) await page.waitForSelector(name === 'room' ? '.hud-top' : 'h1', { timeout: 60000 });
        else await page.waitForFunction(() => ![...document.querySelectorAll('main p.muted')].some(p => p.textContent === 'Đang tải…'));
        if (phase !== 'verify') await page.screenshot({ path: `${out}${name}-${width}-${theme}.png`, fullPage: !scene });
        if (phase === 'styleguide') {
          const check = (ok, message) => { if (!ok) throw new Error(message); };
          await page.click('[role="tab"]');
          await page.keyboard.press('ArrowRight');
          check(await page.$eval('[role="tab"][aria-selected="true"]', e => e.textContent === 'Khách mời'), 'Tab arrow navigation');
          await page.click('input[type="checkbox"]');
          check(await page.$eval('input[type="checkbox"]', e => !e.checked), 'Checkbox toggles');
          await page.click('input[type="radio"][value="meeting"]');
          check(await page.$eval('input[value="meeting"]', e => e.checked), 'Radio card selects');
          const trigger = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Mở hộp thoại'));
          await trigger.asElement().click();
          await page.waitForSelector('dialog[open]');
          await page.screenshot({ path: `${out}styleguide-modal-${width}-${theme}.png` });
          check(await page.$eval('dialog', e => e.contains(document.activeElement)), 'Dialog receives focus');
          for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); check(await page.$eval('dialog', e => e.contains(document.activeElement)), 'Dialog traps focus'); }
          await page.keyboard.press('Escape');
          check(!(await page.$('dialog[open]')), 'Escape closes dialog');
          check(await page.evaluate(() => document.activeElement.textContent === 'Mở hộp thoại'), 'Dialog restores focus');
          await page.setViewport({ width: 360, height:844 });
          check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '360px no overflow');
          await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
          check(await page.$eval('.ui-skeleton', e => getComputedStyle(e).animationName === 'none'), 'Reduced motion');
          await page.click('button[aria-label^="Chuyển sang"]');
          check(await page.evaluate(t => document.documentElement.dataset.theme !== t && localStorage.getItem('ao-theme') !== t, theme), 'Theme switches and persists');
        }
        report.push({ name, width, theme, status: response.status(), errors, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), ...(phase === 'styleguide' ? { interactions: 'PASS: tabs/arrows, checkbox, radio, modal focus/trap/Escape/restore, 360px, reduced motion, persisted theme' } : {}) });
        await page.close();
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); }
await writeFile(`${out}${phase}-report.json`, JSON.stringify({ fixture, report }, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.some(r => r.status !== 200 || r.errors.length || (phase === 'styleguide' && r.overflow))) process.exitCode = 1;
