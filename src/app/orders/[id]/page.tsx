"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { api, ApiError, fmtDuration, fmtTime, useApi } from "@/lib/api";
import { formatVnd, type Quote } from "@/core/pricing";

interface OrderView {
  order: { id: string; code: string; kind: "create_room" | "extend_room"; status: string; amount_vnd: number; slots: number; hold_expires_at: string; quote: Quote; review_note: string | null; room_id: string | null; created_at: string };
  payment: { qrConfigured: boolean; qrImageUrl: string | null; bankBin: string; accountNo: string; accountName: string; transferNote: string };
  demoPayAvailable: boolean;
  room: { id: string; invite_code: string; name: string } | null;
}

const STATUS_TEXT: Record<string, string> = {
  pending: "Chờ thanh toán",
  paid: "Đã xác nhận",
  paid_late: "Đã xác nhận (trễ)",
  expired: "Hết thời gian giữ slot",
  cancelled: "Đã huỷ",
  underpaid: "Thiếu tiền — chờ xử lý",
  needs_review: "Cần chủ ứng dụng xem xét",
};

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <strong>{fmtDuration(new Date(until).getTime() - now)}</strong>;
}

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useApi<OrderView>(`/api/orders/${id}`, 4000);
  const [msg, setMsg] = useState("");

  return (
    <AppShell requireLogin narrow>
      {() => {
        if (error) return <p className="notice error">{error.message}</p>;
        if (!data) return <p className="muted">Đang tải…</p>;
        const o = data.order;
        const pending = o.status === "pending";
        return (
          <div className="stack">
            <div className="card stack">
              <div className="row between">
                <h1 style={{ margin: 0 }}>Đơn {o.code}</h1>
                <span className={`badge ${o.status.startsWith("paid") ? "ok" : pending ? "warn" : "danger"}`}>{STATUS_TEXT[o.status] ?? o.status}</span>
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {o.kind === "create_room" ? "Tạo phòng" : "Gia hạn phòng"} · {o.quote.officialCapacity} chỗ chính thức + {o.quote.waitingCapacity} chờ · {o.quote.durationHours} giờ
                {o.kind === "create_room" && ` · giữ ${o.slots} slot`}
              </p>
              <div className="row between">
                <span>Số tiền</span>
                <strong style={{ fontSize: "1.4rem" }}>{formatVnd(o.amount_vnd)}</strong>
              </div>
              <small>{o.quote.note}. Giá đã chốt tại thời điểm tạo đơn.</small>
              {o.review_note && <p className="notice warn">{o.review_note}</p>}
            </div>

            {pending && (
              <div className="card stack">
                <p>
                  Slot đang được giữ trong <Countdown until={o.hold_expires_at} />. Hết thời gian, đơn tự huỷ và trả slot.
                </p>
                {data.payment.qrConfigured ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={data.payment.qrImageUrl!} alt={`QR chuyển khoản ${o.code}`} width={280} height={280} style={{ alignSelf: "center", background: "#fff", borderRadius: 12 }} />
                    <table className="data">
                      <tbody>
                        <tr>
                          <td>Số tài khoản</td>
                          <td>{data.payment.accountNo}</td>
                        </tr>
                        <tr>
                          <td>Chủ tài khoản</td>
                          <td>{data.payment.accountName}</td>
                        </tr>
                        <tr>
                          <td>Nội dung chuyển khoản</td>
                          <td>
                            <strong>{data.payment.transferNote}</strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <small>Ảnh QR được tạo bởi dịch vụ VietQR (img.vietqr.io) từ cấu hình của chủ ứng dụng.</small>
                  </>
                ) : (
                  <p className="notice warn">Chủ ứng dụng chưa cấu hình tài khoản nhận QR.</p>
                )}
                <p className="notice">
                  Quét QR hay chuyển khoản <strong>không tự động</strong> tạo phòng. Phòng chỉ được tạo khi chủ ứng dụng xác nhận đã nhận tiền, hoặc khi cổng thanh toán gửi webhook đã xác thực.
                </p>
                <div className="row">
                  {data.demoPayAvailable && (
                    <button
                      className="btn primary"
                      onClick={async () => {
                        try {
                          await api(`/api/orders/${o.id}/demo-pay`, { body: {} });
                          reload();
                        } catch (e) {
                          setMsg((e as ApiError).message);
                        }
                      }}
                    >
                      Thanh toán giả (chỉ demo)
                    </button>
                  )}
                  <button
                    className="btn danger"
                    onClick={async () => {
                      try {
                        await api(`/api/orders/${o.id}/cancel`, { body: {} });
                        reload();
                      } catch (e) {
                        setMsg((e as ApiError).message);
                      }
                    }}
                  >
                    Huỷ đơn
                  </button>
                </div>
                {msg && <p className="notice error">{msg}</p>}
              </div>
            )}

            {data.room && (
              <div className="card stack">
                <p className="notice ok">
                  {o.kind === "create_room" ? "Phòng đã được tạo" : "Phòng đã được gia hạn"}: <strong>{data.room.name}</strong>
                </p>
                <div className="row">
                  <Link className="btn primary" href={`/room/${data.room.id}`}>
                    Vào phòng
                  </Link>
                  <code>Mã mời: {data.room.invite_code}</code>
                </div>
              </div>
            )}
            <small className="muted">Tạo lúc {fmtTime(o.created_at)}</small>
          </div>
        );
      }}
    </AppShell>
  );
}
