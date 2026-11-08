"use client";

import { useRef, useState } from "react";
import { Camera, MessageCircle, UserRound } from "lucide-react";
import { Input, Card, PageHeader, Badge } from "@/components/ui";
import "../auth-pages.css";
import { AppShell } from "@/components/app-shell";
import { api, ApiError, useApi, type Me } from "@/lib/api";

interface Identities {
  identities: { provider: "zalo" | "zalo_oa"; name: string | null; since: string }[];
  zaloLogin: boolean;
  bot: { url: string } | null;
  simulator: boolean;
}

/** Demo only: chat with the bot as if on Zalo (the bot logic is the real one). */
function BotSimulator() {
  // Same simulated Zalo follower across reloads of this browser (like one real Zalo account).
  const [oaId] = useState(() => {
    const fresh = "sim-" + Math.random().toString(36).slice(2, 10);
    try {
      const saved = localStorage.getItem("ao-sim-oa");
      if (saved) return saved;
      localStorage.setItem("ao-sim-oa", fresh);
    } catch {}
    return fresh;
  });
  const [log, setLog] = useState<{ me: boolean; text: string }[]>([{ me: false, text: "Đây là bản thử bot Zalo (chế độ demo). Nhắn ĐĂNG KÝ, LK <mã>, NHẮC <mã mời>, LỊCH, ĐƠN hoặc gửi ảnh chuyển khoản." }]);
  const [text, setText] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const push = (items: { me: boolean; text: string }[]) => {
    setLog((l) => [...l, ...items]);
    setTimeout(() => box.current?.scrollTo({ top: 1e6 }), 50);
  };
  const send = async (body: { text?: string; image?: string }, shown: string) => {
    push([{ me: true, text: shown }]);
    try {
      const r = await api<{ replies: string[] }>("/api/zalo/simulate", { body: { oaUserId: oaId, ...body } });
      push(r.replies.map((t) => ({ me: false, text: t })));
    } catch (e) {
      push([{ me: false, text: "Lỗi: " + (e as ApiError).message }]);
    }
  };
  return (
    <Card className="account-section stack" id="bot-sim">
      <h2>Thử bot Zalo</h2>
      <div className="sim-chat" ref={box} aria-live="polite">
        {log.map((m, i) => (
          <div key={i} className={`sim-msg ${m.me ? "me" : "bot"}`}>
            {m.text.split(/(https?:\/\/\S+)/).map((part, j) =>
              /^https?:\/\//.test(part) ? (
                <a key={j} href={part} style={{ color: "inherit", textDecoration: "underline", wordBreak: "break-all" }}>
                  {part}
                </a>
              ) : (
                part
              ),
            )}
          </div>
        ))}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send({ text }, text);
          setText("");
        }}
      >
        <Input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Nhắn cho bot…" aria-label="Tin nhắn cho bot" style={{ flex: 1 }} />
        <button className="btn primary ui-button ui-button-primary">Gửi</button>
        <label className="btn ui-button" title="Gửi ảnh chụp màn hình chuyển khoản">
          <Camera aria-label="Gửi ảnh" />
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const rd = new FileReader();
              rd.onload = () => send({ image: String(rd.result) }, `[ảnh] ${f.name}`);
              rd.readAsDataURL(f);
              e.target.value = "";
            }}
          />
        </label>
      </form>
    </Card>
  );
}

function Account({ me }: { me: Me }) {
  const { data, reload } = useApi<Identities>("/api/me/identities");
  const [name, setName] = useState(me.displayName);
  const [code, setCode] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const oa = data?.identities.find((i) => i.provider === "zalo_oa");
  const zalo = data?.identities.find((i) => i.provider === "zalo");
  return (
    <div className="account-page stack">
      <PageHeader title="Tài khoản" subtitle="Thông tin cá nhân và kết nối của bạn." />
      <Card className="account-section stack">
        <h2><UserRound aria-hidden /> Thông tin cá nhân</h2>
        {params?.get("linked") === "zalo" && <p className="notice ok">Đã liên kết Zalo.</p>}
        {params?.get("error") === "zalo_taken" && <p className="notice error">Tài khoản Zalo này đã gắn với một tài khoản Sân Khấu Online khác.</p>}
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/api/me", { method: "PATCH", body: { displayName: name } });
              setMsg("Đã lưu tên.");
            } catch (er) {
              setMsg((er as ApiError).message);
            }
          }}
        >
          <label className="field" style={{ flex: 1 }}>
            Tên hiển thị
            <Input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </label>
          <button className="btn ui-button" style={{ alignSelf: "flex-end" }}>
            Lưu
          </button>
        </form>
        {me.email && <small className="muted">Email: {me.email}</small>}
        {msg && <small>{msg}</small>}
      </Card>

      <Card className="account-section stack">
        <h2><MessageCircle aria-hidden /> Kết nối Zalo</h2>
        <p className="muted" style={{ margin: 0 }}>
          Liên kết Zalo để bot Sân Khấu Online nhắn tin nhắc trước giờ sự kiện, báo khi thanh toán xong, và để bạn gửi ảnh chuyển khoản cho bot.
        </p>
        <div className="row">
          <Badge tone={oa ? "success" : "neutral"}>{oa ? "Bot Zalo đã liên kết" : "Bot Zalo: chưa liên kết"}</Badge>
          {zalo && <Badge tone="success">Đăng nhập bằng Zalo</Badge>}
        </div>
        {!oa && (
          <div className="stack" style={{ gap: 6 }}>
            <button
              className="btn primary ui-button ui-button-primary"
              onClick={async () => {
                const r = await api<{ code: string }>("/api/me/zalo-link-code", { body: {} });
                setCode(r.code);
              }}
            >
              Lấy mã liên kết bot Zalo
            </button>
            {code && (
              <div className="notice">
                Nhắn <b style={{ fontSize: "1.2em", letterSpacing: 2 }}>LK {code}</b> cho{" "}
                {data?.bot ? (
                  <a href={data.bot.url} target="_blank" rel="noopener noreferrer">
                    bot Sân Khấu Online trên Zalo
                  </a>
                ) : (
                  "bot Sân Khấu Online trên Zalo"
                )}{" "}
                trong 10 phút.
              </div>
            )}
          </div>
        )}
        {oa && (
          <button
            className="btn ui-button"
            onClick={async () => {
              await api("/api/me/zalo-unlink", { body: {} });
              reload();
            }}
          >
            Bỏ liên kết bot Zalo
          </button>
        )}
        {data?.zaloLogin && !zalo && (
          <a className="btn ui-button zalo-btn" href="/api/auth/zalo/start?next=/account">
            <span className="zalo-logo" aria-hidden>
              Z
            </span>
            Dùng Zalo để đăng nhập tài khoản này
          </a>
        )}
      </Card>
      {data?.simulator && <BotSimulator />}
    </div>
  );
}

export default function AccountPage() {
  return (
    <AppShell narrow requireLogin>
      {(me) => <Account me={me} />}
    </AppShell>
  );
}
