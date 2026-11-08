import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
// --component runs the picker assertions without another 3D visit.
if (process.argv.includes('--component')) {
 await import('./ui-host-panel.mjs');
 process.exit(0);
}
// Bounded replacement for the old arbitrary-stock picker E2E (T-8 fixes VNINDEX).
// One context, one room visit, no market backfill waits. Always closes the browser.
const base = 'http://localhost:3100';
const out = process.argv[2] ?? 'docs/screenshots/ui/after';
assert.equal((await (await fetch(base+'/api/me')).json()).mode,'demo');
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],protocolTimeout:20000});
let watchdog;
try {
 const context=await browser.createBrowserContext();
 const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:390,height:844});
 await page.evaluateOnNewDocument(()=>{localStorage.setItem('ao-gfx','lite');localStorage.setItem('ao-theme','dark');});
 await page.goto(base+'/login',{waitUntil:'networkidle0'});
 const room=await page.evaluate(async()=>{
  const post=async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(JSON.stringify(d));return d;};
  await post('/api/auth/demo-login',{displayName:'Host panel audit',asAppOwner:true});
  return post('/api/rooms',{useTrial:true,config:{name:'Host panel audit',description:'',map:'hall',avatarGroups:['people'],officialCapacity:10,waitingEnabled:false,entryMode:'auto_assign',durationHours:6,password:'',stageStyle:'plain',initialScreen:{kind:'text',text:'Host panel audit'}}});
 });
 assert.ok(room.roomId);
 // Warm compilation without a browser/3D context.
 await fetch(base+'/room/'+room.roomId);
 watchdog=setTimeout(()=>{browser.process()?.kill();},20000);
 const started=Date.now();
 await page.goto(base+'/room/'+room.roomId,{waitUntil:'domcontentloaded'});
 await page.waitForSelector('.orb',{timeout:12000});
 await page.evaluate(()=>document.querySelector('.orb').click());
 await page.waitForSelector('[data-orb="control"]',{timeout:2000});
 await page.evaluate(()=>document.querySelector('[data-orb="control"]').click());
 await page.waitForSelector('.host-content-grid',{timeout:2000});
 await page.screenshot({path:out+'/host-panel-room-390-dark.png'});
 await page.evaluate(()=>document.querySelector('[name="host-content-type"][value="chart"]').click());
 await page.evaluate(()=>document.querySelector('.host-panel .ui-button-primary').click());
 await page.waitForFunction(()=>document.querySelector('.host-panel .notice strong')?.textContent.includes('VN-Index'),{timeout:3000});
 const state=await page.evaluate(async id=>{const d=await(await fetch('/api/rooms/'+id)).json();return typeof d.room.screen_state==='string'?JSON.parse(d.room.screen_state):d.room.screen_state;},room.roomId);
 assert.equal(state.content.kind,'chart');assert.equal(state.content.symbol,'VNINDEX');
 await context.close();clearTimeout(watchdog);
 assert.deepEqual(errors,[]);
 console.log('PASS bounded room/screen E2E: real host panel, VNINDEX persisted; room visit '+(Date.now()-started)+'ms; context closed');
} finally {clearTimeout(watchdog);await browser.close();}
