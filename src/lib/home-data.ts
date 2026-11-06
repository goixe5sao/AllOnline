import type { MapCode } from "@/core/maps";

/** A room its owner chose to show on the home page. */
export interface HomeRoom {
  id: string;
  name: string;
  description: string;
  map: MapCode;
  officialCapacity: number;
  entryMode: string;
  inviteCode: string;
  openEnded: boolean;
  expiresAt: number;
  hasPassword: boolean;
  ownerName: string;
  live: { admitted: number; seated: number } | null;
  /** Planned start of the event (optional). */
  startsAt?: number | null;
}

/** What the ticket booth on the home page offers (from the app owner's settings). */
export interface HomePricing {
  trial: { enabled: boolean; maxHours: number; maxCapacity: number };
  /** Cheapest package: price and its duration. */
  from: { price: number; hours: number } | null;
  durations: number[];
  openEnded: { enabled: boolean; deposit: number; hourlyFrom: number | null };
}

export interface HomeData {
  rooms: HomeRoom[];
  enabledMaps: MapCode[];
  online: number;
  pricing: HomePricing | null;
}

/**
 * The custom Node server (server/index.ts) runs Next.js in the same process and registers this
 * provider, so the home page is rendered on the server with the live room list (good for SEO)
 * without an HTTP round-trip to itself. Missing during `next build` → empty data.
 */
export type HomeDataProvider = () => Promise<HomeData>;

const KEY = "__allonlineHomeData";

export function registerHomeData(p: HomeDataProvider) {
  (globalThis as Record<string, unknown>)[KEY] = p;
}

export async function getHomeData(): Promise<HomeData> {
  const p = (globalThis as Record<string, unknown>)[KEY] as HomeDataProvider | undefined;
  if (!p) return { rooms: [], enabledMaps: ["hall", "carpet", "tables", "drive_in"], online: 0, pricing: null };
  try {
    return await p();
  } catch (e) {
    console.error("[home]", e);
    return { rooms: [], enabledMaps: ["hall", "carpet", "tables", "drive_in"], online: 0, pricing: null };
  }
}

export function toHomeRoom(
  r: { id: string; name: string; description: string; map_code: MapCode; official_capacity: number; entry_mode: string; invite_code: string; open_ended: boolean; expires_at: Date | string; has_password: boolean; owner_name: string; scheduled_at?: Date | string | null },
  live: { admitted: number; seated: number } | null,
): HomeRoom {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    map: r.map_code,
    officialCapacity: r.official_capacity,
    entryMode: r.entry_mode,
    inviteCode: r.invite_code,
    openEnded: r.open_ended,
    expiresAt: new Date(r.expires_at).getTime(),
    hasPassword: r.has_password,
    ownerName: r.owner_name,
    live,
    startsAt: r.scheduled_at ? new Date(r.scheduled_at).getTime() : null,
  };
}

/** What the invite page needs for its title, description and share image (server-rendered). */
export interface InviteMeta {
  name: string;
  description: string;
  map: MapCode;
  startsAt: number | null;
  isPublic: boolean;
  ownerName: string;
}

const INVITE_KEY = "__allonlineInviteMeta";

export function registerInviteMeta(p: (code: string) => Promise<InviteMeta | null>) {
  (globalThis as Record<string, unknown>)[INVITE_KEY] = p;
}

export async function getInviteMeta(code: string): Promise<InviteMeta | null> {
  const p = (globalThis as Record<string, unknown>)[INVITE_KEY] as ((code: string) => Promise<InviteMeta | null>) | undefined;
  if (!p) return null;
  try {
    return await p(code);
  } catch (e) {
    console.error("[invite-meta]", e);
    return null;
  }
}
