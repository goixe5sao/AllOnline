import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';

// Temporary component route: exercise the real panel without mounting a CPU 3D scene.
const dir = 'src/app/host-panel-audit';
const out = 'docs/screenshots/ui/after';
const base = 'http://localhost:3100';
assert.equal((await (await fetch(base + '/api/me')).json()).mode, 'demo');
await mkdir(dir, { recursive: true });
await mkdir(out, { recursive: true });
await writeFile(`${dir}/page.tsx`, `"use client";
import { useState } from "react";
import { OwnerPanel } from "@/components/room/owner-panel";
import { BLANK_SCREEN, type ScreenContent } from "@/core/screen";
import type { RoomInfoDto, ClientMsg } from "@/core/protocol";
const room: RoomInfoDto = {id:"audit",name:"Audit",description:"",map:"hall",entryMode:"auto_assign",officialCapacity:10,waitingCapacity:0,avatarGroups:["people"],expiresAt:0,openEnded:false,isTrial:true,startsAt:null,stageStyle:"plain",stageLights:true};
export default function Audit() {
 const [screen,setScreen]=useState({...BLANK_SCREEN,content:{kind:"image",url:"https://example.com/image.png"} as ScreenContent});
 const [last,setLast]=useState<ClientMsg | null>(null);
 return <><button id="legacy-tv" onClick={()=>setScreen({...BLANK_SCREEN,content:{kind:"tradingview",symbol:"NASDAQ:AAPL",interval:"D"}})}>Legacy TV</button><button id="legacy-chart" onClick={()=>setScreen({...BLANK_SCREEN,content:{kind:"chart",symbol:"FPT",source:"demo"}})}>Legacy chart</button><pre id="last">{JSON.stringify(last)}</pre><OwnerPanel room={room} screen={screen} serverNow={()=>0} send={m=>{setLast(m);if(m.t==="screen" && m.action==="set")setScreen({...BLANK_SCREEN,content:m.content});}} polls={[]} members={[]} chat={[]} hands={[]} isOwner selfId="audit" live={null} onClose={()=>{}} onOpenCamera={()=>{}} /></>;
}
`);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const report = [];
try {
 for (const width of [390,1440]) for (const theme of ['dark','light']) {
  const context = await browser.createBrowserContext();
  try {
   const page = await context.newPage(), errors = [];
   page.on('pageerror', e => errors.push(e.message));
   await page.setViewport({width,height:width===390?844:900});
   await page.evaluateOnNewDocument(t=>localStorage.setItem('ao-theme',t),theme);
   await page.goto(base+'/host-panel-audit',{waitUntil:'networkidle0'});
   await page.waitForSelector('.host-content-grid');
   await page.addStyleTag({content:'#legacy-tv,#legacy-chart,#last { visibility:hidden; }'});
   assert.equal(await page.$eval('.host-panel .notice strong',e=>e.textContent),'Hình ảnh');
   assert.deepEqual(await page.$$eval('[name=host-content-type]',nodes=>nodes.map(n=>n.value)),['text','image','youtube','web','audio','chart','blank']);
   assert.ok(await page.$eval('.host-panel',e=>e.scrollWidth<=e.clientWidth));
   await page.screenshot({path:`${out}/host-panel-${width}-${theme}.png`});
   await page.click('[name=host-content-type][value=chart]');
   assert.equal(await page.$('.host-panel input[type=text]'),null);
   await page.evaluate(()=>[...document.querySelectorAll('.host-panel button')].find(b=>b.textContent.includes('Hiển thị lên màn hình')).click());
   const msg=await page.$eval('#last',e=>JSON.parse(e.textContent));
   assert.equal(msg.content.symbol,'VNINDEX');assert.equal(msg.content.kind,'chart');
   assert.ok(!await page.$('.symbol-picker'));
   await page.$eval('.host-panel',e=>e.scrollTop=0);
   await page.screenshot({path:`${out}/host-panel-chart-${width}-${theme}.png`});
   for(const [id,label] of [['legacy-tv','Biểu đồ TradingView · NASDAQ:AAPL'],['legacy-chart','Biểu đồ FPT']]) {
    await page.$eval('#'+id,e=>e.click());
    assert.equal(await page.$eval('.host-panel .notice strong',e=>e.textContent),label);
    await page.click('[name=host-content-type][value=blank]');
    await page.evaluate(()=>[...document.querySelectorAll('.host-panel button')].find(b=>b.textContent.includes('Hiển thị lên màn hình')).click());
    assert.deepEqual(await page.$eval('#last',e=>JSON.parse(e.textContent)),{t:'screen',action:'set',content:{kind:'blank'}});
   }
   for(const kind of ['youtube','web']) {
    await page.click(`[name=host-content-type][value=${kind}]`);
    assert.ok(await page.$(kind==='youtube'?'.yt-panel':'.web-panel'));
   }
   await page.focus('[role=tab][aria-selected=true]');await page.keyboard.press('End');
   assert.equal(await page.$eval('[role=tab][aria-selected=true]',e=>e.textContent),'Phòng');
   await page.keyboard.press('Home');
   assert.equal(await page.$eval('[role=tab][aria-selected=true]',e=>e.textContent),'Màn hình');
   assert.equal(await page.$eval('.host-panel .ui-tabs',e=>getComputedStyle(e).scrollbarWidth),'none');
   for (const [kind,text,expected] of [
    ['text','Xin chào',{kind:'text',text:'Xin chào'}],
    ['image','https://example.com/p.png',{kind:'image',url:'https://example.com/p.png'}],
    ['audio','https://example.com/a.mp3',{kind:'audio',url:'https://example.com/a.mp3',title:'Âm thanh'}],
   ]) {
    await page.click(`[name=host-content-type][value=${kind}]`);
    await page.type(kind==='text'?'.host-panel textarea':'.host-panel input[type=text]',text);
    await page.$eval('.host-panel .ui-button-primary',e=>e.click());
    assert.deepEqual(await page.$eval('#last',e=>JSON.parse(e.textContent)),{t:'screen',action:'set',content:expected});
   }
   if(width===390) {
    await page.setViewport({width:360,height:844});
    assert.ok(await page.$eval('.host-panel',e=>e.scrollWidth<=e.clientWidth),JSON.stringify(await page.$$eval('.host-panel *',nodes=>nodes.filter(e=>e.getBoundingClientRect().right>350).map(e=>({tag:e.tagName,cls:e.className,w:e.getBoundingClientRect().width,text:e.textContent?.slice(0,40)})))));
   }
   assert.deepEqual(errors,[]);report.push({width,theme,pass:true,chartPayload:msg,errors});
  } finally {await context.close();}
 }
 await writeFile(`${out}/host-panel-report.json`,JSON.stringify(report,null,2));
 console.log('PASS host panel: four viewport/theme combinations, exact picker, VNINDEX, legacy switch-away, YouTube/web, keyboard tabs, no overflow/errors');
} finally {await browser.close();await rm(dir,{recursive:true,force:true});}
