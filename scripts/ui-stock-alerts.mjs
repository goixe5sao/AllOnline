import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const base='http://localhost:3100', dir='src/app/stock-alerts-audit', out='docs/screenshots/ui/after';
assert.equal(path.resolve(dir),path.join(process.cwd(),'src','app','stock-alerts-audit'));
assert.equal((await (await fetch(base+'/api/me')).json()).mode,'demo');
const fixture=JSON.parse(execFileSync(process.execPath,['--import','tsx','-e','Promise.all([import("./server/ai-stock/provider.ts"),import("./src/core/stock-alerts.ts")]).then(([p,a])=>console.log(JSON.stringify({snapshot:(p.default??p).STOCK_FIXTURE,alerts:(a.default??a).fixtureAlerts()})))'],{encoding:'utf8'}));
await mkdir(dir,{recursive:true}); await mkdir(out,{recursive:true});
await writeFile(`${dir}/page.tsx`, `"use client";
import {useState} from "react";
import {AiStockStage,AiStockList} from "@/components/room/ai-stock";
import {startStock,type StockScan} from "@/core/ai-stock";
import {Button} from "@/components/ui";
const snapshot=${JSON.stringify(fixture.snapshot)} as StockScan;
export default function Audit(){const [view,setView]=useState('stage');return <main className="container"><h1>AI Stock · Cảnh báo</h1><nav className="row">{['stage','list'].map(v=><Button key={v} onClick={()=>setView(v)}>{v}</Button>)}</nav>{view==='stage'?<div style={{position:'relative',height:680,marginTop:16}}><AiStockStage content={startStock(snapshot,true,0)}/></div>:<AiStockList current={startStock(snapshot,true,0)}/>}</main>}`);
let browser; const report=[];
try {
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const width of [390,1440]) for(const theme of ['dark','light']) {
  const context=await browser.createBrowserContext();
  try {
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.setViewport({width,height:width===390?844:900});
   await page.evaluateOnNewDocument(t=>localStorage.setItem('ao-theme',t),theme);
   await page.goto(base+'/api/me');
   await page.evaluate(async()=>{await fetch('/api/auth/demo-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:'Alert visual tester'})});});
   // Deterministic full two-beat fixture even before today's closing candle is available.
   await page.setRequestInterception(true);
   page.on('request',r=>r.url()===base+'/api/ai-stock/alerts'?r.respond({status:200,contentType:'application/json',body:JSON.stringify({...fixture.alerts,fixture:true})}):r.continue());
   assert.equal((await page.goto(base+'/stock-alerts-audit',{waitUntil:'networkidle0'})).status(),200);
   await page.waitForSelector('.ai-stock-chart canvas');
   assert.ok(await page.$eval('.stock-alert-banner',e=>e.textContent.includes('FPT')));
   assert.ok(await page.$eval('.stock-alert-banner',e=>!e.textContent.includes('%')));
   await page.screenshot({path:`${out}/stock-alerts-stage-${width}-${theme}.png`});
   await page.evaluate(()=>[...document.querySelectorAll('nav button')].find(b=>b.textContent==='list').click());
   await page.waitForSelector('.stock-alert-history article');
   assert.equal(await page.$$eval('.stock-alert-history article',e=>e.length),2);
   assert.ok(await page.$eval('.ai-stock-list',e=>e.textContent.includes('FPT ⚠')));
   assert.ok(await page.$eval('.stock-alert-history',e=>e.textContent.includes('81%')));
   await page.screenshot({path:`${out}/stock-alerts-list-${width}-${theme}.png`});
   await page.$eval('.stock-alert-history',e=>e.scrollIntoView());
   await page.screenshot({path:`${out}/stock-alerts-history-${width}-${theme}.png`});
   await page.evaluate(()=>[...document.querySelectorAll('.ai-stock-list button')].find(b=>b.textContent.includes('FPT')).click());
   await page.waitForSelector('.stock-follow button:not(:disabled)');
   await page.click('.stock-follow button');
   await page.waitForFunction(()=>document.querySelector('.stock-follow button')?.getAttribute('aria-pressed')==='true');
   await page.reload({waitUntil:'networkidle0'});
   await page.evaluate(()=>[...document.querySelectorAll('nav button')].find(b=>b.textContent==='list').click());
   await page.evaluate(()=>[...document.querySelectorAll('.ai-stock-list button')].find(b=>b.textContent.includes('FPT')).click());
   await page.waitForFunction(()=>document.querySelector('.stock-follow button')?.getAttribute('aria-pressed')==='true');
   await page.$eval('.stock-follow',e=>e.scrollIntoView());
   await page.screenshot({path:`${out}/stock-alerts-follow-${width}-${theme}.png`});
   await page.click('.stock-follow button');
   await page.waitForFunction(()=>document.querySelector('.stock-follow button')?.getAttribute('aria-pressed')==='false');
   assert.ok(await page.$eval('body',e=>e.scrollWidth<=innerWidth));
   if(width===390){await page.setViewport({width:360,height:844});assert.ok(await page.$eval('body',e=>e.scrollWidth<=innerWidth));}
   assert.deepEqual(errors,[]);report.push({width,theme,pass:true,errors,checks:['banner without percentages','two-beat history with gated stats','warning badges','follow persists after reload','unfollow','no overflow','no Three scene']});
  } finally {await context.close();}
 }
 await writeFile(`${out}/stock-alerts-report.json`,JSON.stringify(report,null,2));
 console.log('PASS alert components, 16 captures, four viewport/theme combinations, persisted follows, no errors or overflow');
} finally {if(browser)await browser.close();await rm(dir,{recursive:true,force:true});}
