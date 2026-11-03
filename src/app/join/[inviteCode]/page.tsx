import Link from "next/link";
import { JoinRoomForm } from "@/components/join-room-form";

export default async function JoinPage({ params }: { params: Promise<{ inviteCode: string }> }) { const { inviteCode } = await params; return <main className="auth-page"><div className="auth-card room-create-card"><Link className="auth-brand" href="/">A <span>AllOnline</span></Link><p className="eyebrow">LINK MỜI PHÒNG</p><h1>Tham gia không gian</h1><p className="auth-intro">Bạn không cần tạo tài khoản. Chỉ cần nhập tên hiển thị và mật mã nếu có.</p><JoinRoomForm inviteCode={inviteCode} /><Link className="back-link" href="/">← Về AllOnline</Link></div></main>; }
