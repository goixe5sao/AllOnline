"use client";

import { AdminDataList } from "./admin-data-list";

import { useState } from "react";
import { api, ApiError, fmtTime, useApi } from "@/lib/api";
import { formatVnd } from "@/core/pricing";

interface Proof {
  id: string;
  status: "waiting_bank" | "matched" | "approved" | "pending_review" | "rejected";
  note: string | null;
  extracted: { amount_vnd?: number | null; transfer_content?: string | null; bank?: string | null; transferred_at?: string | null; confidence?: string };
  created_at: string;
  user_name: string | null;
  order_code: string | null;
  order_amount: number | null;
  order_status: string | null;
}

interface BankTx {
  id: string;
  amount_vnd: number;
  content: string;
  occurred_at: string | null;
  order_code: string | null;
  outcome: string | null;
}

const LABEL: Record<Proof["status"], string> = { waiting_bank: "Chờ ngân hàng", matched: "Khớp ngân hàng", approved: "Đã duyệt", pending_review: "Cần duyệt", rejected: "Từ chối" };

/** Payment screenshots sent to the Zalo bot, and transfers reported by the bank (SePay). */
export function ProofsTab() {
  const { data, reload } = useApi<{ proofs: Proof[]; bank: BankTx[]; sepay: boolean; receiptAi: boolean; bot: boolean }>("/api/admin/proofs", 15_000);
  const [msg, setMsg] = useState("");
  if (!data) return <p className="muted">Đang tải…</p>;
  return (
    <div className="stack">
      <div className="row">
        <span className={`badge ${data.sepay ? "ok" : "warn"}`}>{data.sepay ? "SePay: đang nhận giao dịch" : "SePay: chưa cấu hình"}</span>
        <span className={`badge ${data.receiptAi ? "ok" : "warn"}`}>{data.receiptAi ? "Đọc ảnh bằng Claude: bật" : "Đọc ảnh: tắt (thiếu ANTHROPIC_API_KEY)"}</span>
        <span className={`badge ${data.bot ? "ok" : "warn"}`}>{data.bot ? "Bot Zalo OA: bật" : "Bot Zalo OA: chưa cấu hình"}</span>
      </div>
      {msg && <p className="notice">{msg}</p>}
      <h2>Ảnh chuyển khoản gửi qua bot</h2>
      {!data.proofs.length ? (
        <p className="muted">Chưa có ảnh nào.</p>
      ) : (
        <div className="table-wrap">
          <AdminDataList>
            <thead>
              <tr>
                <th>Ảnh</th>
                <th>Người gửi / đơn</th>
                <th>Claude đọc được</th>
                <th>Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.proofs.map((p) => (
                <tr key={p.id}>
                  <td>
                    <a href={`/api/admin/proofs/${p.id}/image`} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- private receipt image */}
                      <img src={`/api/admin/proofs/${p.id}/image`} alt="Ảnh chuyển khoản" width={70} style={{ borderRadius: 6 }} />
                    </a>
                  </td>
                  <td>
                    {p.user_name}
                    <br />
                    <small>
                      {p.order_code ?? "—"} {p.order_amount != null && `· ${formatVnd(p.order_amount)}`} {p.order_status && `· ${p.order_status}`}
                    </small>
                  </td>
                  <td>
                    <small>
                      {p.extracted.amount_vnd != null ? formatVnd(p.extracted.amount_vnd) : "?"} · “{p.extracted.transfer_content ?? "?"}”
                      <br />
                      {p.extracted.bank ?? ""} {p.extracted.transferred_at ?? ""} {p.extracted.confidence && `· độ rõ: ${p.extracted.confidence}`}
                    </small>
                  </td>
                  <td>
                    <span className={`badge ${p.status === "pending_review" ? "warn" : p.status === "rejected" ? "" : "ok"}`}>{LABEL[p.status]}</span>
                    {p.note && (
                      <>
                        <br />
                        <small>{p.note}</small>
                      </>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {(p.status === "pending_review" || p.status === "waiting_bank") && (
                      <>
                        <button
                          className="btn"
                          disabled={!p.order_code}
                          onClick={async () => {
                            if (!confirm(`Xác nhận đã nhận tiền cho đơn ${p.order_code}? Phòng sẽ được mở.`)) return;
                            try {
                              const r = await api<{ outcome: string }>(`/api/admin/proofs/${p.id}/approve`, { body: {} });
                              setMsg(`Đơn ${p.order_code}: ${r.outcome}`);
                              reload();
                            } catch (e) {
                              setMsg((e as ApiError).message);
                            }
                          }}
                        >
                          Duyệt
                        </button>{" "}
                        <button
                          className="btn"
                          onClick={async () => {
                            const note = prompt("Lý do từ chối (gửi cho khách qua Zalo):") ?? "";
                            await api(`/api/admin/proofs/${p.id}/reject`, { body: { note } });
                            reload();
                          }}
                        >
                          Từ chối
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminDataList>
        </div>
      )}
      <h2>Giao dịch ngân hàng (SePay)</h2>
      {!data.bank.length ? (
        <p className="muted">Chưa có giao dịch nào.</p>
      ) : (
        <div className="table-wrap">
          <AdminDataList>
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Số tiền</th>
                <th>Nội dung</th>
                <th>Mã đơn</th>
                <th>Kết quả</th>
              </tr>
            </thead>
            <tbody>
              {data.bank.map((b) => (
                <tr key={b.id}>
                  <td>{b.occurred_at ? fmtTime(b.occurred_at) : ""}</td>
                  <td>{formatVnd(b.amount_vnd)}</td>
                  <td>
                    <small>{b.content}</small>
                  </td>
                  <td>{b.order_code ?? "—"}</td>
                  <td>
                    <small>{b.outcome ?? ""}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminDataList>
        </div>
      )}
    </div>
  );
}
