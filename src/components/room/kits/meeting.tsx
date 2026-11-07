"use client";

/**
 * "Phòng họp": an office meeting room — long walnut table, office chairs with backrests, a
 * high-backed leather chair for the chairperson at the head, a wall-mounted projection screen with
 * a ceiling projector, windows onto the city on one side, a whiteboard / cabinet / plants on the
 * other, panel lights in the ceiling.
 *
 * Walls and ceiling are drawn only from the inside (one-sided planes facing in), so the owner's
 * camera above / behind the room looks straight in — like a doll's house.
 * "Tắt đèn" dims the room to presentation mode (the projector beam shows).
 */
import { Instance, Instances } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { MEETING_TABLE_W, type Layout, type Seat } from "@/core/maps";
import type { KitProps, KitSeatsProps } from "./index";

const WALL = "#ece7df";
const WOOD = "#5b3a26";
const FABRIC = "#2f3a4a";
const FRAME = "#1b1d21";

/** Room box from the layout: walls, table and ceiling height. */
export function meetingGeometry(layout: Layout) {
  const sc = layout.screen;
  const head = layout.seats.find((s) => s.chair);
  const tableSeats = layout.seats.filter((s) => s.group === "table");
  const tableEnd = (head?.z ?? 1.5) - 0.75;
  const tableStart = tableSeats.length ? Math.min(...tableSeats.map((s) => s.z)) - 0.45 : tableEnd - 1.2;
  const height = Math.max(3, round(sc.y + sc.height / 2 + 0.35));
  return {
    minX: layout.main.minX,
    maxX: layout.main.maxX,
    front: sc.z - 0.08, // the screen wall
    back: layout.main.maxZ,
    height,
    table: { z0: tableStart, z1: tableEnd, w: MEETING_TABLE_W },
  };
}
const round = (n: number) => Math.round(n * 100) / 100;

function heading(rotY: number) {
  return { fx: -Math.sin(rotY), fz: -Math.cos(rotY), rx: Math.cos(rotY), rz: -Math.sin(rotY) };
}

/** A one-sided wall facing into the room. */
function Wall({ w, h, position, rotY, color = WALL }: { w: number; h: number; position: [number, number, number]; rotY: number; color?: string }) {
  return (
    <mesh position={position} rotation={[0, rotY, 0]}>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
  );
}

function nameplate(text: string) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f6f1e6";
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = "#8a6a2a";
  g.fillRect(0, 56, 256, 8);
  g.fillStyle = "#1d1a16";
  g.font = "bold 34px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Light from the projector lens to the four corners of the screen. */
function beamGeometry(lens: THREE.Vector3, sc: Layout["screen"]) {
  const l = [lens.x, lens.y, lens.z];
  const c = [
    [sc.x - sc.width / 2, sc.y - sc.height / 2, sc.z + 0.02],
    [sc.x + sc.width / 2, sc.y - sc.height / 2, sc.z + 0.02],
    [sc.x + sc.width / 2, sc.y + sc.height / 2, sc.z + 0.02],
    [sc.x - sc.width / 2, sc.y + sc.height / 2, sc.z + 0.02],
  ];
  const v: number[] = [];
  for (let i = 0; i < 4; i++) v.push(...l, ...c[i], ...c[(i + 1) % 4]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  return g;
}

/** Office-tower facade: rows of windows (one canvas, shared by every building). */
function facade() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y * 3) % 7 === 0 ? "#f3e6b8" : "#7f93a8";
      g.fillRect(x * 16 + 3, y * 16 + 4, 10, 9);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** City outside the windows: the room is on a high floor of an office tower above the street. */
function City({ x0, room, lite }: { x0: number; room: { minX: number; maxX: number; front: number; end: number }; lite: boolean }) {
  const base = -30; // street level, far below the meeting room
  const tex = useMemo(() => (typeof document === "undefined" ? null : facade()), []);
  const blocks = useMemo(() => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const out: { x: number; z: number; w: number; d: number; h: number; c: string; map: THREE.Texture | null }[] = [];
    const colors = ["#c9d3dd", "#b4c1cf", "#d8dee4", "#a7b6c6", "#e3e6e9", "#bfcad4"];
    const n = lite ? 16 : 34;
    for (let i = 0; i < n; i++) {
      const far = rnd();
      const w = 8 + rnd() * 14;
      // nearer blocks stay low (the room is high up), far ones rise above the horizon
      const h = 24 + far * 40 + rnd() * 12;
      const map = tex ? tex.clone() : null;
      if (map) {
        map.repeat.set(Math.round(w / 3), Math.round(h / 3));
        map.needsUpdate = true;
      }
      out.push({ x: x0 + 40 + far * 140, z: -120 + rnd() * 240, w, d: 8 + rnd() * 14, h, c: colors[i % colors.length], map });
    }
    return out;
  }, [x0, lite, tex]);
  // the tower is exactly the floor's footprint (room + corridor): its roof is never seen
  const tw = room.maxX - room.minX;
  const td = room.end - room.front;
  const towerTex = useMemo(() => {
    if (!tex) return null;
    const t = tex.clone();
    t.repeat.set(Math.max(1, Math.round(tw / 3)), 10);
    t.needsUpdate = true;
    return t;
  }, [tex, tw]);
  return (
    <group>
      {/* the street and the tower this room is in */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x0 + 60, base, 0]}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#8d9399" roughness={1} />
      </mesh>
      <mesh position={[(room.minX + room.maxX) / 2, base / 2 - 0.02, (room.front + room.end) / 2]}>
        <boxGeometry args={[tw, -base, td]} />
        <meshStandardMaterial color="#b9c6d3" map={towerTex ?? undefined} roughness={0.6} />
      </mesh>
      {blocks.map((b, i) => (
        <mesh key={i} position={[b.x, base + b.h / 2, b.z]}>
          <boxGeometry args={[b.w, b.h, b.d]} />
          <meshStandardMaterial color={b.c} map={b.map ?? undefined} emissive={b.c} emissiveIntensity={0.25} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function Plant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.2, 0.16, 0.44, 16]} />
        <meshStandardMaterial color="#e8e4dc" />
      </mesh>
      <mesh position={[0, 0.85, 0]}>
        <sphereGeometry args={[0.38, 14, 10]} />
        <meshStandardMaterial color="#3f7d4a" roughness={0.9} />
      </mesh>
      <mesh position={[0.12, 1.2, 0.05]}>
        <sphereGeometry args={[0.24, 12, 8]} />
        <meshStandardMaterial color="#4f9159" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** Sky colour behind the windows (set on the scene itself, not on a group). */
function Sky({ color }: { color: string }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const before = scene.background;
    const fog = scene.fog;
    scene.background = new THREE.Color(color);
    scene.fog = null;
    return () => {
      scene.background = before;
      scene.fog = fog;
    };
  }, [scene, color]);
  return null;
}

export function MeetingWorld({ layout, lights, lite, children }: KitProps) {
  const g = meetingGeometry(layout);
  const sc = layout.screen;
  const dim = lights ? 1 : 0.28;
  const W = g.maxX - g.minX;
  const D = g.back - g.front;
  const midZ = (g.front + g.back) / 2;
  const H = g.height;
  const gate = layout.gate;
  const doorW = 1.3;
  const doorH = 2.2;
  const lens = new THREE.Vector3(0, H - 0.42, Math.min(g.table.z1, sc.z + 5.5));
  const beam = useMemo(() => beamGeometry(lens, sc), [lens.y, lens.z, sc]); // eslint-disable-line react-hooks/exhaustive-deps
  const plate = useMemo(() => (typeof document === "undefined" ? null : nameplate("CHỦ TỌA")), []);
  const head = layout.seats.find((s) => s.chair);
  const t = g.table;
  const tLen = t.z1 - t.z0;
  const legs = Math.max(2, Math.ceil(tLen / 2.6));
  // Window bays on the +x wall.
  const bays = Math.max(2, Math.round(D / 1.6));
  const panels = useMemo(() => {
    const out: { x: number; z: number }[] = [];
    for (let z = t.z0 + 0.6; z < t.z1 - 0.3; z += 1.9) out.push({ x: 0, z });
    if (!out.length) out.push({ x: 0, z: (t.z0 + t.z1) / 2 });
    return out;
  }, [t.z0, t.z1]);
  return (
    <group>
      <Sky color={lights ? "#bcd8ee" : "#5d6f84"} />
      <ambientLight intensity={0.55 * dim} />
      <hemisphereLight args={["#ffffff", "#b9a993", 0.55 * dim]} />
      <directionalLight position={[g.maxX + 10, 14, midZ]} intensity={1.1 * (lights ? 1 : 0.4)} color="#fff6e8" />
      {/* glow from the screen (stronger in the dark) */}
      <pointLight position={[sc.x, sc.y, sc.z + 1.5]} intensity={lights ? 3 : 7} distance={12} color="#dfe8ff" />

      {/* floor: grey carpet tiles; corridor outside the door */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(g.minX + g.maxX) / 2, 0, midZ]}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color="#5f6670" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(g.minX + g.maxX) / 2, -0.005, (g.back + layout.waiting.maxZ) / 2]}>
        <planeGeometry args={[W, layout.waiting.maxZ - g.back]} />
        <meshStandardMaterial color="#cdc7bd" roughness={0.6} />
      </mesh>

      {/* screen wall: wood slats */}
      <Wall w={W} h={H} position={[(g.minX + g.maxX) / 2, H / 2, g.front]} rotY={0} color="#7a5a3f" />
      <Instances limit={64}>
        <boxGeometry args={[0.06, H, 0.04]} />
        <meshStandardMaterial color="#8e6c4d" />
        {Array.from({ length: Math.floor(W / 0.22) }, (_, i) => (
          <Instance key={i} position={[g.minX + 0.11 + i * 0.22, H / 2, g.front + 0.02]} />
        ))}
      </Instances>
      {/* left wall */}
      <Wall w={D} h={H} position={[g.minX, H / 2, midZ]} rotY={Math.PI / 2} />
      {/* back wall with the door */}
      <Wall w={gate.x - doorW / 2 - g.minX} h={H} position={[(g.minX + gate.x - doorW / 2) / 2, H / 2, g.back]} rotY={Math.PI} />
      <Wall w={g.maxX - (gate.x + doorW / 2)} h={H} position={[(g.maxX + gate.x + doorW / 2) / 2, H / 2, g.back]} rotY={Math.PI} />
      <Wall w={doorW} h={H - doorH} position={[gate.x, doorH + (H - doorH) / 2, g.back]} rotY={Math.PI} />
      {[-1, 1].map((s) => (
        <mesh key={s} position={[gate.x + (s * (doorW + 0.08)) / 2, doorH / 2, g.back]}>
          <boxGeometry args={[0.08, doorH, 0.16]} />
          <meshStandardMaterial color="#3a2a1e" />
        </mesh>
      ))}
      <mesh position={[gate.x, doorH + 0.04, g.back]}>
        <boxGeometry args={[doorW + 0.16, 0.08, 0.16]} />
        <meshStandardMaterial color="#3a2a1e" />
      </mesh>
      {/* the door, open into the corridor */}
      <mesh position={[gate.x - doorW / 2 + 0.03, doorH / 2, g.back + doorW / 2]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[doorW - 0.06, doorH - 0.04, 0.05]} />
        <meshStandardMaterial color="#9fb7c4" transparent opacity={0.45} roughness={0.1} />
      </mesh>
      {/* window wall (+x): sill, glass, mullions */}
      <Wall w={D} h={0.8} position={[g.maxX, 0.4, midZ]} rotY={-Math.PI / 2} />
      <Wall w={D} h={0.25} position={[g.maxX, H - 0.125, midZ]} rotY={-Math.PI / 2} />
      <mesh position={[g.maxX - 0.1, 0.81, midZ]}>
        <boxGeometry args={[0.24, 0.04, D]} />
        <meshStandardMaterial color="#f4f1ea" />
      </mesh>
      <mesh position={[g.maxX + 0.02, (0.8 + H - 0.25) / 2, midZ]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[D, H - 1.05]} />
        <meshStandardMaterial color="#bcd6e8" transparent opacity={0.18} roughness={0.05} metalness={0.3} side={THREE.DoubleSide} />
      </mesh>
      {Array.from({ length: bays + 1 }, (_, i) => (
        <mesh key={i} position={[g.maxX, (0.8 + H - 0.25) / 2, g.front + (i * D) / bays]}>
          <boxGeometry args={[0.08, H - 1.05, 0.07]} />
          <meshStandardMaterial color="#3d4046" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[g.maxX, 0.8 + (H - 1.05) * 0.55, midZ]}>
        <boxGeometry args={[0.08, 0.05, D]} />
        <meshStandardMaterial color="#3d4046" metalness={0.5} roughness={0.4} />
      </mesh>
      <City x0={g.maxX} room={{ minX: g.minX, maxX: g.maxX, front: g.front, end: layout.waiting.maxZ }} lite={lite} />

      {/* ceiling (seen from below only) with panel lights */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[(g.minX + g.maxX) / 2, H, midZ]}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color="#f3f2ee" roughness={1} />
      </mesh>
      {panels.flatMap((p, i) =>
        [-1, 1].map((s) => (
          <mesh key={`${i}${s}`} rotation={[Math.PI / 2, 0, 0]} position={[s * 1.1, H - 0.01, p.z]}>
            <planeGeometry args={[0.6, 1.2]} />
            <meshStandardMaterial color="#ffffff" emissive="#fffbf0" emissiveIntensity={lights ? 1.2 : 0.05} />
          </mesh>
        )),
      )}

      {/* projection screen: white case + roller box; the picture itself is the stage screen */}
      <mesh position={[sc.x, sc.y, sc.z - 0.03]}>
        <boxGeometry args={[sc.width + 0.14, sc.height + 0.14, 0.03]} />
        <meshStandardMaterial color="#f5f5f3" />
      </mesh>
      <mesh position={[sc.x, sc.y + sc.height / 2 + 0.16, sc.z - 0.02]}>
        <boxGeometry args={[sc.width + 0.4, 0.16, 0.16]} />
        <meshStandardMaterial color="#e9e9e6" metalness={0.2} roughness={0.5} />
      </mesh>
      {/* ceiling projector on its pole, and its beam */}
      <group position={[lens.x, lens.y, lens.z]}>
        <mesh position={[0, 0.03, 0.18]}>
          <boxGeometry args={[0.42, 0.14, 0.36]} />
          <meshStandardMaterial color="#e6e6e2" metalness={0.2} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.03, -0.01]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.045, 0.05, 0.05, 16]} />
          <meshStandardMaterial color="#20242a" emissive="#cfe0ff" emissiveIntensity={0.6} />
        </mesh>
        <mesh position={[0, 0.1 + (H - lens.y - 0.1) / 2, 0.18]}>
          <cylinderGeometry args={[0.02, 0.02, H - lens.y - 0.1, 8]} />
          <meshStandardMaterial color="#8f9296" />
        </mesh>
      </group>
      <mesh geometry={beam}>
        <meshBasicMaterial color="#dfe9ff" transparent opacity={lights ? 0.025 : 0.08} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* long table: walnut top, dark inlay, pedestals */}
      <mesh position={[0, 0.74, (t.z0 + t.z1) / 2]}>
        <boxGeometry args={[t.w, 0.05, tLen]} />
        <meshStandardMaterial color={WOOD} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.767, (t.z0 + t.z1) / 2]}>
        <boxGeometry args={[0.36, 0.006, Math.max(0.2, tLen - 0.8)]} />
        <meshStandardMaterial color="#26262a" roughness={0.6} />
      </mesh>
      {Array.from({ length: legs }, (_, i) => (
        <mesh key={i} position={[0, 0.36, t.z0 + 0.6 + (i * (tLen - 1.2)) / (legs - 1)]}>
          <boxGeometry args={[0.55, 0.72, 0.4]} />
          <meshStandardMaterial color="#3e2819" />
        </mesh>
      ))}
      {/* conference phone in the middle */}
      <mesh position={[0, 0.79, (t.z0 + t.z1) / 2]}>
        <cylinderGeometry args={[0.13, 0.16, 0.04, 3]} />
        <meshStandardMaterial color="#1c1d20" />
      </mesh>
      {/* chairperson's place: nameplate, laptop, microphone */}
      {head && (
        <group position={[0, 0.765, t.z1 - 0.32]}>
          <mesh position={[0, 0.05, -0.12]}>
            <boxGeometry args={[0.36, 0.09, 0.02]} />
            <meshStandardMaterial map={plate ?? undefined} color={plate ? "#ffffff" : "#f6f1e6"} />
          </mesh>
          <mesh position={[0.28, 0.01, 0.05]}>
            <boxGeometry args={[0.34, 0.015, 0.24]} />
            <meshStandardMaterial color="#9aa0a6" metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh position={[0.28, 0.12, -0.07]} rotation={[-0.25, 0, 0]}>
            <boxGeometry args={[0.34, 0.22, 0.012]} />
            <meshStandardMaterial color="#9aa0a6" metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh position={[-0.25, 0.14, -0.02]} rotation={[0.5, 0, 0]}>
            <cylinderGeometry args={[0.006, 0.006, 0.3, 6]} />
            <meshStandardMaterial color="#222" />
          </mesh>
        </group>
      )}

      {/* left wall: whiteboard, low cabinet, wall clock; plants in the corners */}
      <group position={[g.minX + 0.03, 0, 0]}>
        <mesh position={[0, 1.55, Math.min(midZ, t.z1 - 1.2)]}>
          <boxGeometry args={[0.03, 1.15, Math.min(2.6, D * 0.35)]} />
          <meshStandardMaterial color="#fbfbfb" roughness={0.2} />
        </mesh>
        <mesh position={[0.03, 0.96, Math.min(midZ, t.z1 - 1.2)]}>
          <boxGeometry args={[0.06, 0.03, Math.min(2.6, D * 0.35)]} />
          <meshStandardMaterial color="#a9adb2" metalness={0.6} />
        </mesh>
      </group>
      <mesh position={[g.minX + 0.25, 0.38, g.front + 1.1]}>
        <boxGeometry args={[0.45, 0.76, 1.5]} />
        <meshStandardMaterial color="#6e4b33" roughness={0.6} />
      </mesh>
      <mesh position={[g.minX + 0.03, 2.35, g.back - 0.9]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.17, 0.17, 0.03, 24]} />
        <meshStandardMaterial color="#fafafa" />
      </mesh>
      <Plant position={[g.minX + 0.4, 0, g.front + 0.4]} />
      <Plant position={[g.maxX - 0.45, 0, g.front + 0.4]} />
      <Plant position={[g.minX + 0.4, 0, g.back - 0.4]} />
      <Plant position={[g.maxX - 0.45, 0, g.back - 0.4]} />
      {children}
    </group>
  );
}

/** Office chairs (fabric, backrest, armrests, gas lift, star base) + the chairperson's leather chair. */
export function MeetingSeats({ layout, ownSeat }: KitSeatsProps) {
  const seats = layout.seats.filter((s) => !s.chair);
  const head = layout.seats.find((s) => s.chair);
  const at = (s: Seat, back: number, side: number, y: number): [number, number, number] => {
    const h = heading(s.rotY);
    return [s.x - h.fx * back + h.rx * side, s.y + y, s.z - h.fz * back + h.rz * side];
  };
  // Notepads + glasses in front of every place at the table.
  const places = seats.filter((s) => s.group === "table");
  const n = seats.length;
  return (
    <group>
      <Instances limit={Math.max(1, n)}>
        <boxGeometry args={[0.5, 0.08, 0.48]} />
        <meshStandardMaterial color={FABRIC} roughness={0.9} />
        {seats.map((s) => (
          <Instance key={s.id} position={at(s, 0, 0, 0.47)} rotation={[0, s.rotY, 0]} />
        ))}
      </Instances>
      <Instances limit={Math.max(1, n)}>
        <boxGeometry args={[0.48, 0.6, 0.07]} />
        <meshStandardMaterial color={FABRIC} roughness={0.9} />
        {/* the viewer's own backrest is not drawn: it would fill the view when turning around */}
        {seats
          .filter((s) => s.id !== ownSeat)
          .map((s) => (
            <Instance key={s.id} position={at(s, 0.27, 0, 0.86)} rotation={[0, s.rotY, 0]} />
          ))}
      </Instances>
      <Instances limit={Math.max(1, n * 2)}>
        <boxGeometry args={[0.05, 0.05, 0.38]} />
        <meshStandardMaterial color={FRAME} />
        {seats.flatMap((s) => [-1, 1].map((side) => <Instance key={s.id + side} position={at(s, 0.02, side * 0.27, 0.67)} rotation={[0, s.rotY, 0]} />))}
      </Instances>
      <Instances limit={Math.max(1, n)}>
        <cylinderGeometry args={[0.03, 0.03, 0.32, 8]} />
        <meshStandardMaterial color="#8f9296" metalness={0.6} />
        {seats.map((s) => (
          <Instance key={s.id} position={at(s, 0, 0, 0.27)} />
        ))}
      </Instances>
      <Instances limit={Math.max(1, n)}>
        <cylinderGeometry args={[0.3, 0.3, 0.04, 5]} />
        <meshStandardMaterial color={FRAME} />
        {seats.map((s) => (
          <Instance key={s.id} position={at(s, 0, 0, 0.07)} rotation={[0, s.rotY, 0]} />
        ))}
      </Instances>
      {/* table settings: notepad + glass, at the table edge in front of each place */}
      <Instances limit={Math.max(1, places.length)}>
        <boxGeometry args={[0.21, 0.006, 0.28]} />
        <meshStandardMaterial color="#f7f7f2" />
        {places.map((s) => (
          <Instance key={s.id} position={[Math.sign(s.x) * (MEETING_TABLE_W / 2 - 0.22), 0.77, s.z]} rotation={[0, s.x < 0 ? 0.15 : -0.15, 0]} />
        ))}
      </Instances>
      <Instances limit={Math.max(1, places.length)}>
        <cylinderGeometry args={[0.035, 0.03, 0.11, 12]} />
        <meshStandardMaterial color="#cfe6f2" transparent opacity={0.55} roughness={0.05} />
        {places.map((s) => (
          <Instance key={s.id} position={[Math.sign(s.x) * (MEETING_TABLE_W / 2 - 0.42), 0.82, s.z - 0.25]} />
        ))}
      </Instances>
      {head && (
        <group>
          <mesh position={at(head, 0, 0, 0.48)} rotation={[0, head.rotY, 0]}>
            <boxGeometry args={[0.6, 0.12, 0.56]} />
            <meshStandardMaterial color="#3b2418" roughness={0.5} />
          </mesh>
          {head.id !== ownSeat && (
            <>
              <mesh position={at(head, 0.31, 0, 1.0)} rotation={[0, head.rotY, 0]}>
                <boxGeometry args={[0.6, 0.95, 0.12]} />
                <meshStandardMaterial color="#3b2418" roughness={0.5} />
              </mesh>
              <mesh position={at(head, 0.33, 0, 1.55)} rotation={[0, head.rotY, 0]}>
                <boxGeometry args={[0.42, 0.2, 0.12]} />
                <meshStandardMaterial color="#4a2e1f" roughness={0.5} />
              </mesh>
            </>
          )}
          {[-1, 1].map((side) => (
            <mesh key={side} position={at(head, 0.02, side * 0.33, 0.72)} rotation={[0, head.rotY, 0]}>
              <boxGeometry args={[0.08, 0.06, 0.48]} />
              <meshStandardMaterial color="#2a1a12" />
            </mesh>
          ))}
          <mesh position={at(head, 0, 0, 0.27)}>
            <cylinderGeometry args={[0.035, 0.035, 0.32, 8]} />
            <meshStandardMaterial color="#8f9296" metalness={0.6} />
          </mesh>
          <mesh position={at(head, 0, 0, 0.07)}>
            <cylinderGeometry args={[0.34, 0.34, 0.04, 5]} />
            <meshStandardMaterial color="#c8a24a" metalness={0.7} roughness={0.3} />
          </mesh>
        </group>
      )}
    </group>
  );
}
