import type { Db, Queryable } from "../db";
import { AppError } from "./rooms";

import type { QuestionDto } from "@/core/protocol";
export type { QuestionDto };

interface QuestionRow {
  id: string;
  user_id: string;
  author_name: string;
  text: string;
  status: QuestionDto["status"];
  upvotes: number;
  created_at: string | Date;
}

const toDto = (r: QuestionRow): QuestionDto => ({
  id: r.id,
  text: r.text,
  author: r.author_name,
  authorId: r.user_id,
  votes: Number(r.upvotes),
  status: r.status,
  createdAt: new Date(r.created_at).getTime(),
});

const COLS = "id, user_id, author_name, text, status, upvotes, created_at";

export async function listQuestions(db: Queryable, roomId: string): Promise<QuestionDto[]> {
  const r = await db.query<QuestionRow>(`select ${COLS} from app.room_questions where room_id = $1 order by created_at limit 500`, [roomId]);
  return r.rows.map(toDto);
}

export async function getQuestion(db: Queryable, roomId: string, id: string): Promise<QuestionDto | null> {
  const r = await db.query<QuestionRow>(`select ${COLS} from app.room_questions where id = $1 and room_id = $2`, [id, roomId]);
  return r.rows[0] ? toDto(r.rows[0]) : null;
}

export async function myQuestionVotes(db: Queryable, roomId: string, userId: string): Promise<string[]> {
  const r = await db.query<{ question_id: string }>(
    "select v.question_id from app.room_question_votes v join app.room_questions q on q.id = v.question_id where q.room_id = $1 and v.user_id = $2",
    [roomId, userId],
  );
  return r.rows.map((x) => x.question_id);
}

export async function askQuestion(db: Db, roomId: string, userId: string, authorName: string, text: string): Promise<QuestionDto> {
  const open = await db.query<{ n: number }>("select count(*)::int as n from app.room_questions where room_id = $1 and user_id = $2 and status = 'open'", [roomId, userId]);
  if (open.rows[0].n >= 3) throw new AppError("QA_LIMIT", "Bạn đã có 3 câu hỏi đang chờ. Đợi câu trước được trả lời nhé.");
  const r = await db.query<QuestionRow>(`insert into app.room_questions (room_id, user_id, author_name, text) values ($1, $2, $3, $4) returning ${COLS}`, [roomId, userId, authorName, text]);
  return toDto(r.rows[0]);
}

/** Toggle the caller's upvote. Returns the updated question and whether the vote is now on. */
export async function toggleVote(db: Db, roomId: string, questionId: string, userId: string): Promise<{ q: QuestionDto; on: boolean }> {
  return db.tx(async (q) => {
    const row = (await q.query<QuestionRow>(`select ${COLS} from app.room_questions where id = $1 and room_id = $2 for update`, [questionId, roomId])).rows[0];
    if (!row || row.status === "hidden") throw new AppError("QA_NOT_FOUND", "Không tìm thấy câu hỏi.", 404);
    if (row.user_id === userId) throw new AppError("QA_OWN", "Không tự bình chọn câu hỏi của mình.");
    const del = await q.query("delete from app.room_question_votes where question_id = $1 and user_id = $2 returning 1", [questionId, userId]);
    const on = del.rows.length === 0;
    if (on) await q.query("insert into app.room_question_votes (question_id, user_id) values ($1, $2)", [questionId, userId]);
    const upd = await q.query<QuestionRow>(
      `update app.room_questions set upvotes = (select count(*) from app.room_question_votes where question_id = $1) where id = $1 returning ${COLS}`,
      [questionId],
    );
    return { q: toDto(upd.rows[0]), on };
  });
}

export async function setQuestionStatus(db: Db, roomId: string, questionId: string, status: QuestionDto["status"]): Promise<QuestionDto> {
  const r = await db.query<QuestionRow>(
    `update app.room_questions set status = $3, answered_at = case when $3 = 'answered' then now() else answered_at end where id = $1 and room_id = $2 returning ${COLS}`,
    [questionId, roomId, status],
  );
  if (!r.rows[0]) throw new AppError("QA_NOT_FOUND", "Không tìm thấy câu hỏi.", 404);
  return toDto(r.rows[0]);
}

// ---------- co-hosts ----------

export async function listModerators(db: Queryable, roomId: string): Promise<{ userId: string; name: string; email: string | null }[]> {
  const r = await db.query<{ user_id: string; display_name: string; email: string | null }>(
    "select m.user_id, u.display_name, u.email from app.room_moderators m join app.users u on u.id = m.user_id where m.room_id = $1 order by m.added_at",
    [roomId],
  );
  return r.rows.map((x) => ({ userId: x.user_id, name: x.display_name, email: x.email }));
}

/** Co-hosts and new owners must be registered accounts (guests have no lasting identity). */
async function registeredUser(db: Queryable, by: { userId?: string; email?: string }) {
  const r = by.userId
    ? await db.query<{ id: string; is_guest: boolean; display_name: string }>("select id, is_guest, display_name from app.users where id = $1", [by.userId])
    : await db.query<{ id: string; is_guest: boolean; display_name: string }>("select id, is_guest, display_name from app.users where lower(email) = lower($1)", [by.email ?? ""]);
  const u = r.rows[0];
  if (!u) throw new AppError("USER_NOT_FOUND", "Không tìm thấy tài khoản này. Người đó cần đăng ký tài khoản trước.", 404);
  if (u.is_guest) throw new AppError("GUEST_NOT_ALLOWED", "Khách chưa có tài khoản. Người đó cần đăng ký hoặc đăng nhập trước.");
  return u;
}

export async function addModerator(db: Db, roomId: string, ownerId: string, by: { userId?: string; email?: string }) {
  const u = await registeredUser(db, by);
  if (u.id === ownerId) throw new AppError("ALREADY_OWNER", "Đây là chủ phòng.");
  const n = await db.query<{ n: number }>("select count(*)::int as n from app.room_moderators where room_id = $1", [roomId]);
  if (n.rows[0].n >= 10) throw new AppError("MOD_LIMIT", "Tối đa 10 trợ lý mỗi phòng.");
  await db.query("insert into app.room_moderators (room_id, user_id, added_by) values ($1, $2, $3) on conflict do nothing", [roomId, u.id, ownerId]);
  await db.query("insert into app.room_events (room_id, actor_id, type, data) values ($1, $2, 'moderator_added', $3)", [roomId, ownerId, JSON.stringify({ userId: u.id, name: u.display_name })]);
  return { userId: u.id, name: u.display_name };
}

export async function removeModerator(db: Db, roomId: string, actorId: string, userId: string) {
  await db.query("delete from app.room_moderators where room_id = $1 and user_id = $2", [roomId, userId]);
  await db.query("insert into app.room_events (room_id, actor_id, type, data) values ($1, $2, 'moderator_removed', $3)", [roomId, actorId, JSON.stringify({ userId })]);
}

export async function resolveNewOwner(db: Queryable, by: { userId?: string; email?: string }) {
  return registeredUser(db, by);
}
