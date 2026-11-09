import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const base = 'http://localhost:3100', dir = 'src/app/ai-stock-real-audit', out = 'docs/screenshots/ui/after';
assert.equal(path.resolve(dir), path.join(process.cwd(), 'src', 'app', 'ai-stock-real-audit'));
assert.equal((await (await fetch(base + '/api/me')).json()).mode, 'demo');
const snapshot = JSON.parse(execFileSync(process.execPath, ['--import','tsx','-e', 'Promise.all([import("./server/ai-stock/provider.ts"),import("node:fs")]).then(([p,fs])=>console.log(JSON.stringify((p.default??p).mapStockVnScan(JSON.parse(fs.readFileSync("tests/fixtures-stockvn-scan.json","utf8"))))))'], { encoding: 'utf8' }));
await mkdir(dir, { recursive: true });
await mkdir(out, { recursive: true });
let browser;
try {
  await writeFile(`${dir}/page.tsx`, `"use client";
import {StockSignal,AiStockList} from "@/components/room/ai-stock";
import {startStock,type StockScan,type StockPick} from "@/core/ai-stock";
const scan=${JSON.stringify(snapshot)} as StockScan;
const evidence=(tier:"PASS"|"EVIDENCE"):StockPick=>({...scan.picks[0],signals:[{...scan.picks[0].signals[0],baseRate:0.5,stats:{hitRate:0.81,n:120,horizon:10,ci95:[0.75,0.86],tier}}]});
export default function Audit(){return <main className="container"><h1>StockVN · Mẫu payload thật</h1><div id="raw"><StockSignal pick={scan.picks[0]} snapshot={scan} fixture={false}/></div><h2>Ví dụ kiểm tra giao diện · số liệu giả lập</h2><div id="pass"><StockSignal pick={evidence("PASS")} snapshot={scan} fixture={false}/></div><div id="evidence"><StockSignal pick={evidence("EVIDENCE")} snapshot={scan} fixture={false}/></div><AiStockList current={startStock({...scan,picks:scan.picks.slice(0,5)},false,0)}/></main>}`);
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const report = [];
  for (const width of [390,1440]) for (const theme of ['dark','light']) {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.setViewport({width,height:width===390?844:900});
      await page.evaluateOnNewDocument(t=>localStorage.setItem('ao-theme',t),theme);
      await page.setRequestInterception(true);
      page.on('request',r => r.url().includes('/api/ai-stock/alerts') ? r.respond({status:200,contentType:'application/json',body:JSON.stringify({alerts:[],fixture:true})}) : r.continue());
      assert.equal((await page.goto(base+'/ai-stock-real-audit',{waitUntil:'networkidle0'})).status(),200);
      assert.ok(await page.$eval('#raw',e=>!e.textContent.includes('%')));
      assert.ok(await page.$eval('#pass',e=>e.textContent.includes('Đạt chuẩn 80%')));
      assert.ok(await page.$eval('#evidence',e=>e.textContent.includes('Lịch sử: 81% · nền 50% · 120 lần · 10 phiên')&&!e.textContent.includes('Đạt chuẩn')));
      assert.equal(await page.$('canvas'),null);
      assert.ok(await page.$eval('body',e=>e.scrollWidth<=innerWidth));
      await page.screenshot({path:`${out}/ai-stock-real-${width}-${theme}.png`,fullPage:true});
      assert.deepEqual(errors,[]);
      report.push({width,theme,pass:true,errors,threeMounted:false});
    } finally { await context.close(); }
  }
  await writeFile(`${out}/ai-stock-real-report.json`,JSON.stringify(report,null,2));
  console.log('PASS real scan presenter/list: no % without stats, PASS badge, EVIDENCE line, four viewport/theme combinations, no Three scene/errors/overflow');
} finally {
  if (browser) await browser.close();
  await rm(dir,{recursive:true,force:true});
}
