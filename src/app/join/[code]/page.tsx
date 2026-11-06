"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { vnEventTime } from "@/lib/vn-time";
import { AppShell } from "@/components/app-shell";
import { api, ApiError, fmtTime, useApi, type Me } from "@/lib/api";
import { AVATARS, CAR_COLORS, MAP_INFO, type AvatarGroup, type MapCode } from "@/core/maps";
import dynamic from "next/dynamic";

// 3D preview of the chosen boy / girl (client only: WebGL).
const AvatarPreview = dynamic(() => import("@/components/room/avatar-preview"), { ssr: false });

interface InviteView {
  room: { id: string; name: string; description: string; map: MapCode; avatarGroups: AvatarGroup[]; entryMode: string; hasPassword: boolean; expiresAt: string; openEnded?: boolean; startsAt: number | null; isPublic: boolean; isDemo?: boolean };
  /** "Phòng trải nghiệm": who is host, seats, your minutes left today. */
  demo: { seated: number; waiting: number; hostName: string | null; hostLeftSec: number | null; leftSec: number; limitSec: number } | null;
  isOwner: boolean;
  guestJoinEnabled: boolean;
  reminded: boolean;
  zaloLinked: boolean;
  zaloBot: { oaId: string; url: string } | null;
}

function countdown(ms: number) {
  if (ms <= 0) return "Đang diễn ra";
  const d = Math.floor(ms / 86400_000);
  const h = Math.floor((ms % 86400_000) / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return d > 0 ? `Còn ${d} ngày ${h} giờ` : h > 0 ? `Còn ${h} giờ ${m} phút` : `Còn ${m} phút ${String(s).padStart(2, "0")} giây`;
}

function googleCalendarUrl(e: { title: string; description: string; startsAt: number; url: string }) {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${stamp(e.startsAt)}/${stamp(e.startsAt + 2 * 3600_000)}`, details: `${e.description ? e.description + "\n\n" : ""}Vào phòng: ${e.url}`, location: e.url });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** Event box: start time + countdown, "Nhắc tôi" (Zalo bot), calendar, share. */
function EventBox({ code, data, me, onChange }: { code: string; data: InviteView; me: Me | null; onChange: () => void }) {
  const r = data.room;
  const [now, setNow] = useState(() => Date.now());
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const link = typeof location !== "undefined" ? `${location.origin}/join/${code}` : `/join/${code}`;
  const isAccount = !!me && !me.isGuest;
  const share = async () => {
    const text = r.startsAt ? `${r.name} — ${vnEventTime(r.startsAt)}` : r.name;
    try {
      if (navigator.share) await navigator.share({ title: r.name, text, url: link });
      else {
        await navigator.clipboard.writeText(`${text}\n${link}`);
        setMsg("Đã sao chép link mời — dán vào Zalo, Messenger…");
      }
    } catch {
      /* share sheet closed */
    }
  };
  return (
    <div className="card stack event-box">
      {r.startsAt ? (
        <>
          <div className="event-when">🗓 {vnEventTime(r.startsAt)}</div>
          <div className="event-count" aria-live="off">
            {countdown(r.startsAt - now)}
          </div>
        </>
      ) : (
        <div className="event-when">Phòng đang mở — vào được ngay</div>
      )}
      <div className="row" style={{ flexWrap: "wrap" }}>
        {r.startsAt && r.startsAt > now && (
          isAccount ? (
            <button
              className={`btn ${data.reminded ? "" : "primary"}`}
              onClick={async () => {
                try {
                  const res = await api<{ on: boolean; zaloLinked: boolean }>(`/api/rooms/${r.id}/remind`, { body: { on: !data.reminded } });
                  setMsg(res.on ? (res.zaloLinked ? "Bot Zalo sẽ nhắc bạn trước giờ bắt đầu." : "Đã ghi nhớ. Liên kết Zalo để bot nhắn tin nhắc bạn (xem bên dưới).") : "Đã bỏ nhắc.");
                  onChange();
                } catch (e) {
                  setMsg((e as ApiError).message);
                }
              }}
            >
              {data.reminded ? "🔕 Bỏ nhắc" : "🔔 Nhắc tôi qua Zalo"}
            </button>
          ) : (
            <Link className="btn primary" href={`/login?next=${encodeURIComponent(`/join/${code}`)}`}>
              🔔 Đăng nhập để được nhắc
            </Link>
          )
        )}
        {r.startsAt && (
          <>
            <a className="btn" href={`/api/invite/${encodeURIComponent(code)}/calendar.ics`}>
              📅 Thêm vào lịch
            </a>
            <a className="btn" href={googleCalendarUrl({ title: r.name, description: r.description, startsAt: r.startsAt, url: link })} target="_blank" rel="noopener noreferrer">
              Google Calendar
            </a>
          </>
        )}
        <button className="btn" onClick={share}>
          ↗ Chia sẻ
        </button>
        <a className="btn" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer">
          Facebook
        </a>
      </div>
      {isAccount && data.reminded && !data.zaloLinked && (
        <small className="notice">
          Để bot Zalo nhắn tin nhắc, hãy <Link href="/account">liên kết tài khoản với Zalo</Link>
          {data.zaloBot ? (
            <>
              {" "}
              hoặc nhắn <b>ĐĂNG KÝ</b> cho <a href={data.zaloBot.url} target="_blank" rel="noopener noreferrer">bot Sân Khấu Online trên Zalo</a>
            </>
          ) : null}
          . File lịch cũng tự nhắc 30 phút trước.
        </small>
      )}
      {msg && <small>{msg}</small>}
    </div>
  );
}

function JoinForm({ code, data, me }: { code: string; data: InviteView; me: Me | null }) {
  const router = useRouter();
  const r = data.room;
  const isAccount = !!me && !me.isGuest;
  const [name, setName] = useState(me?.displayName ?? "");
  const [password, setPassword] = useState("");
  const [avatar, setAvatar] = useState<{ group: AvatarGroup; model: string; color?: string }>({ group: r.avatarGroups[0], model: AVATARS[r.avatarGroups[0]].models[0].id });
  /** Car paint (only for cars); undefined = the model's own colour. */
  const [paint, setPaint] = useState<string | undefined>(undefined);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const demo = data.demo;
  const hostFree = !!demo && !demo.hostName;
  const [demoRole, setDemoRole] = useState<"host" | "guest">(() => {
    const want = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("as") : null;
    return want === "guest" || !hostFree ? "guest" : "host";
  });

  if (!isAccount && !data.guestJoinEnabled)
    return (
      <div className="card stack">
        <h1>{r.name}</h1>
        <p className="notice warn">Phòng này yêu cầu đăng nhập tài khoản trước khi vào.</p>
        <Link className="btn primary" href={`/login?next=${encodeURIComponent(`/join/${code}`)}`}>
          Đăng nhập
        </Link>
      </div>
    );

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr("");
        try {
          // Guests: create/refresh the guest identity with just a display name.
          if (!isAccount) await api("/api/guest", { body: { displayName: name } });
          const j = await api<{ roomId: string; pass: string }>("/api/join", { body: { inviteCode: code, password } });
          sessionStorage.setItem(`ao-pass-${j.roomId}`, j.pass);
          sessionStorage.setItem(`ao-avatar-${j.roomId}`, JSON.stringify(avatar.group === "vehicles" && paint ? { ...avatar, color: paint } : avatar));
          if (data.isOwner) sessionStorage.setItem(`ao-mode-${j.roomId}`, "participant");
          if (demo && demoRole === "host" && hostFree) sessionStorage.setItem(`ao-demo-host-${j.roomId}`, "1");
          else sessionStorage.removeItem(`ao-demo-host-${j.roomId}`);
          router.push(`/room/${j.roomId}`);
        } catch (e) {
          setErr((e as ApiError).message);
          setBusy(false);
        }
      }}
    >
      <p className="muted" style={{ margin: 0 }}>
        Lời mời tham gia
      </p>
      <h1>{r.name}</h1>
      {r.description && <p>{r.description}</p>}
      <p className="muted">
        {MAP_INFO[r.map].name} · {r.entryMode === "auto_assign" ? "Tự xếp chỗ" : "Vào từ cổng, tự tìm chỗ"} · {r.isDemo ? "luôn mở" : r.openEnded ? "mở đến khi chủ phòng tắt" : `đến ${fmtTime(r.expiresAt)}`}
      </p>

      {demo && (
        <div className="notice demo-intro stack" style={{ gap: 8 }}>
          <b>🎪 Phòng trải nghiệm — không cần tài khoản</b>
          <span>
            Mỗi người được trải nghiệm <b>{Math.round(demo.limitSec / 60)} phút mỗi ngày</b> (chỉ tính lúc ở trong phòng, không tính lúc chờ). Hôm nay bạn còn <b>{mmss(demo.leftSec)}</b>. Phòng có {r.name.includes("Bãi") ? "3 chỗ đỗ" : "3 ghế"}: {demo.seated}/3 đang có người{demo.waiting ? `, ${demo.waiting} người chờ` : ""}.
          </span>
          {demo.leftSec > 0 && (
            <div className="demo-roles" role="radiogroup" aria-label="Vào với vai trò">
              <button type="button" role="radio" aria-checked={demoRole === "host"} disabled={!hostFree} className={`choice ${demoRole === "host" ? "on" : ""}`} onClick={() => setDemoRole("host")}>
                <b>👑 Vào làm chủ phòng</b>
                <small>{hostFree ? "Điều khiển màn hình: YouTube, biểu đồ, bình chọn, đèn sân khấu…" : `${demo.hostName} đang làm chủ phòng${demo.hostLeftSec != null ? ` (còn ${mmss(demo.hostLeftSec)})` : ""}`}</small>
              </button>
              <button type="button" role="radio" aria-checked={demoRole === "guest"} className={`choice ${demoRole === "guest" ? "on" : ""}`} onClick={() => setDemoRole("guest")}>
                <b>🎟 Vào làm khách</b>
                <small>Ngồi xem, chat với người gần, thả cảm xúc, giơ tay, hỏi đáp, bình chọn</small>
              </button>
            </div>
          )}
        </div>
      )}
      {demo && demo.leftSec <= 0 ? (
        <div className="stack">
          <p className="notice warn">Bạn đã dùng hết {Math.round(demo.limitSec / 60)} phút trải nghiệm hôm nay. Quay lại vào ngày mai nhé!</p>
          <Link className="btn primary" href="/login?mode=signup&next=%2Frooms%2Fnew">
            🎁 Mở phòng dùng thử miễn phí của riêng bạn
          </Link>
        </div>
      ) : null}
      {data.isOwner && (
        <div className="notice warn stack" style={{ gap: 8 }}>
          <span>
            Bạn là <strong>chủ phòng</strong>. Bạn có thể vào <strong>như người tham dự</strong> (chọn nhân vật, ngồi ghế, nhìn như khách, vẫn giữ nút “Điều khiển”), hoặc vào với camera tự do của chủ phòng.
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              sessionStorage.removeItem(`ao-mode-${r.id}`);
              router.push(`/room/${r.id}`);
            }}
          >
            Vào với vai trò chủ phòng (camera tự do)
          </button>
          <small>Mỗi tài khoản chỉ có một phiên trong phòng: tab đang mở phòng (nếu có) sẽ được thay bằng tab này.</small>
        </div>
      )}
      {isAccount ? (
        <p className="notice">
          Bạn vào với tài khoản <strong>{me!.displayName}</strong>.
        </p>
      ) : (
        <label className="field">
          Tên của bạn
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="Tên hiển thị trong phòng" autoFocus />
        </label>
      )}

      <div className="field">
        <strong>Chọn nhân vật</strong>
        {r.avatarGroups.map((g) => (
          <div key={g} className="stack" style={{ gap: 6 }}>
            <small>{AVATARS[g].label}</small>
            <div className="choice-grid">
              {AVATARS[g].models.map((m) => (
                <button type="button" key={m.id} data-model={m.id} className="choice" aria-pressed={avatar.group === g && avatar.model === m.id} onClick={() => setAvatar({ group: g, model: m.id })}>
                  <span className="swatch" style={{ background: g === "vehicles" && paint ? paint : m.color }} />
                  {m.gender && <span aria-hidden>{m.gender === "female" ? "👧 " : "👦 "}</span>}
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {avatar.group === "people" && <AvatarPreview model={avatar.model} />}
        {avatar.group === "vehicles" && (
          <>
            <small>Màu xe</small>
            <div className="car-colors" role="radiogroup" aria-label="Màu xe">
              {CAR_COLORS.map((c) => {
                const on = (paint ?? AVATARS.vehicles.models.find((x) => x.id === avatar.model)?.color) === c.hex;
                return <button type="button" key={c.hex} role="radio" aria-checked={on} aria-label={c.label} title={c.label} className={`car-color${on ? " on" : ""}`} style={{ background: c.hex }} onClick={() => setPaint(c.hex)} />;
              })}
            </div>
            <AvatarPreview group="vehicles" model={avatar.model} color={paint} />
          </>
        )}
      </div>

      {r.hasPassword && !data.isOwner && (
        <label className="field">
          Mật mã phòng
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="off" placeholder="Do chủ phòng cung cấp" />
        </label>
      )}

      {err && <p className="notice error">{err}</p>}
      <button className="btn primary" disabled={busy || (!!demo && demo.leftSec <= 0)}>
        {busy ? "Đang vào…" : demo ? (demoRole === "host" && hostFree ? "👑 Vào làm chủ phòng" : "🎟 Vào làm khách") : data.isOwner ? "Vào như người tham dự" : "Vào phòng"}
      </button>
      <small>
        {!isAccount && "Không cần tài khoản. "}Chat chỉ đến người ở gần bạn và không được lưu lại. Camera của bạn không bao giờ tự bật: chỉ người được chủ phòng cho phép mới live hình + tiếng lên màn hình, và không ghi lại.
        {!isAccount && (
          <>
            {" "}
            Đã có tài khoản? <Link href={`/login?next=${encodeURIComponent(`/join/${code}`)}`}>Đăng nhập</Link>
          </>
        )}
      </small>
    </form>
  );
}

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const { data, error, reload } = useApi<InviteView>(`/api/invite/${encodeURIComponent(code)}`);
  return (
    <AppShell narrow>
      {(me) => {
        if (error) return <p className="notice error">{error.message}</p>;
        if (!data) return <p className="muted">Đang tải…</p>;
        return (
          <div className="stack">
            <EventBox code={code} data={data} me={me} onChange={reload} />
            <JoinForm code={code} data={data} me={me} />
          </div>
        );
      }}
    </AppShell>
  );
}

function mmss(sec: number) {
  return `${Math.floor(sec / 60)}:${String(Math.max(0, Math.floor(sec % 60))).padStart(2, "0")}`;
}
