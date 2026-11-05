import type { Queryable } from "../db";
import { pollView } from "./polls";

/** Owner report for one room: attendance over time, engagement totals, polls, top questions. */
export async function roomReport(db: Queryable, roomId: string) {
  const room = (
    await db.query<{ name: string; starts_at: Date; closed_at: Date | null }>("select name, starts_at, closed_at from app.rooms where id = $1", [roomId])
  ).rows[0];
  const series = (
    await db.query<{ at: Date; connections: number; seated: number; waiting: number; reactions: number; chats: number }>(
      "select at, connections, seated, waiting, reactions, chats from app.room_stats where room_id = $1 order by at",
      [roomId],
    )
  ).rows;
  const peak = series.reduce<{ connections: number; at: number | null }>((best, s) => (s.connections > best.connections ? { connections: s.connections, at: new Date(s.at).getTime() } : best), { connections: 0, at: null });
  const uniq = (await db.query<{ n: number }>("select count(distinct actor_id)::int as n from app.room_events where room_id = $1 and type = 'joined'", [roomId])).rows[0].n;
  const q = (
    await db.query<{ total: number; answered: number }>(
      "select count(*)::int as total, count(*) filter (where status = 'answered')::int as answered from app.room_questions where room_id = $1",
      [roomId],
    )
  ).rows[0];
  const pollIds = (await db.query<{ id: string }>("select id from app.polls where room_id = $1 order by created_at", [roomId])).rows.map((r) => r.id);
  const polls = [];
  for (const id of pollIds) {
    const v = await pollView(db, id);
    if (v) polls.push({ question: v.question, status: v.status, options: v.options.map((o) => ({ label: o.label, votes: o.votes, pct: o.pct })), totalVoters: v.totalVoters });
  }
  const top = (
    await db.query<{ text: string; author_name: string; upvotes: number; status: string }>(
      "select text, author_name, upvotes, status from app.room_questions where room_id = $1 and status <> 'hidden' order by upvotes desc, created_at limit 10",
      [roomId],
    )
  ).rows;
  return {
    room: { name: room?.name ?? "", openedAt: room ? new Date(room.starts_at).getTime() : 0, closedAt: room?.closed_at ? new Date(room.closed_at).getTime() : null },
    peak,
    uniqueVisitors: uniq,
    totals: {
      reactions: series.reduce((a, s) => a + Number(s.reactions), 0),
      chats: series.reduce((a, s) => a + Number(s.chats), 0),
      questions: q.total,
      answered: q.answered,
      polls: polls.length,
      votes: polls.reduce((a, p) => a + p.totalVoters, 0),
    },
    series: series.map((s) => ({ at: new Date(s.at).getTime(), connections: s.connections, seated: s.seated, waiting: s.waiting })),
    polls,
    topQuestions: top.map((t) => ({ text: t.text, author: t.author_name, votes: t.upvotes, status: t.status })),
  };
}

const cell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const vnTime = (ms: number | null) => (ms ? new Date(ms).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "");

/** CSV (UTF-8 with BOM so Excel shows Vietnamese correctly), one section after another. */
export function reportCsv(r: Awaited<ReturnType<typeof roomReport>>): string {
  const lines: string[][] = [
    ["Báo cáo phòng", r.room.name],
    ["Mở lúc", vnTime(r.room.openedAt)],
    ["Đóng lúc", vnTime(r.room.closedAt)],
    ["Đông nhất (kết nối)", String(r.peak.connections), vnTime(r.peak.at)],
    ["Lượt người vào (khác nhau)", String(r.uniqueVisitors)],
    ["Cảm xúc", String(r.totals.reactions)],
    ["Tin chat (chỉ đếm)", String(r.totals.chats)],
    ["Câu hỏi / đã trả lời", String(r.totals.questions), String(r.totals.answered)],
    ["Bình chọn / phiếu", String(r.totals.polls), String(r.totals.votes)],
    [],
    ["Thời điểm", "Kết nối", "Đang ngồi", "Chờ ngoài cổng"],
    ...r.series.map((s) => [vnTime(s.at), String(s.connections), String(s.seated), String(s.waiting)]),
    [],
    ["Bình chọn", "Lựa chọn", "Phiếu", "%"],
    ...r.polls.flatMap((p) => p.options.map((o) => [p.question, o.label, String(o.votes), String(o.pct)])),
    [],
    ["Câu hỏi", "Người hỏi", "Ủng hộ", "Trạng thái"],
    ...r.topQuestions.map((q) => [q.text, q.author, String(q.votes), q.status === "answered" ? "đã trả lời" : "đang chờ"]),
  ];
  return "﻿" + lines.map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n";
}
