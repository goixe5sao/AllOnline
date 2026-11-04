import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config";

/** Detects the real file type from magic bytes; the client's Content-Type is not trusted. */
export function sniffMime(buf: Buffer): string | null {
  const b = buf;
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (b.toString("ascii", 0, 4) === "GIF8") return "image/gif";
  if (b.toString("ascii", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (b.toString("ascii", 0, 4) === "OggS") return "audio/ogg";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE") return "audio/wav";
  if (b.toString("ascii", 4, 8) === "ftyp") return "audio/mp4";
  return null;
}

export interface Storage {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

export function createStorage(cfg: Config): Storage {
  if (cfg.mode === "supabase" && cfg.supabaseServiceRoleKey) {
    const base = `${cfg.supabaseUrl}/storage/v1/object/${cfg.storageBucket}`;
    const headers = { Authorization: `Bearer ${cfg.supabaseServiceRoleKey}`, apikey: cfg.supabaseServiceRoleKey };
    return {
      async put(key, data, mime) {
        const r = await fetch(`${base}/${key}`, { method: "POST", headers: { ...headers, "Content-Type": mime, "x-upsert": "false" }, body: new Uint8Array(data) });
        if (!r.ok) throw new Error(`storage put ${r.status}`);
      },
      async get(key) {
        const r = await fetch(`${base}/${key}`, { headers });
        return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      },
      async remove(key) {
        await fetch(`${cfg.supabaseUrl}/storage/v1/object/${cfg.storageBucket}`, { method: "DELETE", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [key] }) });
      },
    };
  }
  const dir = path.join(cfg.dataDir, "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const file = (key: string) => path.join(dir, key.replace(/[^a-zA-Z0-9-]/g, ""));
  return {
    async put(key, data) {
      await fs.promises.writeFile(file(key), data);
    },
    async get(key) {
      try {
        return await fs.promises.readFile(file(key));
      } catch {
        return null;
      }
    },
    async remove(key) {
      await fs.promises.rm(file(key), { force: true });
    },
  };
}
