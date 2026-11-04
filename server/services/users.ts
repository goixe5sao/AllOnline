import type { Queryable } from "../db";

export interface AppUser {
  id: string;
  email: string | null;
  display_name: string;
  role: "app_owner" | "user";
  is_demo: boolean;
  is_guest: boolean;
}

export async function getUser(q: Queryable, id: string): Promise<AppUser | null> {
  return (await q.query<AppUser>("select id, email, display_name, role, is_demo, is_guest from app.users where id = $1", [id])).rows[0] ?? null;
}

/**
 * Creates/refreshes the local user row from a verified identity. The role column is never
 * taken from the identity provider or from user metadata.
 */
export async function upsertUser(q: Queryable, id: string, email: string | null, displayName: string, isDemo: boolean): Promise<AppUser> {
  const name = displayName.trim().slice(0, 60) || "Người dùng";
  return (
    await q.query<AppUser>(
      `insert into app.users (id, email, display_name, is_demo) values ($1, $2, $3, $4)
       on conflict (id) do update set email = excluded.email, updated_at = now()
       returning id, email, display_name, role, is_demo, is_guest`,
      [id, email, name, isDemo],
    )
  ).rows[0];
}

export async function setDisplayName(q: Queryable, id: string, displayName: string) {
  const name = displayName.trim().slice(0, 60);
  if (!name) return;
  await q.query("update app.users set display_name = $2, updated_at = now() where id = $1", [id, name]);
}

/** Guest identity for invite-link visitors (no account). Never gets any role. */
export async function createGuest(q: Queryable, id: string, displayName: string): Promise<AppUser> {
  const name = displayName.trim().slice(0, 60) || "Khách";
  return (
    await q.query<AppUser>(
      "insert into app.users (id, email, display_name, is_guest) values ($1, null, $2, true) returning id, email, display_name, role, is_demo, is_guest",
      [id, name],
    )
  ).rows[0];
}
