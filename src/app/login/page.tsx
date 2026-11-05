"use client";

import { useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import { api, ApiError, useApi, useMe } from "@/lib/api";

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

/** Zalo: "Đăng nhập bằng Zalo" (Zalo Login) and/or chatting "ĐĂNG KÝ" with the Sân Khấu Online OA bot. */
function ZaloOptions() {
  const { data } = useApi<{ zaloLogin: boolean; zaloBot: { url: string } | null }>("/api/catalog");
  const err = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("error") : null;
  if (!data || (!data.zaloLogin && !data.zaloBot)) return null;
  return (
    <div className="stack zalo-box">
      <div className="or-line">
        <span>hoặc</span>
      </div>
      {err === "zalo" && <p className="notice error">Đăng nhập Zalo không thành công, thử lại nhé.</p>}
      {err === "link" && <p className="notice error">Link đăng nhập đã dùng hoặc hết hạn. Nhắn ĐĂNG NHẬP cho bot để lấy link mới.</p>}
      {data.zaloLogin && (
        <a className="btn zalo-btn" href={`/api/auth/zalo/start?next=${encodeURIComponent(typeof window !== "undefined" ? nextUrl() : "/")}`}>
          <span className="zalo-logo" aria-hidden>
            Z
          </span>
          Đăng nhập bằng Zalo
        </a>
      )}
      {data.zaloBot && (
        <p className="muted" style={{ margin: 0 }}>
          Hoặc nhắn <b>ĐĂNG KÝ</b> cho{" "}
          <a href={data.zaloBot.url} target="_blank" rel="noopener noreferrer">
            bot Sân Khấu Online trên Zalo
          </a>
          : bot tạo tài khoản, gửi link đăng nhập một chạm và nhắc bạn trước mỗi sự kiện.
        </p>
      )}
    </div>
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
          {mode && <ZaloOptions />}
        </div>
      )}
    </AppShell>
  );
}
