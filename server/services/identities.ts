import { randomUUID } from "node:crypto";
import type { Db, Queryable } from "../db";
import { getUser, type AppUser } from "./users";

export type Provider = "zalo" | "zalo_oa";

/** Account linked to an external identity, if any. */
export async function userByIdentity(db: Queryable, provider: Provider, providerUid: string): Promise<AppUser | null> {
  const r = await db.query<{ user_id: string }>("select user_id from app.user_identities where provider = $1 and provider_uid = $2", [provider, providerUid]);
  return r.rows[0] ? getUser(db, r.rows[0].user_id) : null;
}

export async function linkIdentity(db: Queryable, provider: Provider, providerUid: string, userId: string, profile: { name?: string; avatar?: string } = {}) {
  await db.query(
    `insert into app.user_identities (provider, provider_uid, user_id, display_name, avatar_url) values ($1, $2, $3, $4, $5)
     on conflict (provider, provider_uid) do update set user_id = excluded.user_id, display_name = coalesce(excluded.display_name, app.user_identities.display_name), avatar_url = coalesce(excluded.avatar_url, app.user_identities.avatar_url)`,
    [provider, providerUid, userId, profile.name ?? null, profile.avatar ?? null],
  );
}

/**
 * Account for a Zalo identity: the linked one, else a new account (no email, no password — the
 * person signs in with Zalo or a one-time link from the bot).
 */
export async function findOrCreateZaloUser(db: Db, provider: Provider, providerUid: string, name: string, avatar?: string): Promise<{ user: AppUser; created: boolean }> {
  const existing = await userByIdentity(db, provider, providerUid);
  if (existing) return { user: existing, created: false };
  const id = randomUUID();
  await db.tx(async (q) => {
    await q.query("insert into app.users (id, email, display_name, is_demo) values ($1, null, $2, false)", [id, name.slice(0, 60) || "Người dùng Zalo"]);
    await linkIdentity(q, provider, providerUid, id, { name, avatar });
  });
  return { user: (await getUser(db, id))!, created: true };
}

/** Zalo OA follower id of an account (where the bot can send reminders), if linked. */
export async function oaUserIdOf(db: Queryable, userId: string): Promise<string | null> {
  const r = await db.query<{ provider_uid: string }>("select provider_uid from app.user_identities where provider = 'zalo_oa' and user_id = $1 order by created_at desc limit 1", [userId]);
  return r.rows[0]?.provider_uid ?? null;
}

export async function hasZalo(db: Queryable, userId: string): Promise<boolean> {
  return !!(await oaUserIdOf(db, userId));
}

export async function identitiesOf(db: Queryable, userId: string) {
  const r = await db.query<{ provider: Provider; display_name: string | null; created_at: Date }>("select provider, display_name, created_at from app.user_identities where user_id = $1", [userId]);
  return r.rows;
}
