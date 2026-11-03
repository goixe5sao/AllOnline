import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
  return <main className="auth-page"><div className="auth-card"><Link className="auth-brand" href="/">A <span>AllOnline</span></Link><p className="eyebrow">KHÔNG GIAN KẾT NỐI</p><h1>Chào mừng trở lại</h1><p className="auth-intro">Đăng nhập để quản lý phòng và gặp mọi người trong không gian của bạn.</p><AuthForm /><Link className="back-link" href="/">← Quay về trang tổng quan</Link></div></main>;
}
