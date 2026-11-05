"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { api, ApiError, fmtTime, useApi, type Me } from "@/lib/api";
import { AVATARS, MAP_INFO, type AvatarGroup, type MapCode } from "@/core/maps";

interface InviteView {
  room: { id: string; name: string; description: string; map: MapCode; avatarGroups: AvatarGroup[]; entryMode: string; hasPassword: boolean; expiresAt: string; openEnded?: boolean };
  isOwner: boolean;
  guestJoinEnabled: boolean;
}

function JoinForm({ code, data, me }: { code: string; data: InviteView; me: Me | null }) {
  const router = useRouter();
  const r = data.room;
  const isAccount = !!me && !me.isGuest;
  const [name, setName] = useState(me?.displayName ?? "");
  const [password, setPassword] = useState("");
  const [avatar, setAvatar] = useState<{ group: AvatarGroup; model: string }>({ group: r.avatarGroups[0], model: AVATARS[r.avatarGroups[0]].models[0].id });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

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
          sessionStorage.setItem(`ao-avatar-${j.roomId}`, JSON.stringify(avatar));
          if (data.isOwner) sessionStorage.setItem(`ao-mode-${j.roomId}`, "participant");
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
        {MAP_INFO[r.map].name} · {r.entryMode === "auto_assign" ? "Tự xếp chỗ" : "Vào từ cổng, tự tìm chỗ"} · {r.openEnded ? "mở đến khi chủ phòng tắt" : `đến ${fmtTime(r.expiresAt)}`}
      </p>

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
                <button type="button" key={m.id} className="choice" aria-pressed={avatar.group === g && avatar.model === m.id} onClick={() => setAvatar({ group: g, model: m.id })}>
                  <span className="swatch" style={{ background: m.color }} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {r.hasPassword && !data.isOwner && (
        <label className="field">
          Mật mã phòng
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="off" placeholder="Do chủ phòng cung cấp" />
        </label>
      )}

      {err && <p className="notice error">{err}</p>}
      <button className="btn primary" disabled={busy}>
        {busy ? "Đang vào…" : data.isOwner ? "Vào như người tham dự" : "Vào phòng"}
      </button>
      <small>
        {!isAccount && "Không cần tài khoản. "}Phòng không có voice/webcam; chat chỉ đến người ở gần bạn và không được lưu lại.
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
  const { data, error } = useApi<InviteView>(`/api/invite/${encodeURIComponent(code)}`);
  return (
    <AppShell narrow>
      {(me) => {
        if (error) return <p className="notice error">{error.message}</p>;
        if (!data) return <p className="muted">Đang tải…</p>;
        return <JoinForm code={code} data={data} me={me} />;
      }}
    </AppShell>
  );
}
