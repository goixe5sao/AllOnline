/**
 * Built-in MAPs. Layouts are generated deterministically from (map, official capacity) so
 * the server and every client compute the same seat ids/positions without shipping them.
 *
 * Coordinates: metres, y up. The stage screen sits at negative z and faces +z.
 * rotY convention: forward vector = (-sin(rotY), 0, -cos(rotY)); rotY = 0 looks toward -z.
 */

export type MapCode = "hall" | "carpet" | "tables" | "drive_in";
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

export const MAP_INFO: Record<MapCode, { name: string; description: string; groups: AvatarGroup[] }> = {
  hall: { name: "Hội trường ghế ngồi", description: "Ghế hướng về sân khấu, có lối đi giữa, cổng và khu chờ.", groups: ["people", "animals"] },
  carpet: { name: "Khu thảm ngồi", description: "Các tấm thảm hướng về màn hình chung.", groups: ["people", "animals"] },
  tables: { name: "Khu bàn", description: "Mỗi bàn 4 vị trí; mỗi vị trí là một chỗ chính thức.", groups: ["people", "animals"] },
  drive_in: { name: "Rạp chiếu ngoài trời từ ô tô", description: "Ô đỗ dốc dần về sau, so le để hạn chế xe trước che tầm nhìn. Buổi tối, ánh sáng dịu.", groups: ["vehicles"] },
};

export const AVATARS: Record<AvatarGroup, { label: string; models: { id: string; label: string; color: string }[] }> = {
  people: {
    label: "Người",
    models: [
      { id: "person-teal", label: "Áo xanh ngọc", color: "#2a9d8f" },
      { id: "person-orange", label: "Áo cam", color: "#e76f51" },
      { id: "person-violet", label: "Áo tím", color: "#7b5ea7" },
      { id: "person-yellow", label: "Áo vàng", color: "#e9c46a" },
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
      { id: "sedan", label: "Sedan", color: "#3a86ff" },
      { id: "suv", label: "SUV", color: "#2b2d42" },
      { id: "pickup", label: "Bán tải", color: "#d62828" },
      { id: "mini", label: "Xe nhỏ", color: "#ffbe0b" },
    ],
  },
};

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

  const pad = map === "drive_in" ? 5 : 2;
  {
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
