"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function CreateRoomForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mapType, setMapType] = useState("hall");
  const [capacity, setCapacity] = useState(20);
  const [waiting, setWaiting] = useState(true);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_room", { p_name: name, p_description: description, p_map_type: mapType, p_avatar_group: "people", p_official_capacity: capacity, p_waiting_enabled: waiting, p_waiting_ratio: 0.2, p_entry_mode: "auto_assign", p_password: password || null, p_expires_at: null });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    const room = data?.[0];
    if (room?.invite_code) router.push(`/join/${room.invite_code}?created=1`);
    else setMessage("Không nhận được mã mời từ máy chủ.");
  }

  return <form className="room-form" onSubmit={submit}><label>Tên phòng<input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ví dụ: Sân khấu chính" /></label><label>Mô tả<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Phòng dùng để…" rows={3} /></label><label>Không gian<select value={mapType} onChange={(e) => setMapType(e.target.value)}><option value="hall">Hội trường ghế ngồi</option><option value="carpet">Khu thảm ngồi</option><option value="tables">Khu bàn</option><option value="drive_in">Rạp chiếu ngoài trời</option></select></label><label>Số chỗ chính thức<input type="number" min={1} max={100} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} /></label><label className="check-row"><input type="checkbox" checked={waiting} onChange={(e) => setWaiting(e.target.checked)} /> Cho phép người chờ ngoài cổng (20%)</label><label>Mật mã phòng (không bắt buộc)<input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật mã chia sẻ cho khách" /></label><button className="primary-button auth-submit" disabled={busy}>{busy ? "Đang tạo…" : "Tạo phòng và nhận link mời"}</button>{message && <p className="auth-message">{message}</p>}</form>;
}
