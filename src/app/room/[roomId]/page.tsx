import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Users, DoorOpen, ShieldCheck } from "lucide-react";
import { SpaceCanvas } from "@/components/space-canvas";
import { createClient } from "@/lib/supabase/server";

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect(`/login?next=/room/${roomId}`);
  const { data: room, error } = await supabase.from("rooms").select("id,name,description,map_type,total_slots,official_capacity,waiting_capacity,status").eq("id", roomId).single();
  if (error || !room) notFound();

  return <main className="room-page"><header className="room-topbar"><Link className="brand room-brand" href="/"><span className="brand-mark">A</span><span>AllOnline</span></Link><div className="room-status"><span className="live-dot" /> Phòng đang hoạt động</div><Link className="leave-room" href="/">Rời phòng</Link></header><section className="room-stage"><div className="room-stage-canvas"><SpaceCanvas /><div className="room-hud"><span className="key-hint">W A S D</span><span>Di chuyển · kéo để quan sát</span></div></div><aside className="room-panel"><p className="eyebrow">KHÔNG GIAN 3D</p><h1>{room.name}</h1><p className="room-description">{room.description || "Chào mừng bạn đến với không gian AllOnline."}</p><div className="room-facts"><div><Users size={17} /><span><strong>{room.total_slots}</strong> slot phân bổ</span></div><div><ShieldCheck size={17} /><span><strong>{room.official_capacity}</strong> chỗ chính thức</span></div><div><DoorOpen size={17} /><span>Chế độ vào phòng đang bật</span></div></div><div className="room-notice">Bạn đang ở chế độ thử nghiệm. Âm thanh, webcam và chat gần sẽ được bật ở các mốc tiếp theo.</div></aside></section></main>;
}
