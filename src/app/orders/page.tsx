"use client";

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fmtTime, useApi } from "@/lib/api";
import { Badge, DataList, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { formatVnd } from "@/core/pricing";

const STATUS: Record<string, string> = {
  pending: "Chờ thanh toán",
  paid: "Đã xác nhận",
  paid_late: "Đã xác nhận (trễ)",
  expired: "Hết hạn giữ chỗ",
  cancelled: "Đã huỷ",
  underpaid: "Thiếu tiền",
  needs_review: "Cần xem xét",
};

export default function OrdersPage() {
  const { data } = useApi<{ orders: { id: string; code: string; kind: string; status: string; amount_vnd: number; created_at: string }[] }>("/api/orders/mine");
  return (
    <AppShell requireLogin>
      {() => (
        <div className="stack">
          <PageHeader title="Đơn của tôi" subtitle="Theo dõi đơn và trạng thái thanh toán." />
          {!data ? <Skeleton /> : <DataList caption="Đơn của tôi" rows={data.orders} rowKey={o => o.id} empty={<EmptyState title="Chưa có đơn nào" action={<Link className="ui-button ui-button-primary" href="/rooms/new">Tạo phòng</Link>} />} columns={[
            { key: "code", label: "Mã", render: o => <Link href={`/orders/${o.id}`}>{o.code}</Link> },
            { key: "kind", label: "Loại", render: o => o.kind === "create_room" ? "Tạo phòng" : "Gia hạn" },
            { key: "amount", label: "Số tiền", render: o => formatVnd(o.amount_vnd) },
            { key: "status", label: "Trạng thái", render: o => <Badge tone={o.status.startsWith("paid") ? "success" : o.status === "pending" ? "warning" : "danger"}>{STATUS[o.status] ?? o.status}</Badge> },
            { key: "date", label: "Tạo lúc", render: o => fmtTime(o.created_at) },
          ]} />}
        </div>
      )}
    </AppShell>
  );
}
