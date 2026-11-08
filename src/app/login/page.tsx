"use client";

import { useEffect, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, Theater } from "lucide-react";
import { Input, Card, CardBody, PageHeader, Skeleton, Tabs } from "@/components/ui";
import "../auth-pages.css";
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
      className="stack auth-form"
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
        <Input type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="Nguyễn Văn A" />
      </label>
      <label className="check">
        <input type="checkbox" checked={asOwner} onChange={(e) => setAsOwner(e.target.checked)} /> <span>Vào với vai trò <strong>chủ ứng dụng</strong> (chỉ có trong demo)</span>
      </label>
      <button className="btn primary ui-button ui-button-primary">Vào bản demo</button>
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
    <form className="stack auth-form" onSubmit={submit}>
      {mode === "signup" && (
        <label className="field">
          Tên hiển thị
          <Input type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
        </label>
      )}
      <label className="field">
        Email
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </label>
      <label className="field">
        Mật khẩu
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "signup" ? 8 : 6} autoComplete={mode === "login" ? "current-password" : "new-password"} />
      </label>
      <button className="btn primary ui-button ui-button-primary" disabled={busy}>
        {busy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
      </button>
      {msg && <p className={`notice ${msg.kind}`}>{msg.text}</p>}
      <button type="button" className="btn ui-button" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
        {mode === "login" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}
      </button>
    </form>
  );
}

/**
 * Zalo sign-in: the page shows a code, the person sends it to the Sân Khấu Online bot on Zalo
 * (phone or desktop app), and this page signs in by itself — no link to tap inside Zalo.
 * Zalo Login (OAuth) is offered as a one-tap button too when the app is set up.
 */
function ZaloLogin({ zaloLogin, botUrl }: { zaloLogin: boolean; botUrl: string | null }) {
  const [code, setCode] = useState<{ code: string; claim: string; expiresAt: number } | null>(null);
  const [state, setState] = useState<"idle" | "wait" | "expired" | "error">("idle");
  const [copied, setCopied] = useState(false);
  const [left, setLeft] = useState(0);
  const err = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("error") : null;

  const getCode = async () => {
    setCopied(false);
    try {
      const r = await api<{ code: string; claim: string; expiresAt: number }>("/api/auth/zalo/code", { body: {} });
      setCode(r);
      setState("wait");
    } catch {
      setState("error");
    }
  };

  // Poll until the bot confirms the code (every 2 s), then go on; count down the 10 minutes.
  useEffect(() => {
    if (!code || state !== "wait") return;
    let stop = false;
    const tick = async () => {
      setLeft(Math.max(0, Math.round((code.expiresAt - Date.now()) / 1000)));
      try {
        const r = await api<{ status: "pending" | "expired" | "ok" }>("/api/auth/zalo/code/check", { body: { code: code.code, claim: code.claim } });
        if (stop) return;
        if (r.status === "ok") window.location.href = nextUrl();
        else if (r.status === "expired") setState("expired");
      } catch {
        /* network blip: try again next tick */
      }
    };
    void tick();
    const t = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [code, state]);

  const message = code ? `DN ${code.code}` : "";
  return (
    <div className="stack zalo-box">
      {err === "zalo" && <p className="notice error">Đăng nhập Zalo không thành công, thử lại nhé.</p>}
      {err === "link" && <p className="notice error">Link đăng nhập đã dùng hoặc hết hạn. Lấy mã mới bên dưới nhé.</p>}
      {botUrl && (
        <>
          {state === "idle" || state === "error" ? (
            <>
              <p style={{ margin: 0 }}>
                Đăng nhập bằng cách <b>nhắn một mã cho bot Sân Khấu Online trên Zalo</b>. Chưa có tài khoản thì bot tạo luôn — không cần email, không cần mật khẩu.
              </p>
              <button type="button" className="btn primary ui-button ui-button-primary zalo-btn" onClick={getCode}>
                <span className="zalo-logo" aria-hidden>
                  Z
                </span>
                Lấy mã đăng nhập Zalo
              </button>
              {state === "error" && <p className="notice error">Không lấy được mã, thử lại nhé.</p>}
            </>
          ) : (
            <ol className="zalo-steps">
              <li>
                <div className="auth-qr"><QRCodeSVG value={botUrl} size={176} marginSize={4} title="Quét mã để mở bot Zalo" /></div>
                <a className="btn ui-button zalo-btn" href={botUrl} target="_blank" rel="noopener noreferrer">
                  <span className="zalo-logo" aria-hidden>
                    Z
                  </span>
                  Mở Zalo
                </a>
                <small className="muted">Quét mã bằng Zalo trên điện thoại để mở bot.</small>
              </li>
              <li>
                Nhắn cho bot đúng tin này:
                <div className="zalo-code" aria-label="Tin nhắn cần gửi">
                  <code>{message}</code>
                  <button
                    type="button"
                    className="btn ui-button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(message).then(() => setCopied(true));
                    }}
                  >
                    {copied ? <><Check aria-hidden /> Đã chép</> : <><Copy aria-hidden /> Chép</>}
                  </button>
                </div>
              </li>
              <li>
                {state === "expired" ? (
                  <span className="notice warn">
                    Mã đã hết hạn.{" "}
                    <button type="button" className="btn ui-button" onClick={getCode}>
                      Lấy mã mới
                    </button>
                  </span>
                ) : (
                  <span className="muted zalo-wait">
                    <span className="spinner" aria-hidden /> Đang chờ bạn nhắn… trang sẽ tự đăng nhập (mã còn {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")})
                  </span>
                )}
              </li>
            </ol>
          )}
        </>
      )}
      {zaloLogin && (
        <a className="btn ui-button zalo-btn" href={`/api/auth/zalo/start?next=${encodeURIComponent(typeof window !== "undefined" ? nextUrl() : "/")}`}>
          <span className="zalo-logo" aria-hidden>
            Z
          </span>
          {botUrl ? "Hoặc đăng nhập một chạm qua ứng dụng Zalo" : "Đăng nhập bằng Zalo"}
        </a>
      )}
    </div>
  );
}

/** Email or Zalo: two tabs (Zalo only when it is set up on this site). */
function LoginTabs({ email }: { email: React.ReactNode }) {
  const { data } = useApi<{ zaloLogin: boolean; zaloBot: { url: string } | null }>("/api/catalog");
  const zalo = !!data && !!data.zaloBot;
  const [tab, setTab] = useState<"email" | "zalo">(() =>
    typeof window !== "undefined" && (new URLSearchParams(window.location.search).get("via") === "zalo" || ["zalo", "link"].includes(new URLSearchParams(window.location.search).get("error") ?? "")) ? "zalo" : "email",
  );
  if (!zalo) return <>{email}</>;
  return (
    <div className="stack">
      <div className="login-tabs"><Tabs label="Cách đăng nhập" value={tab} onChange={v => setTab(v as "email" | "zalo")} items={[
        { value: "email", label: "Email", content: tab === "email" ? email : null },
        { value: "zalo", label: "Zalo", content: tab === "zalo" ? <ZaloLogin zaloLogin={data!.zaloLogin} botUrl={data!.zaloBot?.url ?? null} /> : null },
      ]} /></div>
    </div>
  );
}

export default function LoginPage() {
  const { mode } = useMe();
  return (
    <AppShell narrow>
      {() => (
        <Card className="auth-card"><CardBody className="stack">
          <div className="auth-brand"><Theater aria-hidden /><span>Sân Khấu Online</span></div>
          <PageHeader title="Đăng nhập" subtitle="Không gian của bạn, câu chuyện của bạn." />
          {mode ? <LoginTabs email={mode === "demo" ? <DemoLogin /> : <RealLogin />} /> : <Skeleton />}
        </CardBody></Card>
      )}
    </AppShell>
  );
}
