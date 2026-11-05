"use client";

/**
 * "Sân khấu lung linh" (glam stage): neon frame around the screen, red velvet curtains and valance,
 * sweeping light beams, a colour-cycling LED strip and footlights on the stage edge, neon light
 * pillars along the hall, and sparkles above the audience. Everything is procedural (no assets);
 * glows use unlit additive materials so they look bright without post-processing.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Layout } from "@/core/maps";

const CYAN = "#3df5ff";
const PINK = "#ff4fd8";
const VIOLET = "#8b5cff";
const GOLD = "#ffd38a";

function glow(color: string, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false, depthWrite: opacity === 1, blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending });
}

/** Two neon lines around the stage screen with a soft halo. */
function NeonFrame({ layout }: { layout: Layout }) {
  const sc = layout.screen;
  const mats = useMemo(() => ({ cyan: glow(CYAN), pink: glow(PINK), halo: glow(VIOLET, 0.12) }), []);
  const bars = (pad: number, t: number, m: THREE.Material, key: string) => {
    const w = sc.width + pad * 2;
    const h = sc.height + pad * 2;
    return [
      [0, h / 2, w + t, t],
      [0, -h / 2, w + t, t],
      [-w / 2, 0, t, h + t],
      [w / 2, 0, t, h + t],
    ].map(([x, y, bw, bh], i) => (
      <mesh key={key + i} position={[sc.x + x, sc.y + y, sc.z + 0.03]} material={m}>
        <boxGeometry args={[bw, bh, 0.05]} />
      </mesh>
    ));
  };
  return (
    <group>
      {bars(0.42, 0.09, mats.cyan, "c")}
      {bars(0.62, 0.05, mats.pink, "p")}
      {/* halo behind the bezel: only its rim shows around the frame */}
      <mesh position={[sc.x, sc.y, sc.z - 0.19]} material={mats.halo}>
        <planeGeometry args={[sc.width + 3.2, sc.height + 3.2]} />
      </mesh>
    </group>
  );
}

/** Velvet curtains (vertical folds) on both sides of the screen, valance with a gold trim on top. */
function Curtains({ layout }: { layout: Layout }) {
  const sc = layout.screen;
  const top = sc.y + sc.height / 2 + 1.3;
  const velvet = useMemo(() => new THREE.MeshStandardMaterial({ color: "#7d0d2c", roughness: 0.85, metalness: 0, emissive: "#2a0010", emissiveIntensity: 0.6 }), []);
  const velvetDark = useMemo(() => new THREE.MeshStandardMaterial({ color: "#56081e", roughness: 0.9, emissive: "#1a0008", emissiveIntensity: 0.5 }), []);
  const gold = useMemo(() => glow(GOLD), []);
  const folds = 8;
  const swags = Math.ceil(sc.width / 1.2) + 4;
  return (
    <group>
      {[-1, 1].map((side) =>
        Array.from({ length: folds }, (_, i) => (
          <mesh key={`${side}-${i}`} position={[sc.x + side * (sc.width / 2 + 0.75 + i * 0.36), top / 2, sc.z - 0.05 + (i % 2) * 0.12]} material={i % 2 ? velvetDark : velvet}>
            <cylinderGeometry args={[0.2, 0.24, top, 10, 1]} />
          </mesh>
        )),
      )}
      {/* valance: a row of swags above the screen */}
      <mesh position={[sc.x, top - 0.35, sc.z + 0.1]} material={velvet}>
        <boxGeometry args={[sc.width + 2 * (0.75 + folds * 0.36), 0.8, 0.3]} />
      </mesh>
      {Array.from({ length: swags }, (_, i) => (
        <mesh key={"sw" + i} position={[sc.x - ((swags - 1) * 1.2) / 2 + i * 1.2, top - 0.78, sc.z + 0.16]} rotation={[Math.PI / 2, 0, 0]} material={velvetDark}>
          <cylinderGeometry args={[0.55, 0.55, 0.2, 16, 1, false, 0, Math.PI]} />
        </mesh>
      ))}
      <mesh position={[sc.x, top - 0.73, sc.z + 0.27]} material={gold}>
        <boxGeometry args={[sc.width + 2 * (0.75 + folds * 0.36), 0.05, 0.03]} />
      </mesh>
    </group>
  );
}

/** Colour-cycling LED strip and warm footlights along the front edge of the stage. */
function StageEdge({ layout }: { layout: Layout }) {
  const sc = layout.screen;
  const strip = useRef<THREE.MeshBasicMaterial>(null);
  const w = sc.width + 2;
  const front = sc.z + 2.5;
  useFrame(({ clock }) => strip.current?.color.setHSL((clock.elapsedTime * 0.06) % 1, 1, 0.6));
  const warm = useMemo(() => glow("#ffe2a8"), []);
  const lamps = Math.floor(w / 1.1);
  return (
    <group>
      <mesh position={[sc.x, 0.6, front + 0.02]}>
        <boxGeometry args={[w, 0.07, 0.05]} />
        <meshBasicMaterial ref={strip} toneMapped={false} />
      </mesh>
      {Array.from({ length: lamps }, (_, i) => (
        <mesh key={i} position={[sc.x - ((lamps - 1) * 1.1) / 2 + i * 1.1, 0.66, front - 0.15]} material={warm}>
          <sphereGeometry args={[0.07, 10, 8]} />
        </mesh>
      ))}
    </group>
  );
}

/** Light beams from a truss above the stage, sweeping slowly over the audience. */
function Beams({ layout }: { layout: Layout }) {
  const sc = layout.screen;
  const m = layout.main;
  const apexY = sc.y + sc.height / 2 + 2.2;
  const len = apexY + 2;
  const geo = useMemo(() => {
    const g = new THREE.ConeGeometry(1.9, len, 28, 1, true);
    g.translate(0, -len / 2, 0); // apex at the origin, opening downwards (-Y)
    return g;
  }, [len]);
  const beams = useMemo(
    () =>
      [CYAN, PINK, VIOLET, GOLD].map((c, i) => ({
        color: c,
        x: sc.x + (i - 1.5) * (sc.width / 3.2),
        phase: i * 1.7,
        mat: glow(c, 0.07),
        dot: glow(c),
      })),
    [sc.x, sc.width],
  );
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const down = useMemo(() => new THREE.Vector3(0, -1, 0), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const reach = Math.min(m.maxZ, sc.z + 22);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    beams.forEach((b, i) => {
      const mesh = refs.current[i];
      if (!mesh) return;
      // target sweeps across the hall floor
      const tx = sc.x + Math.sin(t * 0.35 + b.phase) * (m.maxX - m.minX) * 0.42;
      const tz = sc.z + 4 + ((Math.sin(t * 0.27 + b.phase * 1.3) + 1) / 2) * (reach - sc.z - 4);
      dir.set(tx - b.x, -apexY, tz - (sc.z + 2.6)).normalize();
      mesh.quaternion.setFromUnitVectors(down, dir);
    });
  });
  return (
    <group>
      {beams.map((b, i) => (
        <group key={i} position={[b.x, apexY, sc.z + 2.6]}>
          <mesh ref={(el) => void (refs.current[i] = el)} geometry={geo} material={b.mat} />
          <mesh material={b.dot}>
            <sphereGeometry args={[0.16, 12, 10]} />
          </mesh>
        </group>
      ))}
      {/* the truss holding the lights */}
      <mesh position={[sc.x, apexY + 0.15, sc.z + 2.6]}>
        <boxGeometry args={[sc.width + 2, 0.12, 0.12]} />
        <meshStandardMaterial color="#2a2a33" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** Neon pillars along both sides of the hall. */
function Pillars({ layout }: { layout: Layout }) {
  const m = layout.main;
  const sc = layout.screen;
  const mats = useMemo(() => [glow(CYAN), glow(PINK)], []);
  const zs: number[] = [];
  for (let z = sc.z + 3; z <= m.maxZ; z += 4.5) zs.push(z);
  return (
    <group>
      {[m.minX - 1.2, m.maxX + 1.2].flatMap((x, si) =>
        zs.map((z, i) => (
          <group key={`${si}-${i}`} position={[x, 0, z]}>
            <mesh position={[0, 1.8, 0]} material={mats[(i + si) % 2]}>
              <boxGeometry args={[0.08, 3.6, 0.08]} />
            </mesh>
            <mesh position={[0, 3.7, 0]} material={mats[(i + si) % 2]}>
              <sphereGeometry args={[0.13, 10, 8]} />
            </mesh>
          </group>
        )),
      )}
    </group>
  );
}

/** Slowly drifting, twinkling sparkles above the audience. */
/** Soft round dot (points are squares without a texture). */
let dotTex: THREE.Texture | null = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,240,210,0.9)");
  grad.addColorStop(1, "rgba(255,220,180,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

function Sparkles({ layout }: { layout: Layout }) {
  const m = layout.main;
  const sc = layout.screen;
  const ref = useRef<THREE.Points>(null);
  const mat = useRef<THREE.PointsMaterial>(null);
  const positions = useMemo(() => {
    const n = 420;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = m.minX - 3 + Math.random() * (m.maxX - m.minX + 6);
      a[i * 3 + 1] = sc.y + sc.height / 2 + 1 + Math.random() * 7;
      a[i * 3 + 2] = sc.z + Math.random() * (m.maxZ - sc.z + 4);
    }
    return a;
  }, [m.minX, m.maxX, m.maxZ, sc.y, sc.height, sc.z]);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = Math.sin(clock.elapsedTime * 0.2) * 0.3;
    if (mat.current) mat.current.size = 0.22 + Math.sin(clock.elapsedTime * 2.1) * 0.06;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial ref={mat} map={dotTexture()} color="#ffe9c2" size={0.22} sizeAttenuation transparent opacity={0.95} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </points>
  );
}

/** Coloured lights that pulse slowly (they also tint the avatars and seats). */
function MoodLights({ layout }: { layout: Layout }) {
  const sc = layout.screen;
  const a = useRef<THREE.PointLight>(null);
  const b = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (a.current) a.current.intensity = 26 + Math.sin(t * 0.9) * 10;
    if (b.current) b.current.intensity = 26 + Math.cos(t * 0.7) * 10;
  });
  return (
    <>
      <pointLight ref={a} position={[sc.x - sc.width / 2, 3, sc.z + 5]} color={PINK} distance={30} decay={1.6} />
      <pointLight ref={b} position={[sc.x + sc.width / 2, 3, sc.z + 5]} color={CYAN} distance={30} decay={1.6} />
      <pointLight position={[sc.x, sc.y + sc.height / 2 + 2, sc.z + 8]} color="#fff1dc" intensity={30} distance={40} decay={1.4} />
    </>
  );
}

export function GlamStage({ layout, lite }: { layout: Layout; lite: boolean }) {
  const outdoor = layout.map === "drive_in";
  return (
    <group>
      <NeonFrame layout={layout} />
      {!outdoor && <Curtains layout={layout} />}
      {!outdoor && <StageEdge layout={layout} />}
      <Beams layout={layout} />
      <Pillars layout={layout} />
      {!lite && <Sparkles layout={layout} />}
      <MoodLights layout={layout} />
    </group>
  );
}
