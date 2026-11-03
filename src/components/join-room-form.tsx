"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function JoinRoomForm({ inviteCode }: { inviteCode: string }) {
  const router = useRouter(); const [name, setName] = useState(""); const [password, setPassword] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setMessage(""); const supabase = createClient(); const { data: session } = await supabase.auth.getSession(); if (!session.session) { const auth = await supabase.auth.signInAnonymously(); if (auth.error) { setBusy(false); setMessage("Chưa bật Anonymous Sign-Ins trong Supabase Auth."); return; } } const result = await supabase.rpc("join_room_by_invite", { p_invite_code: inviteCode, p_password: password || null, p_display_name: name || "Khách" }); setBusy(false); if (result.error) { setMessage(result.error.message.includes("INVALID_ROOM_PASSWORD") ? "Mật mã phòng không đúng." : "Link phòng không hợp lệ hoặc phòng đã đóng."); return; } router.push(`/room/${result.data?.[0]?.room_id ?? ""}`); }
  return <form className="room-form" onSubmit={submit}><label>Tên hiển thị<input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Tên của bạn" /></label><label>Mật mã phòng<input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nếu chủ phòng đã đặt mật mã" /></label><button className="primary-button auth-submit" disabled={busy}>{busy ? "Đang vào phòng…" : "Vào phòng"}</button>{message && <p className="auth-message">{message}</p>}</form>;
}
