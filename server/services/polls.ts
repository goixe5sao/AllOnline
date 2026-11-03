import { z } from "zod";
import type { Db, Queryable } from "../db";
import { AppError } from "./rooms";

export const pollCreateSchema = z.object({
  question: z.string().trim().min(1).max(200),
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(6),
  verifiedOnly: z.boolean().default(false),
});

export interface PollView {
  id: string;
  question: string;
  options: { id: string; label: string; votes: number; pct: number }[];
  status: "draft" | "open" | "closed";
  totalVoters: number;
  verifiedOnly: boolean;
  createdAt: Date;
}

interface PollRow {
  id: string;
  room_id: string;
  question: string;
  options: { id: string; label: string }[];
  status: PollView["status"];
  verified_only: boolean;
  created_at: Date;
}

export async function createPoll(db: Db, roomId: string, actorId: string, input: z.input<typeof pollCreateSchema>) {
  const options = input.options.map((label, i) => ({ id: `o${i + 1}`, label }));
  const r = await db.tx(async (q) => {
    const row = (
      await q.query<{ id: string }>("insert into app.polls (room_id, question, options, created_by, verified_only) values ($1, $2, $3, $4, $5) returning id", [roomId, input.question, JSON.stringify(options), actorId, !!input.verifiedOnly])
    ).rows[0];
    await q.query("insert into app.room_events (room_id, actor_id, type, data) values ($1, $2, 'poll_created', $3)", [roomId, actorId, JSON.stringify({ pollId: row.id, question: input.question, options, verifiedOnly: !!input.verifiedOnly })]);
    return row;
  });
  return r.id;
}

/** Opening a poll closes any other open poll in the room (polls run one after another). */
export async function setPollStatus(db: Db, roomId: string, pollId: string, actorId: string, status: "open" | "closed") {
  return db.tx(async (q) => {
    const poll = (await q.query<PollRow>("select * from app.polls where id = $1 and room_id = $2 for update", [pollId, roomId])).rows[0];
    if (!poll) throw new AppError("POLL_NOT_FOUND", "Không tìm thấy bình chọn.", 404);
    const closedOthers: string[] = [];
    if (status === "open") {
      if (poll.status === "closed") throw new AppError("POLL_CLOSED", "Bình chọn đã đóng, hãy tạo bình chọn mới.", 409);
      const others = await q.query<{ id: string }>("update app.polls set status = 'closed', closed_at = now() where room_id = $1 and status = 'open' and id <> $2 returning id", [roomId, pollId]);
      closedOthers.push(...others.rows.map((r) => r.id));
      await q.query("update app.polls set status = 'open', opened_at = now() where id = $1", [pollId]);
    } else {
      if (poll.status !== "open") throw new AppError("POLL_NOT_OPEN", "Bình chọn không ở trạng thái mở.", 409);
      await q.query("update app.polls set status = 'closed', closed_at = now() where id = $1", [pollId]);
    }
    await q.query("insert into app.room_events (room_id, actor_id, type, data) values ($1, $2, $3, $4)", [roomId, actorId, status === "open" ? "poll_opened" : "poll_closed", JSON.stringify({ pollId })]);
    if (status === "closed") {
      const result = await pollView(q, pollId);
      await q.query("insert into app.room_events (room_id, actor_id, type, data) values ($1, $2, 'poll_result', $3)", [roomId, actorId, JSON.stringify(result)]);
    }
    return closedOthers;
  });
}

/** One ballot per account per poll; can change the answer until the poll closes. */
export async function castVote(db: Db, roomId: string, pollId: string, userId: string, optionId: string, voter: { isGuest: boolean } = { isGuest: false }) {
  await db.tx(async (q) => {
    const poll = (await q.query<PollRow>("select * from app.polls where id = $1 and room_id = $2 for update", [pollId, roomId])).rows[0];
    if (!poll) throw new AppError("POLL_NOT_FOUND", "Không tìm thấy bình chọn.", 404);
    if (poll.status !== "open") throw new AppError("POLL_NOT_OPEN", "Bình chọn chưa mở hoặc đã đóng.", 409);
    if (poll.verified_only && voter.isGuest) throw new AppError("VERIFIED_ONLY", "Bình chọn này chỉ dành cho người có tài khoản đã đăng ký.", 403);
    if (!poll.options.some((o) => o.id === optionId)) throw new AppError("INVALID_OPTION", "Lựa chọn không hợp lệ.");
    await q.query(
      `insert into app.poll_votes (poll_id, user_id, option_id) values ($1, $2, $3)
       on conflict (poll_id, user_id) do update set option_id = excluded.option_id, updated_at = now()`,
      [pollId, userId, optionId],
    );
  });
}

export async function pollView(q: Queryable, pollId: string): Promise<PollView | null> {
  const poll = (await q.query<PollRow>("select * from app.polls where id = $1", [pollId])).rows[0];
  if (!poll) return null;
  const counts = (await q.query<{ option_id: string; n: number }>("select option_id, count(*)::int as n from app.poll_votes where poll_id = $1 group by option_id", [pollId])).rows;
  const total = counts.reduce((a, c) => a + Number(c.n), 0);
  return {
    id: poll.id,
    question: poll.question,
    status: poll.status,
    totalVoters: total,
    verifiedOnly: poll.verified_only,
    createdAt: poll.created_at,
    options: poll.options.map((o) => {
      const votes = Number(counts.find((c) => c.option_id === o.id)?.n ?? 0);
      return { ...o, votes, pct: total ? Math.round((votes / total) * 1000) / 10 : 0 };
    }),
  };
}

export async function listPolls(q: Queryable, roomId: string): Promise<PollView[]> {
  const ids = (await q.query<{ id: string }>("select id from app.polls where room_id = $1 order by created_at", [roomId])).rows;
  const out: PollView[] = [];
  for (const { id } of ids) {
    const v = await pollView(q, id);
    if (v) out.push(v);
  }
  return out;
}

export async function myVotes(q: Queryable, roomId: string, userId: string): Promise<Record<string, string>> {
  const rows = (await q.query<{ poll_id: string; option_id: string }>("select v.poll_id, v.option_id from app.poll_votes v join app.polls p on p.id = v.poll_id where p.room_id = $1 and v.user_id = $2", [roomId, userId])).rows;
  return Object.fromEntries(rows.map((r) => [r.poll_id, r.option_id]));
}
