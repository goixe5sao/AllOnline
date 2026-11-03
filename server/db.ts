import fs from "node:fs";
import path from "node:path";

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  /** Runs fn inside one transaction; rolls back on throw. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  kind: "postgres" | "pglite";
}

/** Simple async mutex: PGlite has a single connection, so transactions must not interleave. */
class Mutex {
  private last: Promise<void> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.last.then(fn, fn);
    this.last = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export async function openPostgres(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, max: 10, ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false } });
  return {
    kind: "postgres",
    query: (sql, params) => pool.query(sql, params as unknown[]) as never,
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const out = await fn({ query: (sql, params) => client.query(sql, params as unknown[]) as never });
        await client.query("commit");
        return out;
      } catch (e) {
        await client.query("rollback").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function openPglite(dir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dir) fs.mkdirSync(dir, { recursive: true });
  let pg = dir ? new PGlite(dir) : new PGlite();
  try {
    await pg.waitReady;
  } catch (e) {
    if (!dir) throw e;
    // A hard-killed demo process can leave the local data dir unusable. Keep it for
    // inspection and start a fresh demo database instead of refusing to boot.
    await pg.close().catch(() => undefined);
    const backup = `${dir}.broken-${Date.now()}`;
    let target = dir;
    try {
      fs.renameSync(dir, backup);
    } catch {
      // Windows may keep the files locked; use a fresh sibling directory instead.
      target = `${dir}-${Date.now()}`;
    }
    console.warn(`[db] Không mở được CSDL demo (${(e as Error).message}). Bản hỏng giữ tại ${target === dir ? backup : dir}; dùng CSDL demo mới tại ${target}.`);
    fs.mkdirSync(target, { recursive: true });
    pg = new PGlite(target);
    await pg.waitReady;
  }
  const mutex = new Mutex();
  return {
    kind: "pglite",
    query: (sql, params) => mutex.run(() => pg.query(sql, params)) as never,
    exec: (sql) => mutex.run(async () => void (await pg.exec(sql))),
    tx: (fn) => mutex.run(() => pg.transaction((t) => fn({ query: (sql, params) => t.query(sql, params) as never }))),
    close: () => pg.close(),
  };
}

export async function migrate(db: Db, dir = path.join(process.cwd(), "db", "migrations")) {
  await db.exec(
    "create schema if not exists app; create table if not exists app.schema_migrations (name text primary key, applied_at timestamptz not null default now());",
  );
  const done = new Set((await db.query<{ name: string }>("select name from app.schema_migrations")).rows.map((r) => r.name));
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    // Multi-statement SQL needs the simple protocol (exec); wrap it in one transaction.
    try {
      await db.exec(`begin;\n${sql}\n;insert into app.schema_migrations (name) values ('${file.replace(/'/g, "''")}');\ncommit;`);
    } catch (e) {
      await db.exec("rollback").catch(() => undefined);
      throw e;
    }
    console.log(`[db] migrated ${file}`);
  }
}
