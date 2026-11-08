import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Real components, no Canvas/Three scene. One browser context at a time.
const base = 'http://localhost:3100', dir = 'src/app/ai-stock-audit', out = 'docs/screenshots/ui/after';
assert.equal(path.resolve(dir), path.join(process.cwd(), 'src', 'app', 'ai-stock-audit'));
assert.equal((await (await fetch(base + '/api/me')).json()).mode, 'demo');
const fixture = execFileSync(process.execPath, ['--import', 'tsx', '-e', 'import("./server/ai-stock/provider.ts").then(m=>console.log(JSON.stringify((m.default??m).STOCK_FIXTURE)))'], { encoding: 'utf8' }).trim();
JSON.parse(fixture);
await mkdir(dir, { recursive: true }); await mkdir(out, { recursive: true });
await writeFile(`${dir}/page.tsx`, `"use client";
import { useState } from "react";
import { AiStockStage, AiStockControls, AiStockList } from "@/components/room/ai-stock";
import { startStock, directStock, type StockScan } from "@/core/ai-stock";
import { BLANK_SCREEN, type ScreenState } from "@/core/screen";
import { PageHeader, Button } from "@/components/ui";
const snapshot = ${fixture} as StockScan;
export default function Audit() {
 const [screen,setScreen]=useState<ScreenState>({...BLANK_SCREEN,content:startStock(snapshot,true,0)});
 const [view,setView]=useState("stage");
 return <main className="container"><PageHeader title="AI Stock" subtitle="Bình luận thị trường · VN100"/><nav className="row">{["stage","controls","list"].map(v=><Button key={v} onClick={()=>setView(v)}>{v}</Button>)}</nav><pre id="state" hidden>{JSON.stringify(screen.content)}</pre>
 {view==="stage" && screen.content.kind==="ai-stock" && <div style={{position:"relative",height:680,marginTop:16}}><AiStockStage content={screen.content}/></div>}
 {view==="controls" && <AiStockControls screen={screen} send={m=>{if(m.t!=="screen"||m.action!=="ai_stock")return;setScreen(prev=>({...prev,content:m.command==="start"?startStock(snapshot,true,0,m.topN,m.seconds):m.command==="stop"?{kind:"blank"}:prev.content.kind==="ai-stock"?directStock(prev.content,m.command,0,m.symbol):prev.content}));}}/>}
 {view==="list" && <AiStockList current={startStock(snapshot,true,0)}/>}
 </main>;
}`);
let browser;
const report = [];
try {
 browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
 for (const width of [390,1440]) for (const theme of ['dark','light']) {
  const context = await browser.createBrowserContext();
  try {
   const page = await context.newPage(), errors=[];
   page.on('pageerror', e=>errors.push(e.message));
   await page.setViewport({width,height:width===390?844:900});
   await page.evaluateOnNewDocument(t=>localStorage.setItem('ao-theme',t),theme);
   assert.equal((await page.goto(base+'/ai-stock-audit',{waitUntil:'networkidle0'})).status(),200);
   await page.waitForSelector('.ai-stock-chart canvas');
   await page.waitForFunction(()=>document.querySelector('.ai-stock-chart svg rect'));
   assert.ok(await page.$eval('.ai-stock-signal',e=>e.textContent.includes('n=214')));
   assert.ok(await page.$eval('.ai-stock-signal',e=>e.textContent.includes('Dữ liệu mẫu')));
   assert.ok(await page.$eval('body',e=>e.scrollWidth<=innerWidth));
   await page.screenshot({path:`${out}/ai-stock-stage-${width}-${theme}.png`});
   const nav = async text=>page.evaluate(t=>[...document.querySelectorAll('nav button')].find(b=>b.textContent===t).click(),text);
   const click = async text=>page.evaluate(t=>[...document.querySelectorAll('.ai-stock-controls button')].find(b=>b.textContent===t).click(),text);
   const state = ()=>page.$eval('#state',e=>JSON.parse(e.textContent));
   await nav('controls');
   await click('Tạm dừng'); assert.equal((await state()).paused,true);
   await click('Tiếp tục'); assert.equal((await state()).paused,false);
   await click('Bỏ qua'); assert.equal((await state()).index,1);
   await click('Ghim mã'); assert.equal((await state()).pinned,true);
   await page.select('.ai-stock-controls select','VNM'); assert.equal((await state()).index,7);
   await page.screenshot({path:`${out}/ai-stock-controls-${width}-${theme}.png`});
   await click('Dừng AI'); assert.equal((await state()).kind,'blank');
   await click('Bật AI'); assert.equal((await state()).index,0);
   const before=await state();
   await nav('list');
   await page.screenshot({path:`${out}/ai-stock-list-${width}-${theme}.png`});
   await page.evaluate(()=>[...document.querySelectorAll('.ai-stock-list button')].find(b=>b.textContent.includes('HPG')).click());
   await page.waitForSelector('.ai-stock-private-chart canvas');
   assert.deepEqual(await state(),before);
   assert.ok(await page.$eval('.ai-stock-signal',e=>e.textContent.includes('HPG')));
   await page.screenshot({path:`${out}/ai-stock-private-${width}-${theme}.png`});
   if(width===390){await page.setViewport({width:360,height:844});assert.ok(await page.$eval('body',e=>e.scrollWidth<=innerWidth));}
   assert.deepEqual(errors,[]); report.push({width,theme,pass:true,errors});
  } finally { await context.close(); }
 }
 await writeFile(`${out}/ai-stock-report.json`,JSON.stringify(report,null,2));
 console.log('PASS AI Stock components: stage overlays, fixture labels, host controls, private selection, four viewport/theme combinations, no errors or overflow');
} finally {
 if(browser) await browser.close();
 // Only the fixed temporary route under this worktree is removed.
 await rm(dir,{recursive:true,force:true});
}
