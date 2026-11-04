"use client";

/**
 * 3D room, rendered entirely on the user's device.
 * Models are simple primitives built in code (original, no external assets / licences).
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Instance, Instances, OrbitControls } from "@react-three/drei";
import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { AVATARS, HALL_RISE, clampToRect, type Layout, type Seat } from "@/core/maps";
import type { PublicMember } from "@/core/room-engine";
import type { ClientMsg, RoomRole, StageAd } from "@/core/protocol";
import type { MemberStore } from "./use-room";

export interface Controls {
  yaw: number;
  pitch: number;
  fov: number;
  keys: Set<string>;
  joy: { x: number; y: number };
  /** Auto-walk target set by "Đến" on a free seat (gate-entry mode). */
  goto?: { x: number; z: number; seatId: string; arrivedAt?: number } | null;
}

export function floorY(layout: Layout, z: number, inMain: boolean): number {
  if (!inMain) return 0;
  if (layout.map === "hall") return Math.max(0, Math.floor((z + 1 + 0.7) / 1.4)) * HALL_RISE;
  if (layout.map === "drive_in") return Math.max(0, (z - 4) / 7.5) * 0.5;
  return 0;
}

function headingVec(rotY: number) {
  return { fx: -Math.sin(rotY), fz: -Math.cos(rotY), rx: Math.cos(rotY), rz: -Math.sin(rotY) };
}

// ---------------- avatars ----------------

const SKIN = "#f1c7a5";

function PersonModel({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.22, 0.26, 0.9, 10]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 1.18, 0]}>
        <sphereGeometry args={[0.2, 14, 12]} />
        <meshStandardMaterial color={SKIN} />
      </mesh>
    </group>
  );
}

function AnimalModel({ model, color }: { model: string; color: string }) {
  const ear = model === "rabbit" ? [0.06, 0.35, 0.06] : model === "dog" ? [0.08, 0.18, 0.04] : [0.09, 0.12, 0.09];
  return (
    <group>
      <mesh position={[0, 0.45, 0]} scale={[0.75, 0.6, 0.95]}>
        <sphereGeometry args={[0.45, 14, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.95, -0.05]}>
        <sphereGeometry args={[0.27, 14, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.14, 1.2 + ear[1] / 3, -0.05]} rotation={[0, 0, model === "dog" ? s * 0.5 : 0]}>
          {model === "bear" ? <sphereGeometry args={[0.08, 8, 8]} /> : <boxGeometry args={ear as [number, number, number]} />}
          <meshStandardMaterial color={model === "cat" ? "#d9894a" : color} />
        </mesh>
      ))}
      <mesh position={[0, 0.9, -0.3]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial color="#222" />
      </mesh>
    </group>
  );
}

const CAR_DIMS: Record<string, { w: number; h: number; l: number; cabin: [number, number, number, number]; bed?: boolean }> = {
  sedan: { w: 1.8, h: 0.6, l: 4.4, cabin: [1.6, 0.5, 2.2, 0.1] },
  suv: { w: 1.9, h: 0.85, l: 4.6, cabin: [1.75, 0.6, 2.8, 0.2] },
  pickup: { w: 1.9, h: 0.8, l: 5.2, cabin: [1.75, 0.6, 1.8, -0.9], bed: true },
  mini: { w: 1.6, h: 0.6, l: 3.4, cabin: [1.5, 0.55, 2.0, 0.1] },
};

function CarModel({ model, color }: { model: string; color: string }) {
  const d = CAR_DIMS[model] ?? CAR_DIMS.sedan;
  return (
    <group>
      <mesh position={[0, 0.35 + d.h / 2, 0]}>
        <boxGeometry args={[d.w, d.h, d.l]} />
        <meshStandardMaterial color={color} metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.35 + d.h + d.cabin[1] / 2, d.cabin[3]]}>
        <boxGeometry args={[d.cabin[0], d.cabin[1], d.cabin[2]]} />
        <meshStandardMaterial color="#1b2a35" transparent opacity={0.75} />
      </mesh>
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz]) => (
        <mesh key={`${sx}${sz}`} position={[(sx * d.w) / 2, 0.35, (sz * d.l) / 3]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.35, 0.35, 0.25, 12]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * d.w) / 3, 0.35 + d.h * 0.6, -d.l / 2 - 0.01]}>
          <boxGeometry args={[0.3, 0.12, 0.02]} />
          <meshStandardMaterial color="#fff6d0" emissive="#ffe9a0" emissiveIntensity={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function SimpleModel({ group, color }: { group: string; color: string }) {
  return group === "vehicles" ? (
    <mesh position={[0, 0.8, 0]}>
      <boxGeometry args={[1.8, 1.1, 4.2]} />
      <meshBasicMaterial color={color} />
    </mesh>
  ) : (
    <mesh position={[0, 0.65, 0]}>
      <boxGeometry args={[0.5, 1.3, 0.5]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

const tmpV = new THREE.Vector3();
const tmpA = new THREE.Vector3();

const Avatar = memo(function Avatar({ id, store, layout, lite, bubbleTick, portal }: { id: string; store: MemberStore; layout: Layout; lite: boolean; bubbleTick: number; portal: React.RefObject<HTMLElement | null> }) {
  const g = useRef<THREE.Group>(null);
  const detailed = useRef<THREE.Group>(null);
  const simple = useRef<THREE.Group>(null);
  const tag = useRef<HTMLDivElement>(null);
  const m = store.map.get(id);
  const seat = m?.seatId ? layout.seats.find((s) => s.id === m.seatId) : undefined;
  const { camera } = useThree();

  useFrame((_, dt) => {
    const cur = store.map.get(id);
    if (!cur || !g.current) return;
    const inMain = cur.status !== "waiting";
    const tx = cur.x;
    const tz = cur.z;
    const ty = seat ? seat.y : floorY(layout, tz, inMain);
    const k = Math.min(1, dt * 10);
    g.current.position.x += (tx - g.current.position.x) * k;
    g.current.position.z += (tz - g.current.position.z) * k;
    g.current.position.y += (ty - g.current.position.y) * k;
    let dr = cur.rotY - g.current.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    g.current.rotation.y += dr * k;
    const dist = camera.position.distanceTo(g.current.position);
    const far = dist > (lite ? 18 : 32);
    if (detailed.current) detailed.current.visible = !far;
    if (simple.current) simple.current.visible = far;
    if (tag.current) {
      // Name tags only nearby, and never drawn over the stage screen.
      let show = dist < 7;
      if (show) {
        const sc = layout.screen;
        tmpV.set(g.current.position.x, g.current.position.y + 1.8, g.current.position.z).project(camera);
        const a = tmpA.set(sc.x - sc.width / 2, sc.y - sc.height / 2, sc.z).project(camera);
        const ax = a.x, ay = a.y;
        const b = tmpA.set(sc.x + sc.width / 2, sc.y + sc.height / 2, sc.z).project(camera);
        if (tmpV.x > Math.min(ax, b.x) && tmpV.x < Math.max(ax, b.x) && tmpV.y > Math.min(ay, b.y) && tmpV.y < Math.max(ay, b.y)) show = false;
      }
      tag.current.style.display = show ? "block" : "none";
    }
  });

  if (!m) return null;
  const color = AVATARS[m.avatar.group].models.find((x) => x.id === m.avatar.model)?.color ?? "#888";
  const height = m.avatar.group === "vehicles" ? 2.2 : 1.6;
  const bubble = store.bubbles.get(id);
  const showBubble = bubble && Date.now() - bubble.at < 8000;
  void bubbleTick;

  return (
    <group ref={g} position={[m.x, seat?.y ?? 0, m.z]} rotation={[0, m.rotY, 0]}>
      <group ref={detailed}>
        {m.avatar.group === "people" ? <PersonModel color={color} /> : m.avatar.group === "animals" ? <AnimalModel model={m.avatar.model} color={color} /> : <CarModel model={m.avatar.model} color={color} />}
      </group>
      <group ref={simple} visible={false}>
        <SimpleModel group={m.avatar.group} color={color} />
      </group>
      <Html position={[0, height + 0.15, 0]} portal={portal as React.RefObject<HTMLElement>} style={{ pointerEvents: "none" }} zIndexRange={[16777000, 16776000]}>
        <div>
          {showBubble && <div className="bubble">{bubble!.text}</div>}
          <div ref={tag} className="nametag" style={{ opacity: m.connected ? 1 : 0.5 }}>
            {m.name}
            {!m.connected && " (mất kết nối)"}
          </div>
        </div>
      </Html>
    </group>
  );
});

// ---------------- environment ----------------

function SeatsVisual({ layout, freeHighlight, occupied, selected }: { layout: Layout; freeHighlight: boolean; occupied: Set<string>; selected: string | null }) {
  const seats = layout.seats;
  const tables = useMemo(() => {
    const groups = new Map<string, Seat[]>();
    for (const s of seats) if (s.group) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
    return [...groups.values()].map((list) => ({ x: list.reduce((a, s) => a + s.x, 0) / list.length, z: list[0].z - 0.75, y: 0, w: Math.max(1.6, list.length * 1.05) }));
  }, [seats]);

  return (
    <group>
      {layout.map === "hall" && (
        <>
          <Instances limit={seats.length}>
            <boxGeometry args={[0.6, 0.12, 0.6]} />
            <meshStandardMaterial color="#b8573c" />
            {seats.map((s) => (
              <Instance key={s.id} position={[s.x, s.y + 0.45, s.z]} rotation={[0, s.rotY, 0]} />
            ))}
          </Instances>
          <Instances limit={seats.length}>
            <boxGeometry args={[0.6, 0.65, 0.1]} />
            <meshStandardMaterial color="#8a3a28" />
            {seats.map((s) => {
              const h = headingVec(s.rotY);
              return <Instance key={s.id} position={[s.x - h.fx * 0.3, s.y + 0.8, s.z - h.fz * 0.3]} rotation={[0, s.rotY, 0]} />;
            })}
          </Instances>
        </>
      )}
      {layout.map === "carpet" && (
        <Instances limit={seats.length}>
          <boxGeometry args={[1.3, 0.04, 1.3]} />
          <meshStandardMaterial color="#c9774f" />
          {seats.map((s, i) => (
            <Instance key={s.id} position={[s.x, 0.02, s.z]} rotation={[0, s.rotY, 0]} color={i % 2 ? "#c9774f" : "#4f7fc9"} />
          ))}
        </Instances>
      )}
      {layout.map === "tables" && (
        <>
          {tables.map((t, i) => (
            <mesh key={i} position={[t.x, 0.75, t.z]}>
              <boxGeometry args={[t.w, 0.06, 0.9]} />
              <meshStandardMaterial color="#8d6a4a" />
            </mesh>
          ))}
          <Instances limit={seats.length}>
            <boxGeometry args={[0.5, 0.45, 0.5]} />
            <meshStandardMaterial color="#5a6e7f" />
            {seats.map((s) => (
              <Instance key={s.id} position={[s.x, 0.22, s.z]} />
            ))}
          </Instances>
        </>
      )}
      {layout.map === "drive_in" && (
        <Instances limit={seats.length * 2}>
          <boxGeometry args={[0.12, 0.02, 5.2]} />
          <meshStandardMaterial color="#d8d8c8" emissive="#555" />
          {seats.flatMap((s) => {
            const h = headingVec(s.rotY);
            return [-1, 1].map((side) => <Instance key={s.id + side} position={[s.x + h.rx * side * 1.7, s.y + 0.02, s.z + h.rz * side * 1.7]} rotation={[0, s.rotY, 0]} />);
          })}
        </Instances>
      )}
      {selected &&
        layout.seats
          .filter((s) => s.id === selected)
          .map((s) => (
            <mesh key={"sel" + s.id} position={[s.x, s.y + 0.07, s.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={layout.map === "drive_in" ? [1.3, 1.75, 32] : [0.4, 0.62, 28]} />
              <meshBasicMaterial color="#ffd166" />
            </mesh>
          ))}
      {freeHighlight &&
        seats
          .filter((s) => !occupied.has(s.id))
          .map((s) => (
            <mesh key={"free" + s.id} position={[s.x, s.y + 0.05, s.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={layout.map === "drive_in" ? [1.4, 1.6, 24] : [0.45, 0.55, 20]} />
              <meshBasicMaterial color="#3ddc97" transparent opacity={0.8} />
            </mesh>
          ))}
    </group>
  );
}

function World({ layout, children }: { layout: Layout; children?: ReactNode }) {
  const night = layout.map === "drive_in";
  const m = layout.main;
  const w = layout.waiting;
  const sc = layout.screen;
  const width = m.maxX - m.minX;
  const mainDepth = m.maxZ - (sc.z - 1);
  const fenceLeft = layout.gate.x - layout.gate.halfWidth - m.minX;
  const fenceRight = m.maxX - (layout.gate.x + layout.gate.halfWidth);
  return (
    <group>
      <color attach="background" args={[night ? "#070b16" : "#cfdde3"]} />
      {night ? <fog attach="fog" args={["#070b16", 40, 160]} /> : <fog attach="fog" args={["#cfdde3", 40, 120]} />}
      <ambientLight intensity={night ? 0.5 : 0.7} />
      <hemisphereLight args={[night ? "#4a5a88" : "#ffffff", night ? "#0b0d10" : "#9aa38f", night ? 0.7 : 0.6]} />
      <directionalLight position={[10, 20, 10]} intensity={night ? 0.6 : 1.2} color={night ? "#9fb3ff" : "#fff"} />
      {/* soft light thrown by the screen */}
      <pointLight position={[sc.x, sc.y, sc.z + 6]} intensity={night ? 40 : 10} distance={night ? 90 : 30} color="#dfe8ff" />

      {/* main floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, (sc.z - 1 + m.maxZ) / 2]}>
        <planeGeometry args={[width + 6, mainDepth + 2]} />
        <meshStandardMaterial color={night ? "#2b3138" : layout.map === "carpet" ? "#d9cbb4" : layout.map === "tables" ? "#cdb497" : "#9eaab0"} />
      </mesh>
      {layout.map === "drive_in" &&
        Array.from({ length: Math.ceil((m.maxZ - 4) / 7.5) + 1 }, (_, row) => (
          <mesh key={row} position={[0, row * 0.25, 4 + row * 7.5]}>
            <boxGeometry args={[width, row * 0.5 + 0.02, 7.5]} />
            <meshStandardMaterial color="#30363e" />
          </mesh>
        ))}
      {layout.map === "hall" &&
        Array.from({ length: Math.ceil((m.maxZ + 1) / 1.4) }, (_, row) => (
          <mesh key={row} position={[0, (row * HALL_RISE) / 2, -1 + row * 1.4]}>
            <boxGeometry args={[width, row * HALL_RISE + 0.01, 1.4]} />
            <meshStandardMaterial color="#8d969c" />
          </mesh>
        ))}
      {/* waiting area outside the gate */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, (w.minZ + w.maxZ) / 2]}>
        <planeGeometry args={[w.maxX - w.minX, w.maxZ - w.minZ + 2]} />
        <meshStandardMaterial color={night ? "#14181c" : "#b9c4b0"} />
      </mesh>
      {/* fence with a gate */}
      <mesh position={[m.minX + fenceLeft / 2, 0.6, m.maxZ]}>
        <boxGeometry args={[fenceLeft, 1.2, 0.15]} />
        <meshStandardMaterial color="#6b5440" />
      </mesh>
      <mesh position={[m.maxX - fenceRight / 2, 0.6, m.maxZ]}>
        <boxGeometry args={[fenceRight, 1.2, 0.15]} />
        <meshStandardMaterial color="#6b5440" />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[layout.gate.x + s * layout.gate.halfWidth, 1.6, m.maxZ]}>
          <boxGeometry args={[0.3, 3.2, 0.3]} />
          <meshStandardMaterial color="#c8a24a" emissive={night ? "#5a4210" : "#000"} />
        </mesh>
      ))}
      <mesh position={[layout.gate.x, 3.25, m.maxZ]}>
        <boxGeometry args={[layout.gate.halfWidth * 2 + 0.6, 0.3, 0.3]} />
        <meshStandardMaterial color="#c8a24a" emissive={night ? "#5a4210" : "#000"} />
      </mesh>
      {/* stage / screen frame */}
      {layout.map !== "drive_in" && (
        <mesh position={[sc.x, 0.3, sc.z + 1.2]}>
          <boxGeometry args={[sc.width + 2, 0.6, 2.6]} />
          <meshStandardMaterial color="#4a3b35" />
        </mesh>
      )}
      {layout.map !== "drive_in" && (
        <mesh position={[sc.x, (sc.y + sc.height / 2 + 0.6) / 2, sc.z - 0.3]}>
          <boxGeometry args={[sc.width + 4, sc.y + sc.height / 2 + 0.6, 0.2]} />
          <meshStandardMaterial color="#2a2422" />
        </mesh>
      )}
      <mesh position={[sc.x, sc.y, sc.z - 0.12]}>
        <boxGeometry args={[sc.width + 0.6, sc.height + 0.6, 0.2]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      {layout.map === "drive_in" &&
        [-1, 1].map((s) => (
          <mesh key={s} position={[sc.x + (s * sc.width) / 2.4, (sc.y - sc.height / 2) / 2, sc.z - 0.3]}>
            <boxGeometry args={[0.6, sc.y - sc.height / 2, 0.6]} />
            <meshStandardMaterial color="#222" />
          </mesh>
        ))}
      {children}
    </group>
  );
}

function StageScreen({ layout, children, portal }: { layout: Layout; children: ReactNode; portal: React.RefObject<HTMLElement | null> }) {
  const sc = layout.screen;
  // 960 CSS px wide surface → scale so it spans the screen width in metres.
  const distanceFactor = (400 * sc.width) / 960;
  return (
    <Html
      transform
      occlude="blending"
      // Explicit hole geometry: drei otherwise measures the DOM once, possibly before CSS loads.
      geometry={<planeGeometry args={[sc.width, sc.height]} />}
      distanceFactor={distanceFactor}
      position={[sc.x, sc.y, sc.z]}
      // Stable mount target: drei re-creates its React root if the target changes after mount.
      portal={portal as React.RefObject<HTMLElement>}
      style={{ pointerEvents: "none", width: 960, height: 540 }}
    >
      {children}
    </Html>
  );
}

/**
 * The screen DOM sits behind the WebGL canvas (depth-correct occlusion), so it cannot receive
 * clicks in 3D. A tap/click (not a drag) is ray-cast onto the screen plane instead; if it hits
 * the promo strip (bottom 9% of the screen) the link opens in a new tab.
 */
function AdClickTarget({ layout, ad, domElement }: { layout: Layout; ad: StageAd | null; domElement: HTMLElement | null }) {
  const { camera } = useThree();
  useEffect(() => {
    if (!domElement || !ad) return;
    const sc = layout.screen;
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -sc.z);
    const ray = new THREE.Raycaster();
    const hit = new THREE.Vector3();
    const onStrip = (clientX: number, clientY: number) => {
      const r = domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
      if (!ray.ray.intersectPlane(plane, hit)) return false;
      const bottom = sc.y - sc.height / 2;
      return Math.abs(hit.x - sc.x) <= sc.width / 2 && hit.y >= bottom && hit.y <= bottom + sc.height * 0.09;
    };
    let down: { x: number; y: number; t: number } | null = null;
    const pd = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY, t: performance.now() });
    const pu = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 500) return;
      if (onStrip(e.clientX, e.clientY)) window.open(ad.url, "_blank", "noopener,noreferrer");
    };
    const pm = (e: PointerEvent) => {
      if (e.buttons === 0 && e.pointerType === "mouse") domElement.style.cursor = onStrip(e.clientX, e.clientY) ? "pointer" : "";
    };
    domElement.addEventListener("pointerdown", pd);
    domElement.addEventListener("pointerup", pu);
    domElement.addEventListener("pointermove", pm);
    return () => {
      domElement.removeEventListener("pointerdown", pd);
      domElement.removeEventListener("pointerup", pu);
      domElement.removeEventListener("pointermove", pm);
      domElement.style.cursor = "";
    };
  }, [domElement, ad, layout, camera]);
  return null;
}

/**
 * Tap/click (not a drag) on a free seat: the seat whose projected position is closest to the
 * pointer (within ~45 px) is reported. The canvas itself has no pointer events (DOM occlusion mode).
 */
function SeatClickTarget({ layout, domElement, occupied, onSeatClick }: { layout: Layout; domElement: HTMLElement | null; occupied: Set<string>; onSeatClick?: (seatId: string, x: number, y: number) => void }) {
  const { camera } = useThree();
  useEffect(() => {
    if (!domElement || !onSeatClick) return;
    const v = new THREE.Vector3();
    let down: { x: number; y: number; t: number } | null = null;
    const pd = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY, t: performance.now() });
    const pu = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 500) return;
      const r = domElement.getBoundingClientRect();
      let best: { id: string; dist: number } | null = null;
      for (const s of layout.seats) {
        if (occupied.has(s.id)) continue;
        v.set(s.x, s.y + 0.4, s.z).project(camera);
        if (v.z > 1 || v.z < -1) continue; // behind the camera / clipped
        const sx = r.left + ((v.x + 1) / 2) * r.width;
        const sy = r.top + ((1 - v.y) / 2) * r.height;
        const dist = Math.hypot(sx - e.clientX, sy - e.clientY);
        if (dist < 45 && (!best || dist < best.dist)) best = { id: s.id, dist };
      }
      if (best) onSeatClick(best.id, e.clientX - r.left, e.clientY - r.top);
    };
    domElement.addEventListener("pointerdown", pd);
    domElement.addEventListener("pointerup", pu);
    return () => {
      domElement.removeEventListener("pointerdown", pd);
      domElement.removeEventListener("pointerup", pu);
    };
  }, [domElement, layout, occupied, camera, onSeatClick]);
  return null;
}

// ---------------- cameras ----------------

function ParticipantRig({ layout, store, selfId, controls, send, entryMode }: { layout: Layout; store: MemberStore; selfId: string; controls: React.RefObject<Controls>; send: (m: ClientMsg) => void; entryMode: string }) {
  const { camera } = useThree();
  const self = useRef<{ x: number; z: number; status: string | null; seatId: string | null; lastSent: number; sentX: number; sentZ: number; sentR: number }>({ x: 0, z: 0, status: null, seatId: null, lastSent: 0, sentX: Infinity, sentZ: Infinity, sentR: Infinity });
  const isCar = store.map.get(selfId)?.avatar.group === "vehicles";

  useFrame((_, dt) => {
    const me = store.map.get(selfId);
    const c = controls.current;
    if (!me || !c) return;
    const sf = self.current;
    if (me.status !== sf.status || me.seatId !== sf.seatId) {
      // Status/seat changed on the server → snap to the authoritative position.
      sf.status = me.status;
      sf.seatId = me.seatId;
      sf.x = me.x;
      sf.z = me.z;
      c.yaw = me.status === "seated" || me.status === "invited" ? 0 : me.rotY;
      // Look at the centre of the stage screen (front rows tilt up, back rows level).
      const seatNow = me.seatId ? layout.seats.find((s) => s.id === me.seatId) : undefined;
      const sc = layout.screen;
      const eyeY = (seatNow?.y ?? floorY(layout, me.z, me.status !== "waiting")) + layout.eyeHeight;
      // Seated: look at the screen centre. Walking (finding / waiting): look slightly down so free
      // seats and the floor ahead are visible.
      c.pitch =
        me.status === "seated" || me.status === "invited"
          ? Math.max(-0.7, Math.min(0.7, Math.atan2(sc.y - eyeY, Math.max(1, Math.hypot(sc.x - me.x, sc.z - me.z)))))
          : -0.28;
    }
    if (store.correction) {
      sf.x = store.correction.x;
      sf.z = store.correction.z;
      store.correction = null;
    }
    const seat = me.seatId ? layout.seats.find((s) => s.id === me.seatId) : undefined;
    const movable = (me.status === "finding" || me.status === "waiting") && !(entryMode === "auto_assign" && me.status !== "waiting");
    let heading: number;
    if (seat && me.status === "seated") {
      c.yaw = Math.max(-1.9, Math.min(1.9, c.yaw));
      heading = seat.rotY + c.yaw;
      sf.x = seat.x;
      sf.z = seat.z;
    } else {
      heading = c.yaw;
      if (movable) {
        let f = 0;
        let r = 0;
        if (c.keys.has("w") || c.keys.has("arrowup")) f += 1;
        if (c.keys.has("s") || c.keys.has("arrowdown")) f -= 1;
        if (c.keys.has("d") || c.keys.has("arrowright")) r += 1;
        if (c.keys.has("a") || c.keys.has("arrowleft")) r -= 1;
        f += -c.joy.y;
        r += c.joy.x;
        // "Đến" on a free seat: walk/drive there automatically, then take it. Manual input cancels.
        if (c.goto && (Math.abs(f) > 0.05 || Math.abs(r) > 0.05)) c.goto = null;
        if (c.goto && me.status === "finding") {
          const dx = c.goto.x - sf.x;
          const dz = c.goto.z - sf.z;
          const dist = Math.hypot(dx, dz);
          if (dist <= layout.claimDistance * 0.6) {
            // Arrived: stop, let the final position reach the server (moves are sent ≤10 Hz),
            // then take the seat — the server checks the distance with its own position.
            f = 0;
            r = 0;
            const t = performance.now();
            c.goto.arrivedAt ??= t;
            if (t - c.goto.arrivedAt > 350) {
              send({ t: "claim", seatId: c.goto.seatId });
              c.goto = null;
            }
          } else {
            c.yaw = Math.atan2(-dx, -dz);
            heading = c.yaw;
            // Never step past the target, even with a long frame (slow devices).
            f = Math.min(1, dist / Math.max(1e-3, layout.maxSpeed * 0.75 * dt));
            r = 0;
          }
        }
        if (isCar && !c.goto) {
          // Simple car handling: forward/back + steering.
          c.yaw -= r * dt * 1.6 * Math.sign(f || 1);
          r = 0;
        }
        const len = Math.hypot(f, r);
        if (len > 0.05) {
          const speed = layout.maxSpeed * 0.75;
          const h = headingVec(heading);
          const nx = sf.x + ((h.fx * f + h.rx * r) / Math.max(1, len)) * speed * dt;
          const nz = sf.z + ((h.fz * f + h.rz * r) / Math.max(1, len)) * speed * dt;
          const zone = me.status === "finding" ? layout.main : layout.waiting;
          const p = clampToRect(zone, nx, nz);
          sf.x = p.x;
          sf.z = p.z;
        }
        const now = performance.now();
        if (now - sf.lastSent > 100 && (Math.abs(sf.x - sf.sentX) > 0.02 || Math.abs(sf.z - sf.sentZ) > 0.02 || Math.abs(heading - sf.sentR) > 0.05)) {
          sf.lastSent = now;
          sf.sentX = sf.x;
          sf.sentZ = sf.z;
          sf.sentR = heading;
          send({ t: "move", x: Math.round(sf.x * 100) / 100, z: Math.round(sf.z * 100) / 100, rotY: Math.round(heading * 1000) / 1000 });
          // Own avatar position is predicted locally.
          me.x = sf.x;
          me.z = sf.z;
          me.rotY = heading;
        }
      }
    }
    const baseY = seat && me.status === "seated" ? seat.y : floorY(layout, sf.z, me.status !== "waiting");
    const h = headingVec(heading);
    const driver = isCar ? -0.38 : 0;
    camera.position.set(sf.x + h.rx * driver + h.fx * (isCar ? 0.2 : 0), baseY + layout.eyeHeight + (isCar ? 0.2 : 0), sf.z + h.rz * driver + h.fz * (isCar ? 0.2 : 0));
    camera.rotation.set(0, 0, 0, "YXZ");
    camera.rotation.y = heading;
    camera.rotation.x = c.pitch;
    const pc = camera as THREE.PerspectiveCamera;
    if (Math.abs(pc.fov - c.fov) > 0.05) {
      pc.fov += (c.fov - pc.fov) * Math.min(1, dt * 8);
      pc.updateProjectionMatrix();
    }
  });
  return null;
}

function OwnerRig({ layout, domElement, send }: { layout: Layout; domElement: HTMLElement | null; send: (m: ClientMsg) => void }) {
  const ref = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const last = useRef(0);
  const { camera } = useThree();
  useEffect(() => {
    const m = layout.main;
    camera.position.set(0, 18, m.maxZ + 10);
    ref.current?.target.set(0, 0, (m.minZ + m.maxZ) / 2);
    ref.current?.update();
  }, [camera, layout]);
  useFrame(() => {
    const now = performance.now();
    if (ref.current && now - last.current > 250) {
      last.current = now;
      const t = ref.current.target;
      send({ t: "observe", x: Math.round(t.x * 10) / 10, z: Math.round(t.z * 10) / 10 });
    }
  });
  if (!domElement) return null;
  return <OrbitControls ref={ref} domElement={domElement} enableDamping maxPolarAngle={Math.PI / 2.05} minDistance={2} maxDistance={140} screenSpacePanning={false} />;
}

// ---------------- root ----------------

export interface SceneProps {
  layout: Layout;
  store: MemberStore;
  version: number;
  bubbleTick: number;
  role: RoomRole;
  selfId: string;
  entryMode: string;
  controls: React.RefObject<Controls>;
  send: (m: ClientMsg) => void;
  screen: ReactNode;
  lite: boolean;
  paused: boolean;
  domElement: HTMLElement | null;
  portal: React.RefObject<HTMLElement | null>;
  highlightFree: boolean;
  ad: StageAd | null;
  selectedSeat: string | null;
  onSeatClick?: (seatId: string, x: number, y: number) => void;
}

export function RoomScene(p: SceneProps) {
  const ids = useMemo(
    () => [...p.store.map.keys()].filter((id) => p.role !== "participant" || id !== p.selfId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.version, p.role, p.selfId],
  );
  const occupied = useMemo(
    () => new Set([...p.store.map.values()].filter((m: PublicMember) => m.status === "seated" && m.seatId).map((m) => m.seatId!)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.version],
  );
  return (
    <Canvas
      frameloop={p.paused ? "never" : "always"}
      dpr={p.lite ? 1 : [1, 1.75]}
      gl={{ antialias: !p.lite, alpha: true, powerPreference: p.lite ? "low-power" : "high-performance" }}
      camera={{ fov: 60, near: 0.1, far: 400, position: [0, 2, 10] }}
    >
      <World layout={p.layout}>
        <SeatsVisual layout={p.layout} freeHighlight={p.highlightFree} occupied={occupied} selected={p.selectedSeat} />
        <StageScreen layout={p.layout} portal={p.portal}>
          {p.screen}
        </StageScreen>
        {ids.map((id) => (
          <Avatar key={id} id={id} store={p.store} layout={p.layout} lite={p.lite} bubbleTick={p.bubbleTick} portal={p.portal} />
        ))}
      </World>
      <AdClickTarget layout={p.layout} ad={p.ad} domElement={p.domElement} />
      {p.role === "participant" && <SeatClickTarget layout={p.layout} domElement={p.domElement} occupied={occupied} onSeatClick={p.onSeatClick} />}
      {p.role === "participant" ? (
        <ParticipantRig layout={p.layout} store={p.store} selfId={p.selfId} controls={p.controls} send={p.send} entryMode={p.entryMode} />
      ) : (
        <OwnerRig layout={p.layout} domElement={p.domElement} send={p.send} />
      )}
    </Canvas>
  );
}
