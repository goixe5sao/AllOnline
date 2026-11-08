import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base='http://localhost:3100', out='docs/screenshots/ui/after';
assert.equal((await (await fetch(base+'/api/me')).json()).mode,'demo');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const report=[];
try {
for(const width of [390,1440]) for(const theme of ['dark','light']) {
 const context=await browser.createBrowserContext();
 try {
 await context.overridePermissions(base,['clipboard-read','clipboard-sanitized-write']);
 const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width,height:width===390?844:900});
 await page.evaluateOnNewDocument(t=>localStorage.setItem('ao-theme',t),theme);
 await page.goto(base+'/login',{waitUntil:'networkidle0'});
 const fixture=await page.evaluate(async()=>{
 const post=async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(JSON.stringify(d));return d;};
 await post('/api/auth/demo-login',{displayName:'UI audit',asAppOwner:true});
 return post('/api/rooms',{useTrial:false,config:{name:'Concert UI',description:'',map:'tables',avatarGroups:['animals'],officialCapacity:10,waitingEnabled:false,entryMode:'auto_assign',durationHours:6,isPublic:false,password:'',scheduledAt:Date.now()+7200000}});
 });
 assert.ok(fixture.orderId);
 const routes=process.argv.includes('--admin')?[['admin','/admin'],['logs',null]]:[['orders','/orders'],['order',`/orders/${fixture.orderId}`]];
 if(process.argv.includes('--admin')){
 await page.evaluate(async id=>fetch(`/api/orders/${id}/demo-pay`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),fixture.orderId);
 const d=await page.evaluate(async id=>(await(await fetch(`/api/orders/${id}`)).json()),fixture.orderId);
 routes[1][1]=`/room/${d.room.id}/logs`;
 }
 for(const [name,path] of routes){
 await page.goto(base+path,{waitUntil:'networkidle0'});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${name} ${width}`);
 await page.screenshot({path:`${out}/${name}-${width}-${theme}.png`,fullPage:true});
 if(name==='order'){
 const d=await page.evaluate(async id=>(await(await fetch(`/api/orders/${id}`)).json()),fixture.orderId);
 assert.equal(await page.$eval('.order-qr',e=>e.getAttribute('src')),d.payment.qrImageUrl);
 for(const [index,value] of [[0,String(d.payment.due)],[1,d.payment.transferNote]]){await(await page.$$('.order-copy button'))[index].click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),value);}
 }
 if(name==='logs'){
 await page.type('input[type=search]','no-event-matches-this');
 await page.waitForFunction(()=>document.querySelectorAll('.logs-timeline li').length===0);
 assert.ok(await page.$('.ui-empty'));
 await page.click('input[type=search]',{clickCount:3});await page.keyboard.press('Backspace');
 const options=await page.$$eval('.logs-filters option',nodes=>nodes.map(n=>n.value));
 if(options.length>1){await page.select('.logs-filters select',options[1]);assert.ok(await page.$('.logs-timeline li'));}
 }
 if(name==='admin'){
 await page.screenshot({path:`${out}/admin-overview-${width}-${theme}.png`,fullPage:false});
 await page.focus('[role=tab][aria-selected=true]');await page.keyboard.press('End');
 assert.equal(await page.$eval('[role=tab][aria-selected=true]', e=>e.textContent.trim()),'Log');
 await page.keyboard.press('Home');
 assert.equal(await page.$eval('[role=tab][aria-selected=true]', e=>e.textContent.trim()),'Tổng quan');
 for(const label of ['Cài đặt & giá','Giao dịch','Biên lai & ngân hàng','Quyết toán','Mã giảm giá','Log']){
 await page.evaluate(l=>[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent.trim()===l).click(),label);
 await new Promise(r=>setTimeout(r,500));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow admin ${label} ${width}`);
 await page.screenshot({path:`${out}/admin-${['Cài đặt & giá','Giao dịch','Biên lai & ngân hàng','Quyết toán','Mã giảm giá','Log'].indexOf(label)}-${width}-${theme}.png`,fullPage:true});
 }
 }
 }
 assert.deepEqual(errors,[]);report.push({width,theme,routes,errors});
 }finally{await context.close();}
}
await writeFile(`${out}/${process.argv.includes('--admin')?'t6':'t5'}-report.json`,JSON.stringify(report,null,2));
}finally{await browser.close();}
