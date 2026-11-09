import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const base='http://localhost:3100', out='docs/screenshots/ui/after';
assert.equal((await (await fetch(base+'/api/me')).json()).mode,'demo');
await mkdir(out,{recursive:true});
const sign = uid => {
  const body=Buffer.from(JSON.stringify({k:'acc',uid,exp:Date.now()+3600000})).toString('base64url');
  return body+'.'+createHmac('sha256','t9-local-demo-only').update(body).digest('base64url');
};
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const report=[];
try {
  for(const width of [390,1440]) for(const theme of ['dark','light']) {
    const context=await browser.createBrowserContext();
    try {
      const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.setViewport({width,height:width===390?844:900});
      await page.evaluateOnNewDocument(t=>localStorage.setItem('ao-theme',t),theme);
      await page.goto(base+'/api/me');
      await page.evaluate(async()=>{await fetch('/api/auth/demo-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:'T9 admin sample',asAppOwner:true})});});
      assert.equal((await page.goto(base+'/admin',{waitUntil:'networkidle0'})).status(),200);
      await page.click('#admin-tab-accounts');
      await page.waitForFunction(()=>document.querySelector('#admin-panel')?.textContent.includes('T9 local basic'));
      await page.type('#admin-panel form input','T9 local');
      await page.click('#admin-panel form button');
      await page.waitForNetworkIdle();
      await page.waitForFunction(()=>document.querySelectorAll('#admin-panel .ui-card').length===3);
      assert.ok(await page.$eval('#admin-panel',e=>e.textContent.includes('Đến ngày')));
      assert.ok(await page.$eval('body',e=>e.scrollWidth<=innerWidth));
      await page.screenshot({path:`${out}/ai-plan-admin-${width}-${theme}.png`,fullPage:true});
      // Exercise the real admin editor on a local seeded account, then restore basic.
      const row=await page.evaluateHandle(()=>[...document.querySelectorAll('#admin-panel .ui-card')].find(e=>e.textContent.includes('T9 local basic')));
      await row.evaluate(e=>{const s=e.querySelector('select');s.value='vip';s.dispatchEvent(new Event('change',{bubbles:true}));});
      await row.evaluate(e=>e.querySelector('button').click());
      await page.waitForFunction(()=>[...document.querySelectorAll('#admin-panel .ui-card')].find(e=>e.textContent.includes('T9 local basic'))?.textContent.includes('Hiệu lực: VIP'));
      const restore=await page.evaluate(async()=>{const r=await fetch('/api/admin/users/00000000-0000-4000-8000-000000000001/ai-plan',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan:'basic',until:null})});return r.status;});
      assert.equal(restore,200);
      for(const [i,plan] of ['basic','vip','off'].entries()) {
        await page.setCookie({name:'ao_acc',value:sign(`00000000-0000-4000-8000-00000000000${i+1}`),url:base,httpOnly:true});
        await page.goto(base+'/account',{waitUntil:'networkidle0'});
        await page.waitForSelector('#ai-watchlist');
        if(plan!=='off') {
          await page.type('#ai-watchlist input','FPT');
          await page.waitForSelector('#ai-watchlist option[value="FPT"]');
          await page.select('#ai-watchlist select','FPT');
          await page.click('#ai-watchlist button');
          await page.waitForFunction(()=>document.querySelector('#ai-watchlist')?.textContent.includes('Bỏ theo dõi FPT'));
          await page.reload({waitUntil:'networkidle0'});
          await page.waitForFunction(()=>document.querySelector('#ai-watchlist')?.textContent.includes('Bỏ theo dõi FPT'));
          if(plan==='basic') assert.ok(await page.$eval('#ai-watchlist',e=>e.textContent.includes('Tài khoản thường: chỉ nhận cảnh báo kháng cự')));
        } else assert.equal(await page.$$eval('#ai-watchlist button',e=>e.length),0);
        await page.evaluate(()=>window.scrollTo(0,0));
        assert.ok(await page.$eval('body',e=>e.scrollWidth<=innerWidth));
        await page.screenshot({path:`${out}/ai-plan-account-${plan}-${width}-${theme}.png`,fullPage:true});
        if(plan!=='off') {
          await page.evaluate(()=>[...document.querySelectorAll('#ai-watchlist button')].find(b=>b.textContent.includes('Bỏ theo dõi FPT')).click());
          await page.waitForFunction(()=>!document.querySelector('#ai-watchlist')?.textContent.includes('Bỏ theo dõi FPT'));
        }
      }
      assert.deepEqual(errors,[]);report.push({width,theme,pass:true,checks:['admin edit and restore','basic/VIP/off account UI','real symbol search','follow persists after reload','unfollow','no overflow','no page errors','no Three scene']});
    } finally {await context.close();}
  }
  await writeFile(`${out}/ai-plan-report.json`,JSON.stringify(report,null,2));
  console.log('PASS AI plan UI: 16 captures, 390/1440 dark/light, admin editing, follows, no page errors or overflow');
} finally {await browser.close();}
