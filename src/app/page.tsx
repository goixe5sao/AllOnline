import Link from "next/link";
import { Suspense } from "react";
import { BarChart3, CircleHelp, LayoutGrid, LogIn, MessageCircle, Plus, Settings2, ShieldCheck, Users } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { SpaceCanvas } from "@/components/space-canvas";
import { createClient } from "@/lib/supabase/server";

type Room = { id: string; name: string; description: string; map_type: string; status: string; total_slots: number };
const mapLabels: Record<string, string> = { hall: "Hội trường ghế ngồi", carpet: "Khu thảm ngồi", tables: "Khu bàn", drive_in: "Rạp chiếu ngoài trời" };

async function DashboardData() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  const email = userData.user?.email ?? null;
  let rooms: Room[] = [];
  if (userId) {
    const result = await supabase.from("rooms").select("id,name,description,map_type,status,total_slots").order("created_at", { ascending: false });
    rooms = (result.data ?? []) as Room[];
  }

  return <main className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">A</span><span>AllOnline</span></div><div className="workspace-switcher"><span className="status-dot" /> Không gian của tôi</div><nav className="nav-group" aria-label="Điều hướng chính"><p className="nav-label">TỔNG QUAN</p><a className="nav-item active" href="#tong-quan"><LayoutGrid size={18} /> Tổng quan</a><a className="nav-item" href="#phong"><Users size={18} /> Phòng của tôi <span className="nav-count">{rooms.length}</span></a><a className="nav-item" href="#tin-nhan"><MessageCircle size={18} /> Tin nhắn</a><p className="nav-label">QUẢN LÝ</p><a className="nav-item" href="#bao-cao"><BarChart3 size={18} /> Báo cáo</a><a className="nav-item" href="#cai-dat"><Settings2 size={18} /> Cài đặt</a></nav><div className="sidebar-bottom"><div className="help-card"><CircleHelp size={19} /><div><strong>Cần trợ giúp?</strong><span>Xem hướng dẫn nhanh</span></div></div>{userId ? <div className="profile"><div className="avatar">{(email?.[0] ?? "U").toUpperCase()}</div><div><strong>{email ?? "Tài khoản"}</strong><span>Đã đăng nhập</span></div><SignOutButton /></div> : <Link className="profile" href="/login"><div className="avatar"><LogIn size={16} /></div><div><strong>Đăng nhập</strong><span>Để tạo phòng mới</span></div></Link>}</div></aside>
    <section className="content" id="tong-quan"><header className="topbar"><div><p className="eyebrow">KHÔNG GIAN KẾT NỐI</p><h1>{userId ? "Chào mừng trở lại" : "Chào mừng đến AllOnline"}</h1></div><div className="top-actions"><span className="mini-avatar">{userId ? (email?.[0] ?? "U").toUpperCase() : "?"}</span></div></header>{!userId && <div className="demo-banner"><ShieldCheck size={17} /><span><strong>Bạn đang xem chế độ khách.</strong> Đăng nhập để tạo phòng và quản lý không gian của bạn.</span><Link href="/login">Đăng nhập</Link></div>}
      <section className="hero-grid"><div className="hero-copy"><div className="pill"><span className="live-dot" /> ALLONLINE</div><h2>Mọi người,<br /><em>cùng một không gian.</em></h2><p>Tạo không gian 3D, chia sẻ link mời và kết nối với cộng đồng của bạn.</p><div className="hero-actions">{userId ? <Link href="/rooms/new" className="primary-button"><Plus size={18} /> Tạo phòng mới</Link> : <Link href="/login" className="primary-button"><LogIn size={18} /> Đăng nhập để bắt đầu</Link>}</div></div><div className="hero-art"><div className="art-glow" /><div className="art-label"><span className="live-dot" /> KHÔNG GIAN 3D</div><div className="art-surface"><div className="art-screen">ALL<br /><span>ONLINE</span></div></div></div></section>
      <section className="stats-row"><div className="stat-card"><div className="stat-icon peach"><Users size={19} /></div><div><span>Phòng của bạn</span><strong>{rooms.length} <small>phòng</small></strong></div></div><div className="stat-card"><div className="stat-icon blue"><LayoutGrid size={19} /></div><div><span>Phòng đang mở</span><strong>{rooms.filter((room) => room.status === "open").length} <small>phòng</small></strong></div></div><div className="stat-card"><div className="stat-icon green"><ShieldCheck size={19} /></div><div><span>Trạng thái kết nối</span><strong>{userId ? "OK" : "—"} <small>{userId ? "đã xác thực" : "chưa đăng nhập"}</small></strong></div></div></section>
      <section className="section-heading" id="phong"><div><p className="eyebrow">KHÔNG GIAN CỦA BẠN</p><h3>Phòng gần đây</h3></div>{userId && <Link className="outline-button" href="/rooms/new">Tạo phòng <span>→</span></Link>}</section><section className="room-grid">{rooms.length === 0 ? <article className="room-card"><div className="room-info"><div><h4>{userId ? "Bạn chưa có phòng nào" : "Đăng nhập để xem phòng"}</h4><p>{userId ? "Tạo phòng đầu tiên của bạn ngay hôm nay." : "Phòng và dữ liệu sẽ hiển thị sau khi xác thực."}</p></div></div><div className="room-footer">{userId ? <Link href="/rooms/new">Tạo phòng mới →</Link> : <Link href="/login">Đăng nhập →</Link>}</div></article> : rooms.map((room) => <article className="room-card selected" key={room.id}><div className="room-preview"><div className={`preview-scene ${room.map_type === "tables" ? "tables" : room.map_type === "drive_in" ? "drivein" : "hall"}`}><span /><span /><span /></div><div className="room-live">{room.status === "open" ? <><i className="live-dot" /> ĐANG MỞ</> : room.status.toUpperCase()}</div></div><div className="room-info"><div><h4>{room.name}</h4><p>{mapLabels[room.map_type] ?? room.map_type}</p></div><div className="room-people"><Users size={15} /> 0 / {room.total_slots}</div></div><div className="room-footer"><span className="open">{room.description || "Không có mô tả"}</span><Link href={`/room/${room.id}`}>Mở phòng →</Link></div></article>)}</section>
      <section className="space-section"><div className="section-heading"><div><p className="eyebrow">XEM TRƯỚC KHÔNG GIAN</p><h3>Hội trường ghế ngồi</h3></div><span className="preview-note">Bản xem trước 3D</span></div><div className="canvas-card"><SpaceCanvas /><div className="canvas-overlay"><span className="key-hint">W A S D</span><span>Di chuyển để khám phá</span></div></div></section>
    </section></main>;
}

export default function Home() {
  return <Suspense fallback={<main className="app-shell"><section className="content"><div className="demo-banner">Đang tải không gian của bạn…</div></section></main>}><DashboardData /></Suspense>;
}
