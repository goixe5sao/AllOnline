import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { Hub } from "../server/hub";
import { requestRoom, roomConfigSchema } from "../server/services/rooms";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { openPglite, migrate, type Db } from "../server/db";
import { effectivePlan, PLAN_KINDS, type AiPlan } from "../src/core/ai-plan";
import { getUser } from "../server/services/users";
import { requireAi, setFollow } from "../server/services/ai-plan";
import { StockAlerts, FixtureAlertsProvider } from "../server/ai-stock/alerts";
import { CaptureSender } from "../server/zalo/transport";
import { fixtureAlerts } from "../src/core/stock-alerts";
import { createApi } from "../server/routes";
import { Auth } from "../server/auth";
import type { Config } from "../server/config";
let db: Db, server: Server, base: string, auth: Auth, alerts: StockAlerts;
const now = Date.now();
async function user(plan: AiPlan) {
  const id = randomUUID();
  await db.query("insert into app.users(id,display_name,ai_plan) values($1,'Plan tester',$2)",[id,plan]);
  return (await getUser(db,id))!;
}
beforeAll(async()=>{
  db=await openPglite(); await migrate(db);
  const cfg={mode:"demo",appSecret:"local-plan-tests",secureCookies:false} as Config;
  auth=new Auth(cfg,db); alerts=new StockAlerts(db,new FixtureAlertsProvider(),new CaptureSender(),{log:()=>{}});
  const api=createApi({cfg,db,auth,alerts,hub:{aiStockScan:async()=>({snapshot:"fixture"})}} as unknown as Parameters<typeof createApi>[0]);
  server=createServer((req,res)=>void api(req,res,new URL(req.url!,base)));
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
},30000);
afterAll(async()=>{if(server) await new Promise<void>(r=>server.close(()=>r()));if(db)await db.close();});
async function request(id:string,url:string,body?:unknown,method?:string) {
  const cookie=`ao_acc=${auth.signer.sign({k:"acc",uid:id,exp:Date.now()+60000})}`;
  return fetch(base+url,{method:method ?? (body ? "POST":"GET"),headers:{cookie,"Content-Type":"application/json"},body:body ? JSON.stringify(body):undefined});
}
it("centralizes owner, guest, demo, off and VIP expiry at the boundary",()=>{
  const u={role:"user",is_guest:false,is_demo:false,ai_plan:"vip" as const,ai_plan_until:new Date(now)};
  expect(effectivePlan(u,now-1)).toBe("vip");expect(effectivePlan(u,now)).toBe("basic");
  expect(effectivePlan({...u,ai_plan_until:null},now)).toBe("vip");
  expect(effectivePlan({...u,is_guest:true},now)).toBe("off");expect(effectivePlan({...u,is_demo:true},now)).toBe("off");
  expect(effectivePlan({...u,role:"app_owner",is_demo:true,is_guest:true},now)).toBe("vip");
  expect(PLAN_KINDS.off).toEqual([]);expect(PLAN_KINDS.basic).toEqual(["near_resistance","break_resistance"]);
});
it("queues only allowed followers and filters the feed before pagination",async()=>{
  await db.exec("truncate app.stock_alerts cascade; truncate app.stock_follows");
  const basic=await user("basic"),vip=await user("vip"),off=await user("off");
  for(const u of [basic,vip,off]) await alerts.follow(u.id,"FPT",true);
  const a={...fixtureAlerts(now).alerts[0],createdAt:new Date(now).toISOString()};
  await alerts.ingest(a);await alerts.ingest({...a,id:"support",kind:"near_support",level:a.level+1});
  const jobs=await db.query<{user_id:string}>("select user_id from app.stock_alert_deliveries");
  expect(jobs.rows.filter(r=>r.user_id===basic.id)).toHaveLength(1);expect(jobs.rows.filter(r=>r.user_id===vip.id)).toHaveLength(2);expect(jobs.rows.filter(r=>r.user_id===off.id)).toHaveLength(0);
  expect((await alerts.feed(basic)).alerts).toHaveLength(1);expect((await alerts.feed(vip)).alerts).toHaveLength(2);expect((await alerts.feed(off)).alerts).toHaveLength(0);
  await alerts.follow(basic.id,"FPT",false);expect((await alerts.feed(basic)).alerts).toHaveLength(0);
  await db.query("update app.users set ai_plan='off' where id=$1",[vip.id]);await alerts.deliver(now);
  const skipped=await db.query<{reason:string}>("select reason from app.stock_alert_deliveries where user_id=$1",[vip.id]);expect(skipped.rows.map(r=>r.reason)).toEqual(["plan","plan"]);
});
it.each([["basic",10],["vip",50]] as const)("enforces %s follow limit %i, idempotence and concurrent adds",async(plan,limit)=>{
  const u=await user(plan);
  for(let i=0;i<limit+2;i++) await db.query("insert into app.market_symbols(symbol,name,exchange,kind) values($1,'Local test','HOSE','stock') on conflict do nothing",[`T${i}`]);
  for(let i=0;i<limit-1;i++) await db.tx(q=>setFollow(q,u.id,`T${i}`,true));
  const results=await Promise.allSettled([db.tx(q=>setFollow(q,u.id,`T${limit-1}`,true)),db.tx(q=>setFollow(q,u.id,`T${limit}`,true))]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  await db.tx(q=>setFollow(q,u.id,"T0",true));
  await expect(db.tx(q=>setFollow(q,u.id,"UNKNOWN",true))).rejects.toMatchObject({code:"SYMBOL"});
  await db.tx(q=>setFollow(q,u.id,"T0",false));
  expect(await alerts.follows(u.id)).toHaveLength(limit-1);
});
it("enforces API plans, admin guard, audit, expiry and session metadata",async()=>{
  const basic=await user("basic"),off=await user("off"),owner=await user("off");
  await db.query("update app.users set role='app_owner' where id=$1",[owner.id]);
  for(const p of ["scan","alerts","follows"]) expect((await request(off.id,`/api/ai-stock/${p}`)).status).toBe(403);
  expect((await request(off.id,"/api/ai-stock/follows",{symbol:"FPT",following:true})).status).toBe(403);
  expect((await request(basic.id,"/api/ai-stock/scan")).status).toBe(403);
  await expect(requireAi(db,basic.id,true)).rejects.toMatchObject({status:403});
  expect((await request(basic.id,"/api/admin/users")).status).toBe(403);
  const patch={plan:"vip",until:null};
  expect((await request(basic.id,`/api/admin/users/${basic.id}/ai-plan`,patch,"PATCH")).status).toBe(403);
  expect((await request(owner.id,`/api/admin/users/${basic.id}/ai-plan`,patch,"PATCH")).status).toBe(200);
  expect((await request(basic.id,"/api/ai-stock/scan")).status).toBe(200);
  const me=await (await request(basic.id,"/api/me")).json();expect(me.user.aiPlan).toBe("vip");expect(me.user.allowedKinds).toHaveLength(6);
  expect((await request(owner.id,`/api/admin/users/${basic.id}/ai-plan`,{...patch,role:"app_owner"},"PATCH")).status).toBe(400);
  const log=await db.query<{actor_id:string}>("select actor_id from app.system_events where type='ai_plan_changed' and data->>'userId'=$1",[basic.id]);expect(log.rows[0].actor_id).toBe(owner.id);
  await db.query("update app.users set ai_plan_until=$2 where id=$1",[basic.id,new Date(Date.now()-1)]);
  expect((await request(basic.id,"/api/ai-stock/scan")).status).toBe(403);
  const search=await (await request(owner.id,"/api/admin/users?q=Plan&page=0")).json();expect(search.users.length).toBeGreaterThan(0);
  await db.query("insert into app.user_identities(provider,provider_uid,user_id,display_name) values('zalo_oa',$1,$2,'Unique Zalo name')",[basic.id,basic.id]);
  const zalo=await (await request(owner.id,"/api/admin/users?q=Unique%20Zalo")).json();expect(zalo.users.map((u:{id:string})=>u.id)).toEqual([basic.id]);
});
it("applies 018 after 017 preserving users/follows, and the fresh migration has defaults/checks",async()=>{
  const old=await openPglite();
  try {
    for(const name of fs.readdirSync("db/migrations").filter(n=>n.endsWith(".sql") && n<"018" ).sort()) await old.exec(fs.readFileSync(path.join("db/migrations",name),"utf8"));
    const id=randomUUID();await old.query("insert into app.users(id,display_name) values($1,'Existing')",[id]);
    await old.query("insert into app.stock_follows(user_id,symbol) values($1,'FPT')",[id]);
    await old.exec(fs.readFileSync("db/migrations/018_ai_plan.sql","utf8"));
    expect(effectivePlan(await getUser(old,id))).toBe("basic");expect((await old.query("select * from app.stock_follows")).rows).toHaveLength(1);
    await expect(old.query("update app.users set ai_plan='invalid' where id=$1",[id])).rejects.toThrow();
  }finally{await old.close();}
},30000);

it("checks the current room owner plan on screen start after upgrades and downgrades",async()=>{
  const host=await user("basic");
  const result=await requestRoom(db,host.id,roomConfigSchema.parse({name:"Plan room",map:"hall",avatarGroups:["people"],officialCapacity:5,waitingEnabled:false,entryMode:"auto_assign",durationHours:1}),true);
  if(result.kind!=="room") throw new Error("Expected trial room");
  const hub=new Hub(db,auth);
  class Socket extends EventEmitter {
    OPEN=1; readyState=1; messages: {t:string;code?:string;state?:{content:{kind:string;fixture?:boolean}};screen?:{content:{kind:string}}}[]=[];
    send(s:string){this.messages.push(JSON.parse(s));} close(){} ping(){}
  }
  const socket=new Socket();
  await hub.start();
  try {
    hub.attach(socket as unknown as WebSocket,host,"plan-ip","plan-device");
    socket.emit("message",JSON.stringify({t:"join",roomId:result.room.id}),false);
    await vi.waitFor(()=>expect(socket.messages.some(m=>m.t==="welcome")).toBe(true));
    const start=()=>socket.emit("message",JSON.stringify({t:"screen",action:"ai_stock",command:"start"}),false);
    start();await vi.waitFor(()=>expect(socket.messages.some(m=>m.code==="AI_PLAN")).toBe(true));
    socket.messages=[];
    await db.query("update app.users set ai_plan='vip' where id=$1",[host.id]);
    start();await vi.waitFor(()=>expect(socket.messages.some(m=>m.state?.content.kind==="ai-stock")).toBe(true));
    const viewer=await user("off"), viewerSocket=new Socket();
    hub.attach(viewerSocket as unknown as WebSocket,viewer,"viewer-ip","viewer-device");
    viewerSocket.emit("message",JSON.stringify({t:"join",roomId:result.room.id,pass:auth.roomPass(viewer.id,result.room.id),avatar:{group:"people",model:"person-teal"}}),false);
    await vi.waitFor(()=>expect(viewerSocket.messages.some(m=>m.t==="welcome" && m.screen?.content.kind==="ai-stock")).toBe(true));
    viewerSocket.emit("close");
    socket.messages=[];
    await db.query("update app.users set ai_plan='basic' where id=$1",[host.id]);
    start();await vi.waitFor(()=>expect(socket.messages.some(m=>m.code==="AI_PLAN")).toBe(true));
  }finally{hub.stop();socket.emit("close");}
  await db.query("update app.rooms set is_demo=true where id=$1",[result.room.id]);
  await db.query("update app.users set is_demo=true,ai_plan='off' where id=$1",[host.id]);
  const demoHub=new Hub(db,auth), demoSocket=new Socket();
  await demoHub.start();
  try {
    demoHub.attach(demoSocket as unknown as WebSocket,(await getUser(db,host.id))!,"demo-ip","demo-device");
    demoSocket.emit("message",JSON.stringify({t:"join",roomId:result.room.id}),false);
    await vi.waitFor(()=>expect(demoSocket.messages.some(m=>m.t==="welcome")).toBe(true));
    demoSocket.emit("message",JSON.stringify({t:"screen",action:"ai_stock",command:"start"}),false);
    await vi.waitFor(()=>expect(demoSocket.messages.some(m=>m.state?.content.kind==="ai-stock" && m.state.content.fixture)).toBe(true));
  }finally{demoHub.stop();demoSocket.emit("close");}
});
