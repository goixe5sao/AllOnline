"use client";

import { useState } from "react";
import { Badge, DataList, EmptyState, Input, PageHeader, Select, Skeleton } from "@/components/ui";
import "./logs.css";
import { LIVE_MODE_LABEL, type LiveMode } from "@/core/live";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { fmtTime, useApi } from "@/lib/api";
import { formatVnd } from "@/core/pricing";

const TYPE_VI: Record<string, string> = {
  room_created: "Tạo phòng",
  room_closed: "Đóng phòng",
  slots_released: "Trả slot về hệ thống",
  extended: "Gia hạn",
  owner_changed: "Đổi chủ phòng",
  joined: "Vào phòng",
  reconnected: "Kết nối lại",
  disconnected: "Mất kết nối",
  live_mode: "Đổi quyền live camera",
  live_request: "Xin lên sóng",
  live_granted: "Được duyệt lên sóng",
  live_denied: "Từ chối / thu hồi lên sóng",
  live_started: "Bắt đầu live",
  live_ended: "Kết thúc live",
  left: "Rời phòng",
  switched_room: "Chuyển sang phòng khác",
  grace_expired: "Mất kết nối quá hạn — giải phóng chỗ",
  kicked: "Bị mời ra",
  kick: "Chủ phòng mời ra",
  seat_claimed: "Vào chỗ",
  seat_changed: "Đổi chỗ",
  invited: "Được mời vào chỗ",
  invite_accepted: "Nhận chỗ",
  invite_timeout: "Hết hạn nhận chỗ",
  admitted_to_main: "Được vào khu chính",
  find_seat_timeout: "Hết thời gian tìm chỗ",
  screen_set: "Đổi nội dung màn hình",
  screen_play: "Phát",
  screen_pause: "Dừng",
  screen_seek: "Tua",
  chat_promoted: "Tin chat được đưa lên màn hình",
  poll_created: "Tạo bình chọn",
  poll_opened: "Mở bình chọn",
  poll_closed: "Đóng bình chọn",
  poll_result: "Kết quả bình chọn",
  file_uploaded: "Tải tệp lên",
};

const LIVE_END_VI: Record<string, string> = {
  stopped: "người live tự kết thúc",
  cut: "chủ phòng / trợ lý cắt sóng",
  replaced: "người khác lên sóng thay",
  mode_off: "chủ phòng tắt live",
  broadcaster_left: "người live rời phòng / mất kết nối",
};

/** Why a connection went away (disconnected / reconnected / grace_expired events). */
const REASON_VI: Record<string, string> = {
  closed_tab: "đóng tab / tải lại trang",
  no_response: "máy không phản hồi (tắt màn hình, chuyển app, sóng yếu)",
  network: "rớt mạng / đổi mạng",
  replaced: "mở phòng ở tab hoặc máy khác",
};
const AFTER_VI: Record<string, string> = {
  server_restart: "sau khi máy chủ khởi động lại",
  hold_expired: "quay lại sau khi đã hết giữ chỗ",
};
/** Plain-language summary of the connection events; other events show their raw data. */
function detail(type: string, d: Record<string, unknown>): string | null {
  const why = typeof d.reason === "string" ? REASON_VI[d.reason] : undefined;
  if (type === "disconnected") return `Lý do: ${why ?? "không rõ"} · giữ chỗ ${d.holdSec ?? "?"} giây`;
  if (type === "reconnected") return `Vắng ${d.awaySec ?? "?"} giây${why ? ` · trước đó: ${why}` : ""}`;
  if (type === "grace_expired") return `Không quay lại kịp${why ? ` · lý do: ${why}` : ""} → ghế được trả lại`;
  if (type === "live_mode" && typeof d.mode === "string") return LIVE_MODE_LABEL[d.mode as LiveMode] ?? d.mode;
  if (type === "live_ended") return `${d.name ?? ""} · ${Math.round(Number(d.durationSec ?? 0) / 60)} phút · ${LIVE_END_VI[String(d.reason)] ?? d.reason}`;
  if (type === "live_granted" && d.auto) return "Tự duyệt (phòng cho khán giả tự lên sóng)";
  if (type === "joined" && typeof d.after === "string") return `Vào lại ${AFTER_VI[d.after] ?? d.after}`;
  return null;
}

export default function RoomLogsPage() {
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const { id } = useParams<{ id: string }>();
  const { data, error } = useApi<{
    events: { id: string; type: string; data: Record<string, unknown>; created_at: string; actor_name: string | null }[];
    orders: { code: string; kind: string; status: string; amount_vnd: number; created_at: string; paid_at: string | null }[];
  }>(`/api/rooms/${id}/logs`);
  return (
    <AppShell requireLogin>
      {() => (
        <div className="stack">
          <PageHeader title="Lịch sử phòng" subtitle="Sự kiện, kết nối và thanh toán của phòng." />
          {!data && !error && <Skeleton />}
          <p className="notice">Chat gần thông thường không bao giờ được lưu. Chỉ tin chủ phòng đưa lên màn hình mới có trong log.</p>
          {error && <p className="notice error">{error.message}</p>}
          {data && (
            <>
              <div className="card">
                <h2>Đơn & thanh toán</h2>
                {data.orders.length ? (
                  <DataList caption="Đơn & thanh toán" rows={data.orders} rowKey={o => o.code} columns={[
                    {key: "code", label: "Mã", render: o => o.code},
                    {key: "kind", label: "Loại", render: o => o.kind === "create_room" ? "Tạo phòng" : "Gia hạn"},
                    {key: "amount", label: "Số tiền", render: o => formatVnd(o.amount_vnd)},
                    {key: "status", label: "Trạng thái", render: o => <Badge>{o.status}</Badge>},
                    {key: "date", label: "Thời gian", render: o => fmtTime(o.created_at)},
                  ]} />
                ) : (
                  <p className="muted">Phòng dùng thử / không có đơn.</p>
                )}
              </div>
              <section className="card stack logs-timeline">
                <h2>Sự kiện</h2>
                <div className="logs-filters">
                  <label className="ui-field">Loại sự kiện<Select value={filter} onChange={e => setFilter(e.target.value)}><option value="">Tất cả sự kiện</option>{[...new Set(data.events.map(e => e.type))].map(type => <option key={type} value={type}>{TYPE_VI[type] ?? type}</option>)}</Select></label>
                  <label className="ui-field">Tìm kiếm<Input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Tên, sự kiện hoặc chi tiết" /></label>
                </div>
                <ol>{data.events.filter(e => (!filter || e.type === filter) && `${e.actor_name ?? "Hệ thống"} ${TYPE_VI[e.type] ?? e.type} ${detail(e.type, e.data) ?? JSON.stringify(e.data)}`.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi"))).map(e => <li key={e.id}>
                  <time dateTime={e.created_at}>{fmtTime(e.created_at)}</time>
                  <h3>{TYPE_VI[e.type] ?? e.type}</h3><strong>{e.actor_name ?? "Hệ thống"}</strong>
                  {detail(e.type, e.data) ? <p>{detail(e.type, e.data)}</p> : <details><summary>Chi tiết sự kiện</summary><pre><code>{JSON.stringify(e.data, null, 2)}</code></pre></details>}
                </li>)}</ol>
                {!data.events.some(e => (!filter || e.type === filter) && `${e.actor_name ?? "Hệ thống"} ${TYPE_VI[e.type] ?? e.type} ${detail(e.type, e.data) ?? JSON.stringify(e.data)}`.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi"))) && <EmptyState title="Không có sự kiện phù hợp" />}
              </section>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}
