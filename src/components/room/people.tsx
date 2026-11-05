"use client";

/**
 * Stylised boy / girl avatars built from primitives (no external models, no licensing).
 * Geometries and materials are shared between all avatars (one per shape / colour), so a full
 * hall costs draw calls but almost no extra memory. Faces look at -Z (towards the screen).
 */
import { memo } from "react";
import * as THREE from "three";

export type Pose = "chair" | "floor" | "stand";
export type Gender = "male" | "female";

const SKIN = "#f2c9a8";
const SKIN_SHADE = "#e3ae8c";

// ---- shared resources ----
const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}
const matCache = new Map<string, THREE.Material>();
function mat(color: string, opts: { rough?: number; metal?: number; emissive?: string; sheen?: boolean } = {}) {
  const key = `${color}|${opts.rough ?? 0.6}|${opts.metal ?? 0}|${opts.emissive ?? ""}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.6, metalness: opts.metal ?? 0, emissive: opts.emissive ?? "#000000", emissiveIntensity: opts.emissive ? 0.6 : 0 });
    matCache.set(key, m);
  }
  return m;
}
const sphere = (r: number, w = 18, h = 14) => geo(`s${r}|${w}`, () => new THREE.SphereGeometry(r, w, h));
const capsule = (r: number, len: number) => geo(`c${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 6, 12));
const cyl = (rt: number, rb: number, h: number, seg = 18) => geo(`y${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, true));
const capHalf = (r: number) => geo(`h${r}`, () => new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55));
const box = (x: number, y: number, z: number) => geo(`b${x}|${y}|${z}`, () => new THREE.BoxGeometry(x, y, z));
const torus = (r: number, t: number) => geo(`t${r}|${t}`, () => new THREE.TorusGeometry(r, t, 8, 20));

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

/** A capsule from point a to point b. */
function Limb({ a, b, r, m }: { a: [number, number, number]; b: [number, number, number]; r: number; m: THREE.Material }) {
  tmpA.set(...a);
  tmpB.set(...b);
  const len = tmpA.distanceTo(tmpB);
  const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  tmpQ.setFromUnitVectors(UP, tmpB.sub(tmpA).normalize());
  return <mesh geometry={capsule(r, Math.max(0.01, Math.round(len * 100) / 100))} material={m} position={mid} quaternion={tmpQ.clone()} />;
}

/** Hip height and joint positions for each pose (metres, avatar-local). */
function skeleton(pose: Pose) {
  if (pose === "stand") {
    const hip = 0.82;
    return {
      hip,
      legs: (s: number) => ({ hip: [s * 0.09, hip, 0] as const, knee: [s * 0.09, 0.45, -0.02] as const, foot: [s * 0.09, 0.08, 0] as const }),
      arms: (s: number) => ({ sh: [s * 0.21, hip + 0.44, 0] as const, el: [s * 0.25, hip + 0.18, 0.02] as const, ha: [s * 0.24, hip - 0.04, -0.03] as const }),
    };
  }
  if (pose === "floor") {
    const hip = 0.14;
    return {
      hip,
      // cross-legged: knees out, feet tucked in front of the other shin
      legs: (s: number) => ({ hip: [s * 0.09, hip, 0] as const, knee: [s * 0.32, 0.16, -0.24] as const, foot: [-s * 0.08, 0.07, -0.3] as const }),
      arms: (s: number) => ({ sh: [s * 0.21, hip + 0.44, 0] as const, el: [s * 0.26, hip + 0.22, -0.08] as const, ha: [s * 0.22, hip + 0.1, -0.24] as const }),
    };
  }
  const hip = 0.53; // chair seat ~0.51
  return {
    hip,
    legs: (s: number) => ({ hip: [s * 0.1, hip, 0.02] as const, knee: [s * 0.11, hip + 0.03, -0.38] as const, foot: [s * 0.11, 0.07, -0.44] as const }),
    arms: (s: number) => ({ sh: [s * 0.21, hip + 0.44, 0.02] as const, el: [s * 0.25, hip + 0.2, -0.06] as const, ha: [s * 0.17, hip + 0.1, -0.3] as const }),
  };
}

/** Name tag (body centre) and chat / reaction (just above the head) heights per pose. */
export const POSE_HEIGHTS: Record<Pose, { body: number; headTop: number }> = {
  chair: { body: 0.78, headTop: 1.52 },
  floor: { body: 0.42, headTop: 1.13 },
  stand: { body: 1.05, headTop: 1.8 },
};

export const HumanModel = memo(function HumanModel({ color, gender, hair, pose }: { color: string; gender: Gender; hair: string; pose: Pose }) {
  const k = skeleton(pose);
  const girl = gender === "female";
  const skin = mat(SKIN, { rough: 0.55 });
  const top = mat(color, { rough: 0.5 });
  const pants = mat(girl ? color : "#2c3a55", { rough: 0.7 });
  const shoe = mat(girl ? "#f4f0ea" : "#1c1c22", { rough: 0.4 });
  const hairM = mat(hair, { rough: 0.45, metal: 0.05 });
  const dark = mat("#1d1a24", { rough: 0.3 });
  const white = mat("#ffffff", { rough: 0.3 });
  const blush = mat("#f39aa6", { rough: 0.8 });
  const lip = mat(girl ? "#d9536b" : SKIN_SHADE, { rough: 0.5 });
  const accent = mat(girl ? "#ff5fa8" : "#f0f0f0", { rough: 0.4 });
  const torsoY = k.hip + 0.24;
  const neckY = k.hip + 0.5;
  const headY = k.hip + 0.71;
  return (
    <group>
      {/* legs: thigh + shin (girls: bare shins under the skirt) + shoes */}
      {[-1, 1].map((s) => {
        const L = k.legs(s);
        return (
          <group key={"l" + s}>
            <Limb a={[...L.hip]} b={[...L.knee]} r={0.078} m={girl ? skin : pants} />
            <Limb a={[...L.knee]} b={[...L.foot]} r={0.064} m={girl ? skin : pants} />
            <mesh geometry={box(0.11, 0.08, 0.22)} material={shoe} position={[L.foot[0], 0.045, L.foot[2] - 0.05]} />
          </group>
        );
      })}
      {/* torso: rounded jacket / dress top, slight taper */}
      <mesh geometry={capsule(0.165, 0.3)} material={top} position={[0, torsoY, 0]} scale={[1.08, 1, 0.8]} />
      {girl ? (
        // skirt: open cone around the hips (spreads over the lap when seated)
        <mesh geometry={cyl(0.17, pose === "stand" ? 0.27 : 0.31, 0.28)} material={mat(color, { rough: 0.55 })} position={[0, k.hip + 0.02, pose === "stand" ? 0 : -0.06]} rotation={[pose === "stand" ? 0 : 0.35, 0, 0]} />
      ) : (
        <>
          {/* collar + belt */}
          <mesh geometry={torus(0.09, 0.025)} material={accent} position={[0, neckY - 0.06, 0]} rotation={[Math.PI / 2, 0, 0]} />
          <mesh geometry={cyl(0.18, 0.18, 0.05)} material={dark} position={[0, k.hip + 0.06, 0]} />
        </>
      )}
      {/* arms: sleeve (outfit colour) + forearm (skin) + hand */}
      {[-1, 1].map((s) => {
        const A = k.arms(s);
        return (
          <group key={"a" + s}>
            <mesh geometry={sphere(0.07, 12, 10)} material={top} position={[...A.sh]} />
            <Limb a={[...A.sh]} b={[...A.el]} r={0.058} m={top} />
            <Limb a={[...A.el]} b={[...A.ha]} r={0.048} m={skin} />
            <mesh geometry={sphere(0.055, 12, 10)} material={skin} position={[...A.ha]} />
          </group>
        );
      })}
      {/* neck + head */}
      <mesh geometry={capsule(0.055, 0.06)} material={skin} position={[0, neckY, 0]} />
      <group position={[0, headY, 0]}>
        <mesh geometry={sphere(0.19)} material={skin} scale={[1, 1.06, 1]} />
        {/* ears */}
        {[-1, 1].map((s) => (
          <mesh key={"e" + s} geometry={sphere(0.04, 10, 8)} material={skin} position={[s * 0.185, -0.01, 0.01]} scale={[0.5, 1, 0.8]} />
        ))}
        {/* eyes (white + iris + highlight), brows, cheeks, mouth */}
        {[-1, 1].map((s) => (
          <group key={"y" + s} position={[s * 0.068, 0.01, -0.172]}>
            <mesh geometry={sphere(0.034, 14, 10)} material={white} scale={[1, girl ? 1.15 : 1, 0.45]} />
            <mesh geometry={sphere(0.024, 12, 10)} material={dark} position={[0, -0.003, -0.012]} scale={[1, girl ? 1.2 : 1.05, 0.5]} />
            <mesh geometry={sphere(0.008, 8, 6)} material={white} position={[s * -0.007, 0.01, -0.024]} />
            <mesh geometry={box(0.055, 0.011, 0.01)} material={hairM} position={[0, girl ? 0.052 : 0.048, 0.01]} rotation={[0, 0, s * (girl ? -0.12 : 0.08)]} />
          </group>
        ))}
        {girl && [-1, 1].map((s) => <mesh key={"b" + s} geometry={sphere(0.03, 10, 8)} material={blush} position={[s * 0.1, -0.05, -0.15]} scale={[1, 0.6, 0.3]} />)}
        <mesh geometry={box(girl ? 0.05 : 0.06, 0.014, 0.01)} material={lip} position={[0, -0.085, -0.178]} />
        {/* hair */}
        {girl ? (
          <>
            {/* cap tilted back: forehead free, back of the head covered */}
            <mesh geometry={capHalf(0.212)} material={hairM} position={[0, 0.0, 0.015]} rotation={[0.42, 0, 0]} />
            {/* soft side-swept fringe: three rounded locks */}
            {[-1, 0, 1].map((i) => (
              <mesh key={"f" + i} geometry={sphere(0.075, 12, 10)} material={hairM} position={[i * 0.075, 0.125 - Math.abs(i) * 0.02, -0.148 + Math.abs(i) * 0.02]} scale={[1.15, 0.62, 0.55]} rotation={[0.3, 0, i * -0.35]} />
            ))}
            {/* long hair down the back and sides */}
            <mesh geometry={capsule(0.17, 0.22)} material={hairM} position={[0, -0.1, 0.07]} scale={[1.2, 1, 0.92]} />
            {[-1, 1].map((s) => (
              <mesh key={"h" + s} geometry={capsule(0.055, 0.22)} material={hairM} position={[s * 0.17, -0.1, -0.02]} />
            ))}
            {/* bow */}
            {[-1, 1].map((s) => (
              <mesh key={"w" + s} geometry={sphere(0.05, 10, 8)} material={accent} position={[0.12 + s * 0.045, 0.15, 0.06]} scale={[1, 0.65, 0.5]} />
            ))}
          </>
        ) : (
          <>
            <mesh geometry={capHalf(0.205)} material={hairM} position={[0, 0.015, 0.012]} rotation={[0.38, 0, 0]} scale={[1.04, 1, 1.04]} />
            {/* short hair at the back of the head */}
            <mesh geometry={sphere(0.17, 14, 10)} material={hairM} position={[0, -0.02, 0.07]} scale={[1.08, 0.85, 0.8]} />
            {/* quiff */}
            <mesh geometry={sphere(0.09, 12, 10)} material={hairM} position={[0.04, 0.17, -0.1]} scale={[1.5, 0.6, 0.9]} />
            {[-1, 1].map((s) => (
              <mesh key={"h" + s} geometry={box(0.03, 0.09, 0.08)} material={hairM} position={[s * 0.185, 0.02, 0.0]} />
            ))}
          </>
        )}
      </group>
    </group>
  );
});

/** Far-away (LOD) silhouette: still reads as a girl (wider skirt) or a boy. */
export function HumanLod({ color, gender, pose }: { color: string; gender: Gender; pose: Pose }) {
  const hip = skeleton(pose).hip;
  return (
    <group>
      <mesh geometry={box(gender === "female" ? 0.5 : 0.42, 0.62, 0.36)} material={mat(color)} position={[0, hip + 0.22, 0]} />
      <mesh geometry={sphere(0.2, 8, 6)} material={mat(SKIN)} position={[0, hip + 0.71, 0]} />
    </group>
  );
}
