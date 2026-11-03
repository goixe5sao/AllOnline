import Link from "next/link";
import { redirect } from "next/navigation";
import { CreateRoomForm } from "@/components/create-room-form";
import { createClient } from "@/lib/supabase/server";

export default async function NewRoomPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?next=/rooms/new");
  return <main className="auth-page"><div className="auth-card room-create-card"><Link className="auth-brand" href="/">A <span>AllOnline</span></Link><p className="eyebrow">CHỦ PHÒNG</p><h1>Tạo không gian mới</h1><p className="auth-intro">Sau khi tạo, bạn nhận được một link mời riêng để gửi cho khách.</p><CreateRoomForm /><Link className="back-link" href="/">← Quay về tổng quan</Link></div></main>;
}
