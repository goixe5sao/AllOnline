"use client";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { effectivePlan, PLAN_LABEL, type AiPlan } from "@/core/ai-plan";
import { Button, Input, Select, Field, Card } from "@/components/ui";
interface Account { id: string; display_name: string; email: string | null; role: string; is_demo: boolean; is_guest: boolean; ai_plan: AiPlan; ai_plan_until: string | null; total: number }
function AccountRow({ user, reload }: { user: Account; reload: () => void }) {
  const [plan,setPlan] = useState(user.ai_plan), [until,setUntil] = useState(user.ai_plan_until?.slice(0,10) ?? "");
  const [message,setMessage] = useState(""), [busy,setBusy] = useState(false);
  return <Card className="stack" style={{padding:16,minWidth:0}}><strong style={{overflowWrap:"anywhere"}}>{user.display_name}</strong><small style={{overflowWrap:"anywhere"}}>{user.email ?? "Chưa có email"}</small>
    <small>Hiệu lực: {PLAN_LABEL[effectivePlan(user)]}{user.role === "app_owner" ? " · Chủ ứng dụng luôn có VIP" : user.is_demo || user.is_guest ? " · Tài khoản demo/khách không dùng AI" : ""}</small>
    <Field label="Gói AI"><Select value={plan} onChange={e=>setPlan(e.target.value as AiPlan)}>{Object.entries(PLAN_LABEL).map(([v,l])=><option key={v} value={v}>{l}</option>)}</Select></Field>
    <Field label="Đến ngày (VIP, để trống = không hết hạn)"><Input type="date" value={until} onChange={e=>setUntil(e.target.value)}/></Field>
    <Button disabled={busy} onClick={async()=>{setBusy(true);setMessage("");try{await api(`/api/admin/users/${user.id}/ai-plan`,{method:"PATCH",body:{plan,until:until ? `${until}T16:59:59.999Z` : null}});setMessage("Đã lưu gói AI.");reload();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>Lưu gói AI</Button>
    {message && <p role="status">{message}</p>}
  </Card>;
}
export function AccountsTab() {
  const [term,setTerm] = useState(""), [query,setQuery] = useState(""), [page,setPage] = useState(0);
  const {data,error,reload} = useApi<{users: Account[]}>(`/api/admin/users?q=${encodeURIComponent(query)}&page=${page}`);
  return <section className="stack"><h2>Tài khoản</h2><form className="row" onSubmit={e=>{e.preventDefault();setQuery(term);setPage(0);}}><Field label="Tìm tên, email hoặc tên Zalo"><Input value={term} maxLength={100} onChange={e=>setTerm(e.target.value)}/></Field><Button type="submit">Tìm kiếm</Button></form>
    {error && <p role="alert">{error.message}</p>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,280px),1fr))",gap:16}}>{data?.users.map(u=><AccountRow key={`${u.id}-${u.ai_plan}-${u.ai_plan_until}`} user={u} reload={reload}/>)}</div>
    {data && !data.users.length && <p>Không có tài khoản phù hợp.</p>}
    <div className="row"><Button disabled={!page} onClick={()=>setPage(page-1)}>Trước</Button><span>Trang {page+1}</span><Button disabled={!data || (page+1)*20 >= (data.users[0]?.total ?? 0)} onClick={()=>setPage(page+1)}>Sau</Button></div>
  </section>;
}
