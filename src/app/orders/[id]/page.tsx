"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, PageHeader, Skeleton } from "@/components/ui";
import "../orders.css";
import { api, ApiError, fmtDuration, fmtTime, useApi } from "@/lib/api";
import { formatVnd, type Quote } from "@/core/pricing";

interface OrderView {
  order: { id: string; code: string; kind: "create_room" | "extend_room"; status: string; amount_vnd: number; slots: number; hold_expires_at: string; quote: Quote; review_note: string | null; room_id: string | null; created_at: string };
  payment: { qrConfigured: boolean; qrImageUrl: string | null; bankBin: string; accountNo: string; accountName: string; transferNote: string; due: number; autoConfirm: boolean };
  demoPayAvailable: boolean;
  room: { id: string; invite_code: string; name: string } | null;
}

const STATUS_TEXT: Record<string, string> = {
  pending: "Chờ thanh toán",
  paid: "Đã xác nhận",
  paid_late: "Đã xác nhận (trễ)",
  expired: "Hết thời gian giữ chỗ",
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
      {(me) => {
        if (error) return <p className="notice error">{error.message}</p>;
        if (!data) return <Skeleton />;
        const o = data.order;
        const pending = o.status === "pending";
        const topUp = o.status === "underpaid";
        return (
          <div className="stack order-page">
            <PageHeader title={`Đơn ${o.code}`} subtitle="Thông tin đơn và thanh toán" />
            <div className="card stack">
              <div className="row between">
                <h2>Chi tiết đơn</h2>
                <Badge tone={o.status.startsWith("paid") ? "success" : pending ? "warning" : "danger"}>{STATUS_TEXT[o.status] ?? o.status}</Badge>
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {o.kind === "create_room" ? "Tạo phòng" : "Gia hạn phòng"} · {o.quote.officialCapacity} chỗ chính thức + {o.quote.waitingCapacity} chờ · {o.quote.openEnded ? `vô thời hạn (đặt cọc, ${formatVnd(o.quote.openEnded.hourlyRate)}/giờ)` : `${o.quote.durationHours} giờ`}
              </p>
              {(!(pending || topUp) || !data.payment.qrConfigured) && <div className="row between">
                <span>Số tiền</span>
                <strong style={{ fontSize: "1.4rem" }}>{formatVnd(o.amount_vnd)}</strong>
              </div>}
              {o.quote.promo && (
                <p className="notice ok" style={{ margin: 0 }}>
                  Mã {o.quote.promo.code}: giảm {o.quote.promo.percentOff}% (−{formatVnd(o.quote.promo.discount)}, giá gốc {formatVnd(o.quote.promo.amountBefore)})
                </p>
              )}
              <small>Giá đã chốt tại thời điểm tạo đơn.</small>
              {me.role === "app_owner" && <details><summary>Chi tiết hệ thống</summary><p>{o.quote.note} · Giữ {o.slots} slot</p></details>}
              {o.review_note && <p className="notice warn">{o.review_note}</p>}
            </div>

            {(pending || topUp) && (
              <div className="card stack">
                {pending ? (
                  <p>
                    Giữ chỗ <Countdown until={o.hold_expires_at} />, quá giờ đơn tự huỷ.
                  </p>
                ) : (
                  <p className="notice warn">
                    Vui lòng thanh toán phần còn thiếu. Mã QR đã điền sẵn số tiền và nội dung chuyển khoản bên dưới.
                  </p>
                )}
                {data.payment.qrConfigured ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="order-qr" src={data.payment.qrImageUrl!} alt={`QR chuyển khoản ${o.code}`} width={280} height={280} />
                    <dl className="order-bank-details">
                      {[
                        { label: "Ngân hàng", value: data.payment.bankBin },
                        { label: "Số tài khoản", value: data.payment.accountNo, copy: data.payment.accountNo },
                        { label: "Chủ tài khoản", value: data.payment.accountName },
                        { label: "Số tiền", value: formatVnd(data.payment.due), copy: String(data.payment.due) },
                        { label: "Nội dung", value: data.payment.transferNote, copy: data.payment.transferNote },
                      ].map(({ label, value, copy }) => (
                        <div className={copy !== undefined ? "order-copy" : ""} key={label}>
                          <dt>{label}</dt><dd><strong>{value}</strong>{copy !== undefined && <Button size="sm" variant="ghost" aria-label={`Sao chép ${label.toLowerCase()}`} onClick={async () => { try { await navigator.clipboard.writeText(copy); setMsg(`Đã sao chép ${label.toLowerCase()}.`); } catch { setMsg("Không thể sao chép."); } }}><Copy aria-hidden="true" /></Button>}</dd>
                        </div>
                      ))}
                    </dl>
                    <small>Ảnh QR được tạo bởi dịch vụ VietQR (img.vietqr.io) từ cấu hình của chủ ứng dụng.</small>
                  </>
                ) : (
                  <p className="notice warn">Chủ ứng dụng chưa cấu hình tài khoản nhận QR.</p>
                )}
                {data.payment.autoConfirm ? (
                  <p className="notice ok">
                    Chuyển <strong>đúng số tiền</strong> và giữ nguyên nội dung bên trên: tiền vào tài khoản là phòng <strong>tự mở trong vài giây</strong> — trang này tự cập nhật, không cần gửi ảnh.
                  </p>
                ) : (
                  <p className="notice">
                    Quét QR hay chuyển khoản <strong>không tự động</strong> tạo phòng. Phòng chỉ được tạo khi chủ ứng dụng xác nhận đã nhận tiền.
                  </p>
                )}
                <div className="row order-actions">
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
                      Thanh toán thử
                    </button>
                  )}
                  <button
                    className="ui-button ui-button-ghost order-cancel"
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
                {msg && <p className="notice" role="status">{msg}</p>}
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
            <section className="card stack" aria-label="Tiến trình đơn">
              <h2>Tiến trình đơn</h2>
              <ol className="order-timeline">
                <li><strong>Đã tạo đơn</strong><small>{fmtTime(o.created_at)}</small></li>
                <li aria-current="step"><strong>{STATUS_TEXT[o.status] ?? o.status}</strong>{pending && <small>Trang tự cập nhật trạng thái thanh toán.</small>}</li>
                {data.room && <li><strong>{o.kind === "create_room" ? "Phòng đã được tạo" : "Phòng đã được gia hạn"}</strong><small>{data.room.name}</small></li>}
              </ol>
            </section>
          </div>
        );
      }}
    </AppShell>
  );
}
