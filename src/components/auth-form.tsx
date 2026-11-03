"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function AuthForm() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const supabase = createClient();
    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback`, data: { display_name: displayName } } });
    setBusy(false);
    if (result.error) { setMessage(result.error.message); return; }
    if (mode === "signup" && !result.data.session) { setMessage("Tài khoản đã tạo. Supabase vẫn đang yêu cầu xác nhận email."); return; }
    const next = new URLSearchParams(window.location.search).get("next") || "/";
    window.location.assign(next);
  }

  return <form className="auth-form" onSubmit={submit}>
    {mode === "signup" && <label>Tên hiển thị<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required placeholder="Nguyễn Văn A" /></label>}
    <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="ban@example.com" /></label>
    <label>Mật khẩu<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required placeholder="Tối thiểu 6 ký tự" /></label>
    <button className="primary-button auth-submit" disabled={busy}>{busy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</button>
    {message && <p className="auth-message">{message}</p>}
    <button type="button" className="auth-switch" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMessage(""); }}>{mode === "login" ? "Chưa có tài khoản? Tạo tài khoản" : "Đã có tài khoản? Đăng nhập"}</button>
  </form>;
}
