/**
 * Built-in MAPs. Layouts are generated deterministically from (map, official capacity) so
 * the server and every client compute the same seat ids/positions without shipping them.
 *
 * Coordinates: metres, y up. The stage screen sits at negative z and faces +z.
 * rotY convention: forward vector = (-sin(rotY), 0, -cos(rotY)); rotY = 0 looks toward -z.
 */

/**
 * Every room type ("MAP"). To add one: a code here, its MAP_INFO entry, a branch in buildLayout
 * (seats + screen), and — for a furnished room — a kit in src/components/room/kits (walls,
 * furniture, chairs). The database stores the code as text, so no migration is needed.
 */
export const MAP_CODES = ["hall", "carpet", "tables", "drive_in", "meeting"] as const;
export type MapCode = (typeof MAP_CODES)[number];
export type AvatarGroup = "people" | "animals" | "vehicles";
export type EntryMode = "auto_assign" | "gate_entry";

export interface Seat {
  id: string;
  x: number;
  z: number;
  /** Floor elevation of the seat (rows / drive-in ramps). */
  y: number;
  rotY: number;
  /** 0 = closest to the screen. */
  rank: number;
  /** Table id for the tables map. */
  group?: string;
  /** The chairperson's seat (meeting room): only the owner / co-hosts may sit there. */
  chair?: boolean;
}

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Layout {
  map: MapCode;
  seats: Seat[];
  screen: { x: number; y: number; z: number; width: number; height: number };
  main: Rect;
  waiting: Rect;
  gate: { x: number; z: number; halfWidth: number };
  /** Eye height above the seat/floor for a seated or walking participant. */
  eyeHeight: number;
  /** Distance between two seat rows (used for the "view from 2 rows behind" camera). */
  rowGap: number;
  /** Max distance from a seat to be allowed to take it ("Vào chỗ"). */
  claimDistance: number;
  /** Movement speed limit in m/s, enforced by the server. */
  maxSpeed: number;
}

/** furnished: the room has its own look (walls, furniture) — the stage styles do not apply. */
export const MAP_INFO: Record<MapCode, { name: string; description: string; groups: AvatarGroup[]; furnished?: boolean }> = {
  hall: { name: "Hội trường ghế ngồi", description: "Ghế hướng về sân khấu, có lối đi giữa, cổng và khu chờ.", groups: ["people", "animals"] },
  carpet: { name: "Khu thảm ngồi", description: "Các tấm thảm hướng về màn hình chung.", groups: ["people", "animals"] },
  tables: { name: "Khu bàn", description: "Mỗi bàn 4 vị trí; mỗi vị trí là một chỗ chính thức.", groups: ["people", "animals"] },
  drive_in: { name: "Rạp chiếu ngoài trời từ ô tô", description: "Ô đỗ dốc dần về sau, so le để hạn chế xe trước che tầm nhìn. Buổi tối, ánh sáng dịu.", groups: ["vehicles"] },
  meeting: { name: "Phòng họp", description: "Bàn họp dài, ghế có lưng dựa, ghế chủ tọa ở đầu bàn, màn chiếu gắn tường — như phòng họp văn phòng.", groups: ["people", "animals"], furnished: true },
};

/** Meeting room: chairs at the long table (both sides, before extra rows along the walls). */
export const MEETING_TABLE_PER_SIDE = 10;
export const MEETING_SEAT_GAP = 0.95;
export const MEETING_TABLE_W = 1.5;

export interface AvatarModel {
  id: string;
  label: string;
  color: string;
  /** People only: boy / girl figure and hair colour. */
  gender?: "male" | "female";
  hair?: string;
}

export const AVATARS: Record<AvatarGroup, { label: string; models: AvatarModel[] }> = {
  people: {
    label: "Người",
    // Ids are kept from the first version (links / sessions stay valid).
    models: [
      { id: "person-teal", label: "Nam · áo xanh ngọc", color: "#2a9d8f", gender: "male", hair: "#2b1d16" },
      { id: "person-orange", label: "Nữ · váy cam san hô", color: "#e76f51", gender: "female", hair: "#3a2318" },
      { id: "person-violet", label: "Nữ · váy tím", color: "#7b5ea7", gender: "female", hair: "#1c1416" },
      { id: "person-yellow", label: "Nam · áo vàng", color: "#e0b440", gender: "male", hair: "#4a2c1a" },
      { id: "person-navy", label: "Nam · vest xanh đen", color: "#26365e", gender: "male", hair: "#141010" },
      { id: "person-rose", label: "Nữ · váy hồng", color: "#e0608f", gender: "female", hair: "#8a5a32" },
    ],
  },
  animals: {
    label: "Động vật",
    models: [
      { id: "cat", label: "Mèo", color: "#f4a261" },
      { id: "dog", label: "Chó", color: "#a0785a" },
      { id: "bear", label: "Gấu", color: "#6d4c41" },
      { id: "rabbit", label: "Thỏ", color: "#e9e4dc" },
    ],
  },
  vehicles: {
    label: "Xe",
    models: [
      // Ids kept from the first version (saved choices stay valid); drawn after VinFast models.
      { id: "mini", label: "VF 3", color: "#f2c230" },
      { id: "suv", label: "VF 7", color: "#1d4f91" },
      { id: "sedan", label: "Limo Green", color: "#1f8f7a" },
      { id: "pickup", label: "VF Wild (bán tải)", color: "#6b7078" },
    ],
  },
};

/** Paint colours a driver may pick for the car (any car model). */
export const CAR_COLORS: { hex: string; label: string }[] = [
  { hex: "#f2f2ee", label: "Trắng" },
  { hex: "#b8bcc2", label: "Bạc" },
  { hex: "#6b7078", label: "Xám" },
  { hex: "#16181c", label: "Đen" },
  { hex: "#c8102e", label: "Đỏ" },
  { hex: "#e8702a", label: "Cam" },
  { hex: "#f2c230", label: "Vàng" },
  { hex: "#8cc63f", label: "Xanh cốm" },
  { hex: "#1f8f7a", label: "Xanh ngọc" },
  { hex: "#5bc0de", label: "Xanh da trời" },
  { hex: "#1d4f91", label: "Xanh dương" },
  { hex: "#6a4c93", label: "Tím" },
  { hex: "#e98aa6", label: "Hồng" },
  { hex: "#7a1f2b", label: "Đỏ đô" },
];

/** A colour from the palette (lower-case hex) or undefined; only cars may be repainted. */
export function validAvatarColor(group: string, color: unknown): string | undefined {
  if (group !== "vehicles" || typeof color !== "string") return undefined;
  const c = color.toLowerCase();
  return CAR_COLORS.some((x) => x.hex === c) ? c : undefined;
}

export function isValidAvatar(group: string, model: string): group is AvatarGroup {
  const g = AVATARS[group as AvatarGroup];
  return !!g && g.models.some((m) => m.id === model);
}

/** Groups the room owner may allow for a given map. */
export function allowedGroupsForMap(map: MapCode): AvatarGroup[] {
  return MAP_INFO[map].groups;
}

function faceToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Floor rise per hall row, metres. */
export const HALL_RISE = 0.35;

export function buildLayout(map: MapCode, capacity: number): Layout {
  const raw: Omit<Seat, "rank" | "id">[] = [];
  let screen = { x: 0, y: 3, z: -6, width: 8, height: 4.5 };
  let eyeHeight = 1.2;
  let rowGap = 1.4;
  let claimDistance = 2.2;
  let maxSpeed = 4;

  if (map === "hall") {
    const perSide = 6;
    const spacing = 1.1;
    const aisle = 1.8;
    for (let i = 0; i < capacity; i++) {
      const row = Math.floor(i / (perSide * 2));
      const col = i % (perSide * 2);
      const side = col < perSide ? -1 : 1;
      const idx = col % perSide;
      const x = side * (aisle / 2 + spacing / 2 + idx * spacing);
      const z = -1 + row * 1.4;
      // 35 cm rise per row (typical raked auditorium) so heads in front do not hide the stage.
      raw.push({ x, z, y: row * HALL_RISE, rotY: 0 });
    }
    eyeHeight = 1.15;
    rowGap = 1.4;
  } else if (map === "carpet") {
    const perRow = 7;
    for (let i = 0; i < capacity; i++) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const offset = row % 2 ? 0.9 : 0;
      raw.push({ x: (col - (perRow - 1) / 2) * 1.8 + offset, z: -1 + row * 1.9, y: 0, rotY: 0 });
    }
    eyeHeight = 0.85;
    rowGap = 1.9;
  } else if (map === "tables") {
    const tablesPerRow = 3;
    const seatsPerTable = 4;
    for (let i = 0; i < capacity; i++) {
      const table = Math.floor(i / seatsPerTable);
      const s = i % seatsPerTable;
      const tRow = Math.floor(table / tablesPerRow);
      const tCol = table % tablesPerRow;
      const tx = (tCol - (tablesPerRow - 1) / 2) * 5.4;
      const tz = -0.5 + tRow * 3;
      raw.push({ x: tx + (s - 1.5) * 1.05, z: tz + 0.75, y: 0, rotY: 0, group: `T${table + 1}` });
    }
    eyeHeight = 1.15;
    rowGap = 3;
  } else if (map === "meeting") {
    // Long table along z (its near end toward the screen wall); chairs on both sides, the
    // chairperson at the far head. More people than the table holds: rows along the walls.
    const others = Math.max(0, capacity - 1);
    const perSide = Math.min(MEETING_TABLE_PER_SIDE, Math.ceil(others / 2));
    const atTable = Math.min(others, perSide * 2);
    const sideX = MEETING_TABLE_W / 2 + 0.5;
    for (let i = 0; i < others; i++) {
      if (i < atTable) {
        const side = i % 2 ? 1 : -1;
        const idx = Math.floor(i / 2);
        raw.push({ x: side * sideX, z: 0.55 + idx * MEETING_SEAT_GAP, y: 0, rotY: 0, group: "table" });
      } else {
        const k = i - atTable;
        const perWallRow = Math.max(1, perSide) * 2;
        const wallRow = Math.floor(k / perWallRow);
        const j = k % perWallRow;
        const side = j % 2 ? 1 : -1;
        raw.push({ x: side * (sideX + 1.2 + wallRow * 1.05), z: 0.55 + Math.floor(j / 2) * MEETING_SEAT_GAP, y: 0, rotY: 0, group: "wall" });
      }
    }
    const tableEnd = 0.1 + Math.max(1, perSide) * MEETING_SEAT_GAP + 0.3;
    raw.push({ x: 0, z: tableEnd + 0.75, y: 0, rotY: 0, chair: true, group: "head" });
    eyeHeight = 1.15;
    rowGap = MEETING_SEAT_GAP;
    claimDistance = 1.5;
    maxSpeed = 2.5;
  } else {
    // Drive-in: each row is raised and staggered by half a bay so the car in front does not
    // fully block the driver's line of sight to the big screen.
    const perRow = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(capacity * 1.6))));
    const bay = 3.6;
    const depth = 7.5;
    for (let i = 0; i < capacity; i++) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const stagger = row % 2 ? bay / 2 : 0;
      raw.push({ x: (col - (perRow - 1) / 2) * bay + stagger, z: 4 + row * depth, y: row * 0.5, rotY: 0 });
    }
    screen = { ...screen, z: -14 };
    eyeHeight = 1.2;
    rowGap = depth;
    claimDistance = 3.2;
    maxSpeed = 9;
  }

  const pad = map === "drive_in" ? 5 : map === "meeting" ? 1.3 : 2;
  if (map === "meeting") {
    // A wall-mounted projection screen at the near end of the table, its bottom ~1 m up.
    const maxAbsX = Math.max(0, ...raw.map((s) => Math.abs(s.x)));
    const width = round(Math.min(5.2, Math.max(3.2, 2.4 + maxAbsX * 0.9)));
    const height = round((width * 9) / 16);
    screen = { x: 0, y: round(1.05 + height / 2), z: -2.2, width, height };
  } else {
    // Stage screen spans ~3/4 of the auditorium width (16:9), bottom edge above the stage.
    const maxAbsX = Math.max(0, ...raw.map((s) => Math.abs(s.x)));
    const width = round(Math.max(map === "drive_in" ? 18 : 8, 0.75 * 2 * (maxAbsX + pad)));
    const height = round((width * 9) / 16);
    const bottom = map === "drive_in" ? 3 : 1;
    // Far enough back that the front row (z ≈ -1) still takes in the whole screen.
    const z = map === "drive_in" ? -14 : round(-1 - 0.6 * width);
    screen = { ...screen, width, height, z, y: round(bottom + height / 2) };
  }

  const seats: Seat[] = raw
    .map((s) => ({ ...s, rotY: round(faceToward(s.x, s.z, screen.x, screen.z)), x: round(s.x), z: round(s.z) }))
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => Math.hypot(a.x - screen.x, a.z - screen.z) - Math.hypot(b.x - screen.x, b.z - screen.z) || a.i - b.i)
    .map(({ i: _i, ...s }, rank) => ({ ...s, id: `S${rank + 1}`, rank }));

  const xs = seats.map((s) => s.x);
  const zs = seats.map((s) => s.z);
  const halfW = Math.max(Math.abs(Math.min(...xs, -screen.width / 2)), Math.abs(Math.max(...xs, screen.width / 2))) + pad;
  const main: Rect = { minX: -halfW, maxX: halfW, minZ: screen.z + 1, maxZ: Math.max(...zs) + pad + 1 };
  const gate = { x: 0, z: main.maxZ, halfWidth: map === "drive_in" ? 3 : 1.5 };
  const waiting: Rect = { minX: -halfW, maxX: halfW, minZ: main.maxZ + 1, maxZ: main.maxZ + (map === "drive_in" ? 16 : 8) };

  return { map, seats, screen, main, waiting, gate, eyeHeight, rowGap, claimDistance, maxSpeed };
}

export function inRect(r: Rect, x: number, z: number): boolean {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

export function clampToRect(r: Rect, x: number, z: number): { x: number; z: number } {
  return { x: Math.min(r.maxX, Math.max(r.minX, x)), z: Math.min(r.maxZ, Math.max(r.minZ, z)) };
}

/** Deterministic spot inside the waiting area for the n-th waiting person. */
export function waitingSpot(layout: Layout, n: number): { x: number; z: number; rotY: number } {
  const w = layout.waiting;
  const step = layout.map === "drive_in" ? 4 : 1.4;
  const perRow = Math.max(1, Math.floor((w.maxX - w.minX - 1) / step));
  const row = Math.floor(n / perRow) % Math.max(1, Math.floor((w.maxZ - w.minZ - 1) / step));
  const col = n % perRow;
  const x = w.minX + 0.5 + step / 2 + col * step;
  const z = w.minZ + 0.5 + step / 2 + row * step;
  return { x: round(x), z: round(z), rotY: round(faceToward(x, z, layout.screen.x, layout.screen.z)) };
}

export function gateEntrySpot(layout: Layout): { x: number; z: number; rotY: number } {
  return { x: layout.gate.x, z: layout.gate.z - 1, rotY: 0 };
}
