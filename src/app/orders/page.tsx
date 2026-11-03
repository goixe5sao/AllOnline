"use client";

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fmtTime, useApi } from "@/lib/api";
import { formatVnd } from "@/core/pricing";

const STATUS: Record<string, string> = {
  pending: "Chờ thanh toán",
  paid: "Đã xác nhận",
  paid_late: "Đã xác nhận (trễ)",
  expired: "Hết hạn giữ slot",
  cancelled: "Đã huỷ",
  underpaid: "Thiếu tiền",
  needs_review: "Cần xem xét",
};

export default function OrdersPage() {
  const { data } = useApi<{ orders: { id: string; code: string; kind: string; status: string; amount_vnd: number; created_at: string }[] }>("/api/orders/mine");
  return (
    <AppShell requireLogin>
      {() => (
        <div className="card">
          <h1>Đơn của tôi</h1>
          {!data ? (
            <p className="muted">Đang tải…</p>
          ) : !data.orders.length ? (
            <p className="muted">Chưa có đơn nào.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Mã</th>
                    <th>Loại</th>
                    <th>Số tiền</th>
                    <th>Trạng thái</th>
                    <th>Tạo lúc</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/orders/${o.id}`}>{o.code}</Link>
                      </td>
                      <td>{o.kind === "create_room" ? "Tạo phòng" : "Gia hạn"}</td>
                      <td>{formatVnd(o.amount_vnd)}</td>
                      <td>{STATUS[o.status] ?? o.status}</td>
                      <td>{fmtTime(o.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
