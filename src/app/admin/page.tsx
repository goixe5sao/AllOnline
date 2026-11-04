"use client";

import Link from "next/link";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { api, ApiError, fmtTime, useApi } from "@/lib/api";
import { formatVnd, type PriceTier } from "@/core/pricing";
import { MAP_INFO, type MapCode } from "@/core/maps";
import type { SlotBudget } from "@/core/slots";

interface Overview {
  budget: SlotBudget;
  live: { onlineUsers: number; connections: number; seated: number; findingSeat: number; waiting: number; rooms: { roomId: string; name: string; connections: number; seated: number; waiting: number; finding: number }[] };
  rooms: { id: string; name: string; owner_name: string; map_code: MapCode; status: string; total_slots: number; official_capacity: number; waiting_capacity: number; expires_at: string; is_trial: boolean }[];
  pendingOrders: number;
  reviewOrders: number;
  alerts: { kind: string; text: string; roomId: string | null }[];
}

function OverviewTab() {
  const { data, reload } = useApi<Overview>("/api/admin/overview", 5000);
  if (!data) return <p className="muted">Đang tải…</p>;
  const b = data.budget;
  return (
    <div className="stack">
      {data.alerts.map((a, i) => (
        <p key={i} className="notice warn">
          {a.text}
        </p>
      ))}
      <div className="grid grid-4">
        <div className="card stat">
          <span>Ngân sách slot</span>
          <strong>{b.budget}</strong>
        </div>
        <div className="card stat">
          <span>Đã phân bổ cho phòng</span>
          <strong>{b.allocated}</strong>
        </div>
        <div className="card stat">
          <span>Đang giữ cho thanh toán</span>
          <strong>{b.held}</strong>
        </div>
        <div className="card stat">
          <span>Còn lại</span>
          <strong>{b.remaining}</strong>
        </div>
      </div>
      <div className="slotbar">
        <span className="alloc" style={{ width: `${(b.allocated / Math.max(1, b.budget)) * 100}%` }} />
        <span className="held" style={{ width: `${(b.held / Math.max(1, b.budget)) * 100}%` }} />
      </div>
      <div className="grid grid-4">
        <div className="card stat">
          <span>Người online (tài khoản)</span>
          <strong>{data.live.onlineUsers}</strong>
        </div>
        <div className="card stat">
          <span>Kết nối WebSocket</span>
          <strong>{data.live.connections}</strong>
        </div>
        <div className="card stat">
          <span>Đang ngồi / tìm chỗ</span>
          <strong>
            {data.live.seated} / {data.live.findingSeat}
          </strong>
        </div>
        <div className="card stat">
          <span>Đang chờ ngoài cổng</span>
          <strong>{data.live.waiting}</strong>
        </div>
      </div>
      <p className="muted">
        Đơn đang giữ slot: {data.pendingOrders} · Giao dịch cần xem xét: {data.reviewOrders}
      </p>
      <div className="card table-wrap">
        <h2>Phòng</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Phòng</th>
              <th>Chủ phòng</th>
              <th>MAP</th>
              <th>Slot</th>
              <th>Đang có</th>
              <th>Hết hạn</th>
              <th>Trạng thái</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.rooms.map((r) => {
              const live = data.live.rooms.find((x) => x.roomId === r.id);
              return (
                <tr key={r.id}>
                  <td>
                    {r.name} {r.is_trial && <span className="badge warn">thử</span>}
                  </td>
                  <td>{r.owner_name}</td>
                  <td>{MAP_INFO[r.map_code].name}</td>
                  <td>
                    {r.official_capacity}+{r.waiting_capacity}={r.total_slots}
                  </td>
                  <td>{live ? `${live.seated} ngồi, ${live.finding} tìm, ${live.waiting} chờ` : "—"}</td>
                  <td>{fmtTime(r.expires_at)}</td>
                  <td>{r.status}</td>
                  <td className="row">
                    <Link className="btn small" href={`/room/${r.id}/logs`}>
                      Log
                    </Link>
                    {r.status === "open" && (
                      <>
                        <Link className="btn small" href={`/room/${r.id}`}>
                          Quan sát
                        </Link>
                        <button
                          className="btn small danger"
                          onClick={async () => {
                            if (confirm(`Đóng phòng “${r.name}”?`)) {
                              await api(`/api/rooms/${r.id}/close`, { body: {} });
                              reload();
                            }
                          }}
                        >
                          Đóng
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type SettingsData = Record<string, unknown> & { warning_minutes: number[]; duration_options: number[]; enabled_maps: string[]; enabled_avatar_groups: string[] };

const NUM_FIELDS: [string, string, string?][] = [
  ["total_slot_budget", "Tổng ngân sách slot hệ thống", "Đổi con số không tự nâng năng lực máy chủ — chỉ tăng sau khi đã nâng hạ tầng."],
  ["max_room_capacity", "Số chỗ chính thức tối đa mỗi phòng"],
  ["waiting_ratio", "Tỷ lệ người chờ (0–1, mặc định 0.2)"],
  ["find_seat_seconds", "Thời gian tìm chỗ (giây, mặc định 300)"],
  ["invite_claim_seconds", "Thời gian nhận chỗ khi được mời (giây)"],
  ["requeue_cooldown_seconds", "Thời gian chờ trước khi được gọi lại (giây)"],
  ["reconnect_grace_seconds", "Giữ chỗ khi mất mạng (giây)"],
  ["chat_radius", "Bán kính chat gần (m)"],
  ["chat_max_length", "Độ dài tối đa tin chat"],
  ["payment_hold_minutes", "Thời gian giữ slot chờ thanh toán (phút)"],
  ["waiting_surcharge_pct", "Phụ phí chỗ chờ (%; 0 = gồm trong gói)"],
  ["trial_rooms_per_account", "Số phòng dùng thử mỗi tài khoản"],
  ["trial_max_hours", "Thời hạn tối đa phòng dùng thử (giờ)"],
  ["trial_max_capacity", "Số chỗ tối đa phòng dùng thử"],
  ["upload_max_mb", "Dung lượng tệp tải lên tối đa (MB)"],
  ["upload_retention_days", "Giữ tệp tải lên (ngày) rồi xoá"],
];

function toLocalInput(v: unknown) {
  if (!v) return "";
  const d = new Date(v as string);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function SettingsTab() {
  const { data, reload } = useApi<{ settings: SettingsData; priceTiers: PriceTier[] }>("/api/admin/settings");
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);
  if (!data) return <p className="muted">Đang tải…</p>;
  return <SettingsForm msg={msg} setMsg={setMsg} key={`${String(data.settings.updated_at)}-${JSON.stringify(data.priceTiers)}`} data={data} reload={reload} />;
}

function SettingsForm({ data, reload, msg, setMsg }: { data: { settings: SettingsData; priceTiers: PriceTier[] }; reload: () => void; msg: { kind: string; text: string } | null; setMsg: (m: { kind: string; text: string } | null) => void }) {
  const [form, setForm] = useState<SettingsData>(data.settings);
  const [tiers, setTiers] = useState(() => data.priceTiers.map((t) => `${t.max_capacity}, ${t.duration_hours}, ${t.price_vnd}`).join("\n"));
  const set = (k: string, v: unknown) => setForm({ ...form, [k]: v });
  const list = (v: string) => v.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);

  const save = async () => {
    setMsg(null);
    try {
      const patch: Record<string, unknown> = {};
      for (const [k] of NUM_FIELDS) patch[k] = Number(form[k]);
      Object.assign(patch, {
        warning_minutes: form.warning_minutes,
        duration_options: form.duration_options,
        trial_enabled: !!form.trial_enabled,
        extension_enabled: !!form.extension_enabled,
        guest_join_enabled: !!form.guest_join_enabled,
        stage_ad_enabled: !!form.stage_ad_enabled,
        device_limit_room_creator: !!form.device_limit_room_creator,
        ip_max_participants: Math.max(0, Math.floor(Number(form.ip_max_participants) || 0)),
        stage_ad_text: String(form.stage_ad_text ?? ""),
        stage_ad_url: String(form.stage_ad_url ?? ""),
        trial_starts_at: form.trial_starts_at ? new Date(form.trial_starts_at as string).toISOString() : null,
        trial_ends_at: form.trial_ends_at ? new Date(form.trial_ends_at as string).toISOString() : null,
        qr_bank_bin: String(form.qr_bank_bin ?? ""),
        qr_account_no: String(form.qr_account_no ?? ""),
        qr_account_name: String(form.qr_account_name ?? ""),
        enabled_maps: form.enabled_maps,
        enabled_avatar_groups: form.enabled_avatar_groups,
      });
      await api("/api/admin/settings", { method: "PATCH", body: patch });
      setMsg({ kind: "ok", text: "Đã lưu cài đặt." });
      reload();
    } catch (e) {
      setMsg({ kind: "error", text: (e as ApiError).message });
    }
  };

  const saveTiers = async () => {
    setMsg(null);
    try {
      const rows = tiers
        .split("\n")
        .map((l) => l.split(",").map((x) => Number(x.trim())))
        .filter((r) => r.length === 3 && r.every((n) => Number.isFinite(n)))
        .map(([max_capacity, duration_hours, price_vnd]) => ({ max_capacity, duration_hours, price_vnd }));
      await api("/api/admin/price-tiers", { method: "PUT", body: rows });
      setMsg({ kind: "ok", text: "Đã lưu bảng giá. Đơn cũ giữ nguyên báo giá lúc tạo." });
      reload();
    } catch (e) {
      setMsg({ kind: "error", text: (e as ApiError).message });
    }
  };

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="card stack">
        <h2>Hệ thống, slot & thời gian</h2>
        {NUM_FIELDS.map(([k, label, hint]) => (
          <label className="field" key={k}>
            {label}
            <input type="number" step="any" value={String(form[k] ?? "")} onChange={(e) => set(k, e.target.value)} />
            {hint && <small>{hint}</small>}
          </label>
        ))}
        <label className="field">
          Mốc cảnh báo hết hạn (phút, cách nhau dấu phẩy)
          <input type="text" defaultValue={form.warning_minutes.join(", ")} onBlur={(e) => set("warning_minutes", list(e.target.value))} />
        </label>
        <label className="field">
          Các gói thời hạn (giờ)
          <input type="text" defaultValue={form.duration_options.join(", ")} onBlur={(e) => set("duration_options", list(e.target.value))} />
        </label>
      </div>
      <div className="stack">
        <div className="card stack">
          <h2>Dùng thử & gia hạn</h2>
          <label className="check">
            <input type="checkbox" checked={!!form.trial_enabled} onChange={(e) => set("trial_enabled", e.target.checked)} /> Bật dùng thử
          </label>
          <label className="field">
            Bắt đầu áp dụng
            <input type="datetime-local" value={toLocalInput(form.trial_starts_at)} onChange={(e) => set("trial_starts_at", e.target.value || null)} />
          </label>
          <label className="field">
            Kết thúc
            <input type="datetime-local" value={toLocalInput(form.trial_ends_at)} onChange={(e) => set("trial_ends_at", e.target.value || null)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={!!form.extension_enabled} onChange={(e) => set("extension_enabled", e.target.checked)} /> Cho phép gia hạn
          </label>
          <label className="check">
            <input type="checkbox" checked={!!form.guest_join_enabled} onChange={(e) => set("guest_join_enabled", e.target.checked)} /> Khách vào bằng link mời không cần tài khoản (chỉ nhập tên)
          </label>
          <label className="check">
            <input type="checkbox" checked={!!form.device_limit_room_creator} onChange={(e) => set("device_limit_room_creator", e.target.checked)} /> Mỗi thiết bị chỉ một tài khoản được tạo/giữ phòng
          </label>
          <small>Mỗi thiết bị (trình duyệt) luôn chỉ có một người tham dự tại một thời điểm.</small>
          <label className="field">
            Giới hạn số người tham dự trên cùng một IP (0 = không giới hạn)
            <input type="number" min={0} value={String(form.ip_max_participants ?? 0)} onChange={(e) => set("ip_max_participants", e.target.value)} />
            <small>Nên để 0: công ty, trường học, quán cà phê hay mạng 4G thường có rất nhiều người chung một IP.</small>
          </label>
          <small>Khi bật khách không cần tài khoản, một người có thể mở cửa sổ ẩn danh để thành “khách mới” và bình chọn thêm. Tắt nếu cần bình chọn chặt chẽ (mỗi tài khoản thật một phiếu).</small>
        </div>
        <div className="card stack">
          <h2>Dải quảng cáo trên màn hình sân khấu</h2>
          <label className="check">
            <input type="checkbox" checked={!!form.stage_ad_enabled} onChange={(e) => set("stage_ad_enabled", e.target.checked)} /> Luôn hiển thị ở mép dưới mọi màn hình sân khấu
          </label>
          <label className="field">
            Nội dung (tối đa 120 ký tự)
            <input type="text" maxLength={120} value={String(form.stage_ad_text ?? "")} onChange={(e) => set("stage_ad_text", e.target.value)} />
          </label>
          <label className="field">
            Liên kết khi bấm (https://)
            <input type="url" value={String(form.stage_ad_url ?? "")} onChange={(e) => set("stage_ad_url", e.target.value)} />
          </label>
          <small>Mở trong tab mới. Thay đổi áp dụng ngay cho mọi phòng đang mở.</small>
        </div>
        <div className="card stack">
          <h2>Nhận thanh toán QR (VietQR)</h2>
          <label className="field">
            Mã BIN ngân hàng
            <input type="text" value={String(form.qr_bank_bin ?? "")} onChange={(e) => set("qr_bank_bin", e.target.value)} placeholder="Ví dụ 970436" />
          </label>
          <label className="field">
            Số tài khoản
            <input type="text" value={String(form.qr_account_no ?? "")} onChange={(e) => set("qr_account_no", e.target.value)} />
          </label>
          <label className="field">
            Tên chủ tài khoản
            <input type="text" value={String(form.qr_account_name ?? "")} onChange={(e) => set("qr_account_name", e.target.value)} />
          </label>
          <small>Chưa có tích hợp tự động: đơn được xác nhận bằng tay ở tab “Giao dịch”, hoặc qua webhook đã ký (PAYMENT_WEBHOOK_SECRET).</small>
        </div>
        <div className="card stack">
          <h2>MAP & nhóm đối tượng</h2>
          {(Object.keys(MAP_INFO) as MapCode[]).map((m) => (
            <label className="check" key={m}>
              <input
                type="checkbox"
                checked={form.enabled_maps.includes(m)}
                onChange={(e) => set("enabled_maps", e.target.checked ? [...form.enabled_maps, m] : form.enabled_maps.filter((x) => x !== m))}
              />
              {MAP_INFO[m].name}
            </label>
          ))}
          {[
            ["people", "Người"],
            ["animals", "Động vật"],
            ["vehicles", "Xe"],
          ].map(([g, label]) => (
            <label className="check" key={g}>
              <input
                type="checkbox"
                checked={form.enabled_avatar_groups.includes(g)}
                onChange={(e) => set("enabled_avatar_groups", e.target.checked ? [...form.enabled_avatar_groups, g] : form.enabled_avatar_groups.filter((x) => x !== g))}
              />
              {label}
            </label>
          ))}
        </div>
        <button className="btn primary" onClick={save}>
          Lưu cài đặt
        </button>
        <div className="card stack">
          <h2>Bảng giá</h2>
          <small>Mỗi dòng: số chỗ chính thức tối đa, số giờ, giá (VND). Giá tính theo chỗ chính thức + thời hạn; chỗ chờ gồm trong gói (trừ khi đặt phụ phí).</small>
          <textarea rows={10} value={tiers} onChange={(e) => setTiers(e.target.value)} style={{ fontFamily: "monospace" }} />
          <button className="btn" onClick={saveTiers}>
            Lưu bảng giá
          </button>
        </div>
        {msg && <p className={`notice ${msg.kind}`}>{msg.text}</p>}
      </div>
    </div>
  );
}

function OrdersTab() {
  const [status, setStatus] = useState("");
  const { data, reload } = useApi<{ orders: { id: string; code: string; kind: string; status: string; amount_vnd: number; slots: number; created_at: string; hold_expires_at: string; review_note: string | null }[] }>(
    `/api/admin/orders${status ? `?status=${status}` : ""}`,
    5000,
  );
  const [msg, setMsg] = useState("");
  return (
    <div className="card stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Giao dịch</h2>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "auto" }}>
          <option value="">Tất cả</option>
          <option value="pending">Chờ thanh toán</option>
          <option value="needs_review">Cần xem xét</option>
          <option value="underpaid">Thiếu tiền</option>
          <option value="paid">Đã xác nhận</option>
          <option value="expired">Hết hạn</option>
        </select>
      </div>
      <p className="notice">Chỉ xác nhận khi đã thấy tiền vào tài khoản (sao kê). Ảnh chụp chuyển khoản hay việc khách bấm “đã thanh toán” không phải bằng chứng.</p>
      {msg && <p className="notice warn">{msg}</p>}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Mã</th>
              <th>Loại</th>
              <th>Số tiền</th>
              <th>Slot</th>
              <th>Trạng thái</th>
              <th>Tạo lúc</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link href={`/orders/${o.id}`}>{o.code}</Link>
                </td>
                <td>{o.kind === "create_room" ? "Tạo phòng" : "Gia hạn"}</td>
                <td>{formatVnd(o.amount_vnd)}</td>
                <td>{o.slots}</td>
                <td>
                  {o.status}
                  {o.review_note && (
                    <>
                      <br />
                      <small>{o.review_note}</small>
                    </>
                  )}
                </td>
                <td>{fmtTime(o.created_at)}</td>
                <td className="row">
                  {["pending", "underpaid", "needs_review", "expired"].includes(o.status) && (
                    <button
                      className="btn small primary"
                      onClick={async () => {
                        const amount = Number(prompt(`Số tiền thực nhận cho ${o.code} (VND):`, String(o.amount_vnd)));
                        if (!Number.isFinite(amount)) return;
                        const reference = prompt("Mã giao dịch ngân hàng (để chống xác nhận trùng):") ?? "";
                        try {
                          const r = await api<{ outcome: string }>(`/api/admin/orders/${o.id}/approve`, { body: { amount: Math.round(amount), reference: reference || undefined } });
                          setMsg(`Kết quả: ${r.outcome}`);
                          reload();
                        } catch (e) {
                          setMsg((e as ApiError).message);
                        }
                      }}
                    >
                      Xác nhận đã nhận tiền
                    </button>
                  )}
                  {["pending", "underpaid", "needs_review"].includes(o.status) && (
                    <button
                      className="btn small danger"
                      onClick={async () => {
                        await api(`/api/admin/orders/${o.id}/reject`, { body: { note: prompt("Lý do từ chối:") ?? "" } });
                        reload();
                      }}
                    >
                      Từ chối
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface Promo {
  code: string;
  percent_off: number;
  active: boolean;
  max_uses: number | null;
  per_user_limit: number | null;
  used_count: number;
  valid_from: string | null;
  valid_to: string | null;
  note: string;
}

function PromosTab() {
  const { data, reload } = useApi<{ promos: Promo[] }>("/api/admin/promos");
  const [form, setForm] = useState({ code: "", percent_off: 10, max_uses: "", per_user_limit: "1", valid_to: "", note: "" });
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);
  const save = async (p: Partial<Promo> & { code: string; percent_off: number }) => {
    setMsg(null);
    try {
      await api("/api/admin/promos", { body: { active: true, max_uses: null, per_user_limit: null, valid_from: null, valid_to: null, note: "", ...p } });
      setMsg({ kind: "ok", text: "Đã lưu mã " + p.code + "." });
      reload();
    } catch (e) {
      setMsg({ kind: "error", text: (e as ApiError).message });
    }
  };
  return (
    <div className="stack">
      <div className="card stack">
        <h2>Tạo / sửa mã giảm giá</h2>
        <div className="grid grid-3">
          <label className="field">
            Mã
            <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} maxLength={32} placeholder="VD: KHAITRUONG" />
          </label>
          <label className="field">
            % giảm (1–100)
            <input type="number" min={1} max={100} value={form.percent_off} onChange={(e) => setForm({ ...form, percent_off: Number(e.target.value) })} />
          </label>
          <label className="field">
            Tổng lượt dùng tối đa <small>(trống = không giới hạn)</small>
            <input type="number" min={1} value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value })} />
          </label>
          <label className="field">
            Lượt mỗi tài khoản <small>(trống = không giới hạn)</small>
            <input type="number" min={1} value={form.per_user_limit} onChange={(e) => setForm({ ...form, per_user_limit: e.target.value })} />
          </label>
          <label className="field">
            Hết hạn <small>(trống = không hết hạn)</small>
            <input type="datetime-local" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} />
          </label>
          <label className="field">
            Ghi chú
            <input type="text" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={200} />
          </label>
        </div>
        <button
          className="btn primary"
          onClick={() =>
            save({
              code: form.code.trim(),
              percent_off: form.percent_off,
              max_uses: form.max_uses ? Number(form.max_uses) : null,
              per_user_limit: form.per_user_limit ? Number(form.per_user_limit) : null,
              valid_to: form.valid_to ? new Date(form.valid_to).toISOString() : null,
              note: form.note,
            })
          }
        >
          Lưu mã
        </button>
        <small>Mã giảm 100% sẽ tạo phòng/gia hạn ngay không cần thanh toán, nhưng vẫn trừ slot hệ thống. Thay đổi % chỉ áp dụng cho đơn mới.</small>
        {msg && <p className={"notice " + msg.kind}>{msg.text}</p>}
      </div>
      <div className="card table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Mã</th>
              <th>Giảm</th>
              <th>Đã dùng</th>
              <th>Giới hạn</th>
              <th>Hết hạn</th>
              <th>Trạng thái</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.promos.map((p) => (
              <tr key={p.code}>
                <td>
                  <strong>{p.code}</strong>
                  {p.note && (
                    <>
                      <br />
                      <small>{p.note}</small>
                    </>
                  )}
                </td>
                <td>{p.percent_off}%</td>
                <td>{p.used_count}</td>
                <td>
                  {p.max_uses ?? "∞"} tổng · {p.per_user_limit ?? "∞"}/tài khoản
                </td>
                <td>{p.valid_to ? fmtTime(p.valid_to) : "—"}</td>
                <td>{p.active ? <span className="badge ok">đang bật</span> : <span className="badge">tắt</span>}</td>
                <td>
                  <button className="btn small" onClick={() => save({ ...p, active: !p.active })}>
                    {p.active ? "Tắt" : "Bật"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LogsTab() {
  const { data } = useApi<{ events: { id: string; type: string; data: unknown; created_at: string; actor_name: string | null }[] }>("/api/admin/logs");
  return (
    <div className="card table-wrap">
      <h2>Log hệ thống</h2>
      <table className="data">
        <tbody>
          {data?.events.map((e) => (
            <tr key={e.id}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtTime(e.created_at)}</td>
              <td>{e.type}</td>
              <td>{e.actor_name ?? "Hệ thống"}</td>
              <td>
                <code style={{ fontSize: 12, wordBreak: "break-word" }}>{JSON.stringify(e.data)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<"overview" | "settings" | "orders" | "promos" | "logs">("overview");
  return (
    <AppShell requireLogin>
      {(me) =>
        me.role !== "app_owner" ? (
          <p className="notice error">Chỉ chủ ứng dụng truy cập được trang này.</p>
        ) : (
          <>
            <h1>Quản trị hệ thống</h1>
            <div className="tabs" role="tablist">
              {(
                [
                  ["overview", "Tổng quan"],
                  ["settings", "Cài đặt & giá"],
                  ["orders", "Giao dịch"],
                  ["promos", "Mã giảm giá"],
                  ["logs", "Log"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                  {l}
                </button>
              ))}
            </div>
            {tab === "overview" && <OverviewTab />}
            {tab === "settings" && <SettingsTab />}
            {tab === "orders" && <OrdersTab />}
            {tab === "promos" && <PromosTab />}
            {tab === "logs" && <LogsTab />}
          </>
        )
      }
    </AppShell>
  );
}
