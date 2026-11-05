"use client";

import { useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import { api, ApiError, useMe } from "@/lib/api";

function nextUrl() {
  const n = new URLSearchParams(window.location.search).get("next");
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

function DemoLogin() {
  const [name, setName] = useState("");
  const [asOwner, setAsOwner] = useState(false);
  const [err, setErr] = useState("");
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api("/api/auth/demo-login", { body: { displayName: name, asAppOwner: asOwner } });
          window.location.href = nextUrl();
        } catch (e) {
          setErr((e as ApiError).message);
        }
      }}
    >
      <div className="notice warn">
        Đây là <strong>đăng nhập demo</strong>: không có mật khẩu, tài khoản chỉ tồn tại trong cơ sở dữ liệu cục bộ. Để thử nhiều người cùng lúc, mở thêm cửa sổ ẩn danh hoặc trình duyệt khác.
      </div>
      <label className="field">
        Tên hiển thị
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="Nguyễn Văn A" />
      </label>
      <label className="check">
        <input type="checkbox" checked={asOwner} onChange={(e) => setAsOwner(e.target.checked)} /> Vào với vai trò <strong>chủ ứng dụng</strong> (chỉ có trong demo)
      </label>
      <button className="btn primary">Vào bản demo</button>
      {err && <p className="notice error">{err}</p>}
    </form>
  );
}

function RealLogin() {
  // ?mode=signup (from "Tạo tài khoản" on the home page) opens the sign-up form directly.
  const [mode, setMode] = useState<"login" | "signup">(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mode") === "signup" ? "signup" : "login"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "login") {
        await api("/api/auth/login", { body: { email, password } });
        window.location.href = nextUrl();
      } else {
        const r = await api<{ needsConfirmation: boolean }>("/api/auth/signup", { body: { email, password, displayName: name } });
        if (r.needsConfirmation) setMsg({ kind: "ok", text: "Đã tạo tài khoản. Hãy mở email để xác nhận, sau đó đăng nhập." });
        else window.location.href = nextUrl();
      }
    } catch (e) {
      setMsg({ kind: "error", text: (e as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      {mode === "signup" && (
        <label className="field">
          Tên hiển thị
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
        </label>
      )}
      <label className="field">
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </label>
      <label className="field">
        Mật khẩu
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "signup" ? 8 : 6} autoComplete={mode === "login" ? "current-password" : "new-password"} />
      </label>
      <button className="btn primary" disabled={busy}>
        {busy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
      </button>
      {msg && <p className={`notice ${msg.kind}`}>{msg.text}</p>}
      <button type="button" className="btn" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
        {mode === "login" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  const { mode } = useMe();
  return (
    <AppShell narrow>
      {() => (
        <div className="card">
          <h1>Đăng nhập</h1>
          {mode === "demo" ? <DemoLogin /> : mode === "supabase" ? <RealLogin /> : <p className="muted">Đang tải…</p>}
        </div>
      )}
    </AppShell>
  );
}
