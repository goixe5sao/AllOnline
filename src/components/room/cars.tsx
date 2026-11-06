"use client";

/**
 * Cars for the drive-in map, drawn in code after four VinFast models (real proportions):
 *   mini   → VF 3        (3.19 × 1.68 × 1.62 m, tiny boxy 2-door, two-tone roof)
 *   suv    → VF 7        (4.55 × 1.89 × 1.64 m, coupé-SUV with a sloping roof)
 *   sedan  → Limo Green  (4.74 × 1.87 × 1.73 m, 7-seat MPV, long flat roof)
 *   pickup → VF Wild     (5.32 × 2.00 × 1.85 m, double-cab pick-up with an open bed)
 * Body = side profile extruded across the width (rounded edges, real wheel arches), glass
 * house on top, VinFast-style "wing" LED bar across the nose and a full-width tail light.
 * No logos / trademarks are drawn. Geometry is built once per model and shared by every car.
 * Front of the car = −z (towards the screen), like the old box cars.
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";

type Pt = [number, number] | ["q", number, number, number, number];

interface CarSpec {
  /** Overall length / width / height, m. */
  L: number;
  W: number;
  /** Wheel radius and the axles' positions along the car (u: + = front). */
  r: number;
  axles: [number, number];
  /** Underside height between the wheels. */
  clear: number;
  /** Body outline from the front bottom corner, over the top, to the rear bottom corner (u, y). */
  body: Pt[];
  /** Glass house: windshield base → roof points → rear window base (u, y). */
  glass: [number, number][];
  /** Width of the glass house (narrower than the body: cars taper towards the roof). */
  glassW: number;
  /** Front light bar: u, y; tail light: u, y. */
  head: [number, number];
  tail: [number, number];
  /** B pillar position (u) and extra pillars for long cabins. */
  pillars: number[];
  /** Mirror position (u, y). */
  mirror: [number, number];
  /** Contrasting roof (VF 3). */
  twoTone?: boolean;
  /** Pick-up bed: from u0 (cab back) to u1 (tailgate), floor height, wall top. */
  bed?: { u0: number; u1: number; floor: number; top: number };
  /** Black wheel-arch / sill cladding (SUVs, pick-up). */
  cladding?: boolean;
  /** Rim style: 5 thick spokes or many thin ones. */
  spokes: number;
}

const SPECS: Record<string, CarSpec> = {
  // VF 3: short, tall, upright; short hood, near-vertical tail, big wheels in the corners.
  mini: {
    L: 3.19,
    W: 1.68,
    r: 0.31,
    axles: [1.04, -1.035],
    clear: 0.2,
    body: [
      [1.595, 0.3],
      [1.595, 0.62],
      ["q", 1.6, 0.86, 1.42, 0.9],
      [0.95, 0.98],
      [0.82, 1.0],
      [-1.5, 1.0],
      ["q", -1.6, 0.98, -1.595, 0.86],
      [-1.595, 0.3],
    ],
    glass: [
      [0.84, 0.99],
      [0.3, 1.58],
      [-1.38, 1.6],
      [-1.52, 1.0],
    ],
    glassW: 1.5,
    head: [1.565, 0.74],
    tail: [-1.6, 0.86],
    pillars: [-0.38],
    mirror: [0.72, 1.06],
    twoTone: true,
    cladding: true,
    spokes: 5,
  },
  // VF 7: low sharp nose, long sloping hood, fast-back roof, high tail with a ducktail lip.
  suv: {
    L: 4.545,
    W: 1.89,
    r: 0.37,
    axles: [1.4, -1.44],
    clear: 0.24,
    body: [
      [2.27, 0.38],
      [2.27, 0.62],
      ["q", 2.29, 0.78, 2.05, 0.82],
      [0.75, 1.0],
      [-1.9, 1.07],
      ["q", -2.25, 1.08, -2.27, 0.95],
      [-2.24, 0.38],
    ],
    glass: [
      [0.76, 1.0],
      [-0.15, 1.6],
      [-0.75, 1.63],
      [-1.55, 1.45],
      [-2.08, 1.08],
    ],
    glassW: 1.66,
    head: [2.27, 0.7],
    tail: [-2.27, 0.98],
    pillars: [-0.55],
    mirror: [0.62, 1.07],
    cladding: true,
    spokes: 5,
  },
  // Limo Green: MPV — short sloping nose, very raked windshield, long flat roof, upright tailgate.
  sedan: {
    L: 4.74,
    W: 1.872,
    r: 0.35,
    axles: [1.47, -1.37],
    clear: 0.2,
    body: [
      [2.37, 0.34],
      [2.37, 0.6],
      ["q", 2.38, 0.82, 2.1, 0.87],
      [1.3, 1.02],
      [-2.2, 1.04],
      ["q", -2.36, 1.04, -2.37, 0.9],
      [-2.35, 0.34],
    ],
    glass: [
      [1.32, 1.02],
      [0.35, 1.7],
      [-1.9, 1.72],
      [-2.3, 1.05],
    ],
    glassW: 1.66,
    head: [2.36, 0.74],
    tail: [-2.36, 0.94],
    pillars: [-0.25, -1.35],
    mirror: [1.15, 1.1],
    spokes: 10,
  },
  // VF Wild: tall square nose, flat hood, upright double cab, open bed behind.
  pickup: {
    L: 5.324,
    W: 1.997,
    r: 0.42,
    axles: [1.72, -1.43],
    clear: 0.3,
    body: [
      [2.662, 0.48],
      [2.66, 1.02],
      ["q", 2.66, 1.15, 2.5, 1.17],
      [1.2, 1.22],
      [-0.85, 1.22],
      [-0.85, 0.82],
      [-2.662, 0.82],
      [-2.662, 0.48],
    ],
    glass: [
      [1.18, 1.22],
      [0.5, 1.83],
      [-0.72, 1.85],
      [-0.8, 1.22],
    ],
    glassW: 1.78,
    head: [2.67, 1.06],
    tail: [-2.67, 0.98],
    pillars: [-0.1],
    mirror: [1.05, 1.3],
    bed: { u0: -0.85, u1: -2.662, floor: 0.82, top: 1.2 },
    cladding: true,
    spokes: 6,
  },
};

/** Extrude a side profile (u, y) across the width, centred on x = 0, front towards −z. */
function extrudeProfile(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, width - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelOffset: -bevel * 0.8, bevelSegments: 4, curveSegments: 12 });
  // shape (u, y, w) → world (x = w, y, z = −u)
  g.rotateY(Math.PI / 2);
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.translate(-(b.min.x + b.max.x) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

function bodyShape(s: CarSpec): THREE.Shape {
  const sh = new THREE.Shape();
  const rear = s.body[s.body.length - 1] as [number, number];
  // underside from the rear bottom corner to the front, cutting the two wheel arches
  sh.moveTo(rear[0], s.clear);
  const R = s.r + 0.09;
  for (const ax of [...s.axles].sort((a, b) => a - b)) {
    sh.lineTo(ax - R, s.clear);
    sh.absarc(ax, s.r, R, Math.PI, 0, true);
    sh.lineTo(ax + R, s.clear);
  }
  for (const p of s.body) {
    if (p[0] === "q") sh.quadraticCurveTo(p[1], p[2], p[3], p[4]);
    else sh.lineTo(p[0], p[1]);
  }
  sh.lineTo(rear[0], s.clear);
  return sh;
}

function polyShape(pts: [number, number][]): THREE.Shape {
  const sh = new THREE.Shape();
  pts.forEach(([u, y], i) => (i ? sh.lineTo(u, y) : sh.moveTo(u, y)));
  sh.closePath();
  return sh;
}

/** A strip of thickness t below the polyline (roof skin). */
function stripShape(pts: [number, number][], t: number): THREE.Shape {
  return polyShape([...pts, ...[...pts].reverse().map(([u, y]) => [u, y - t] as [number, number])]);
}

interface CarGeo {
  body: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  aPillar: THREE.BufferGeometry;
  cPillar: THREE.BufferGeometry;
  arch: THREE.BufferGeometry;
}
const geoCache = new Map<string, CarGeo>();
function carGeo(model: string, s: CarSpec): CarGeo {
  let g = geoCache.get(model);
  if (!g) {
    const gl = s.glass;
    const top = gl.slice(1, -1);
    const a0 = gl[0];
    const a1 = gl[1];
    const c1 = gl[gl.length - 2];
    const c0 = gl[gl.length - 1];
    g = {
      body: extrudeProfile(bodyShape(s), s.W, 0.16),
      glass: extrudeProfile(polyShape(gl), s.glassW, 0.04),
      roof: extrudeProfile(stripShape(top.map(([u, y]) => [u, y + 0.02] as [number, number]), 0.09), s.glassW + 0.03, 0.03),
      // side frames only (placed at both sides): A pillar beside the windshield, wide C pillar
      aPillar: extrudeProfile(polyShape([a0, a1, [a1[0] - 0.1, a1[1]], [a0[0] - 0.16, a0[1]]]), 0.07, 0.015),
      arch: new THREE.TorusGeometry(s.r + 0.1, 0.045, 6, 20, Math.PI),
      cPillar: extrudeProfile(polyShape([[c1[0] + 0.32, c1[1]], c1, c0, [c0[0] + 0.36, c0[1]]]), 0.07, 0.015),
    };
    geoCache.set(model, g);
  }
  return g;
}

// Materials shared by every car (paint is per car).
const M = {
  glass: new THREE.MeshStandardMaterial({ color: "#16222c", metalness: 0.6, roughness: 0.12, envMapIntensity: 1 }),
  tyre: new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.9 }),
  rim: new THREE.MeshStandardMaterial({ color: "#c9ccd1", metalness: 0.85, roughness: 0.3 }),
  rimDark: new THREE.MeshStandardMaterial({ color: "#2b2e33", metalness: 0.7, roughness: 0.35 }),
  black: new THREE.MeshStandardMaterial({ color: "#1b1c1f", roughness: 0.7 }),
  chrome: new THREE.MeshStandardMaterial({ color: "#e8eaee", metalness: 1, roughness: 0.15 }),
  led: new THREE.MeshBasicMaterial({ color: "#f4fbff" }),
  lamp: new THREE.MeshBasicMaterial({ color: "#fff3cf" }),
  tail: new THREE.MeshBasicMaterial({ color: "#ff2222" }),
  plate: new THREE.MeshStandardMaterial({ color: "#f4f4f0", roughness: 0.6 }),
  bedFloor: new THREE.MeshStandardMaterial({ color: "#26272b", roughness: 0.95 }),
};
const cyl = new THREE.CylinderGeometry(1, 1, 1, 24);
const box = new THREE.BoxGeometry(1, 1, 1);

function Wheel({ x, z, r, spokes, dark }: { x: number; z: number; r: number; spokes: number; dark: boolean }) {
  const side = Math.sign(x);
  const rim = dark ? M.rimDark : M.rim;
  return (
    <group position={[x, r, z]}>
      <mesh geometry={cyl} material={M.tyre} rotation={[0, 0, Math.PI / 2]} scale={[r, 0.24, r]} />
      <mesh geometry={cyl} material={M.black} rotation={[0, 0, Math.PI / 2]} scale={[r * 0.7, 0.245, r * 0.7]} />
      <group position={[side * 0.122, 0, 0]}>
        <mesh geometry={cyl} material={rim} rotation={[0, 0, Math.PI / 2]} scale={[r * 0.68, 0.012, r * 0.68]} position={[-side * 0.01, 0, 0]} />
        <mesh geometry={cyl} material={rim} rotation={[0, 0, Math.PI / 2]} scale={[r * 0.18, 0.03, r * 0.18]} />
        {Array.from({ length: spokes }, (_, i) => (
          <mesh key={i} geometry={box} material={rim} rotation={[(i * Math.PI * 2) / spokes, 0, 0]} position={[0.004 * side, 0, 0]} scale={[0.025, r * 1.3, spokes > 6 ? 0.025 : 0.06]} />
        ))}
      </group>
    </group>
  );
}

/** Rough size of each car (for the far-away low-detail box). */
export function carSize(model: string): { w: number; h: number; l: number } {
  const s = SPECS[model] ?? SPECS.suv;
  return { w: s.W, h: Math.max(...s.glass.map((p) => p[1])), l: s.L };
}

export function CarModel({ model, color }: { model: string; color: string }) {
  const s = SPECS[model] ?? SPECS.suv;
  const g = carGeo(model in SPECS ? model : "suv", s);
  const paint = useMemo(() => new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }), [color]);
  useEffect(() => () => paint.dispose(), [paint]);
  const light = new THREE.Color(color).getHSL({ h: 0, s: 0, l: 0 }).l > 0.6;
  // VF 3 two-tone roof: white on dark paint, black on light paint
  const roofMat = s.twoTone ? (light ? M.black : M.plate) : paint;
  const halfW = s.W / 2;
  const wingY = s.head[1];
  const z = (u: number) => -u;

  return (
    <group>
      <mesh geometry={g.body} material={paint} />
      <mesh geometry={g.glass} material={M.glass} />
      <mesh geometry={g.roof} material={roofMat} />
      {[-1, 1].map((sd) => (
        <group key={sd} position={[sd * (s.glassW / 2 + 0.005), 0, 0]}>
          <mesh geometry={g.aPillar} material={s.twoTone ? roofMat : paint} />
          <mesh geometry={g.cPillar} material={s.twoTone ? roofMat : paint} />
        </group>
      ))}
      {s.pillars.map((u) => (
        <mesh key={u} geometry={box} material={s.twoTone ? roofMat : M.black} position={[0, (s.glass[0][1] + Math.max(...s.glass.map((p) => p[1]))) / 2, z(u)]} scale={[s.glassW + 0.02, Math.max(...s.glass.map((p) => p[1])) - s.glass[0][1] - 0.02, 0.1]} />
      ))}

      {/* VinFast-style wing light: thin LED bar across the nose, dipping to a V in the middle */}
      {[-1, 1].map((sd) => (
        <group key={sd}>
          <mesh geometry={box} material={M.led} position={[sd * halfW * 0.47, wingY + 0.035, z(s.head[0]) - 0.02]} rotation={[0, 0, sd * 0.09]} scale={[halfW * 0.86, 0.045, 0.05]} />
          <mesh geometry={box} material={M.black} position={[sd * halfW * 0.47, wingY + 0.035, z(s.head[0]) - 0.005]} rotation={[0, 0, sd * 0.09]} scale={[halfW * 0.9, 0.1, 0.05]} />
          {/* main lamps lower in the bumper */}
          <mesh geometry={box} material={M.lamp} position={[sd * halfW * 0.72, wingY - 0.2, z(s.head[0]) - 0.01]} scale={[0.28, 0.09, 0.04]} />
          {/* mirrors */}
          <group position={[sd * (s.glassW / 2 + 0.1), s.mirror[1], z(s.mirror[0])]}>
            <mesh geometry={box} material={s.twoTone ? roofMat : paint} scale={[0.2, 0.12, 0.1]} position={[sd * 0.04, 0, 0]} />
            <mesh geometry={box} material={M.black} scale={[0.08, 0.04, 0.06]} position={[-sd * 0.07, -0.03, 0]} />
          </group>
        </group>
      ))}
      <mesh geometry={box} material={M.chrome} position={[0, wingY - 0.02, z(s.head[0]) - 0.025]} rotation={[0, 0, Math.PI / 4]} scale={[0.07, 0.07, 0.02]} />
      {/* lower grille + front plate */}
      <mesh geometry={box} material={M.black} position={[0, s.clear + 0.18, z(s.body[0][0] as number) - 0.005]} scale={[s.W * 0.62, 0.16, 0.05]} />
      <mesh geometry={box} material={M.plate} position={[0, s.clear + 0.18, z(s.body[0][0] as number) - 0.04]} scale={[0.52, 0.12, 0.01]} />

      {/* full-width tail light + rear plate */}
      <mesh geometry={box} material={M.tail} position={[0, s.tail[1], z(s.tail[0]) + 0.02]} scale={[s.W * 0.92, 0.06, 0.05]} />
      <mesh geometry={box} material={M.plate} position={[0, s.clear + 0.3, z(s.tail[0]) + 0.03]} scale={[0.52, 0.12, 0.01]} />

      {s.cladding && (
        <>
          {/* black sills and bumper lips */}
          {[-1, 1].map((sd) => (
            <mesh key={sd} geometry={box} material={M.black} position={[sd * (halfW - 0.02), s.clear + 0.06, z((s.axles[0] + s.axles[1]) / 2)]} scale={[0.06, 0.12, s.axles[0] - s.axles[1] - 2 * (s.r + 0.08)]} />
          ))}
          {s.axles.map((u) => [-1, 1].map((sd) => <mesh key={`${u}${sd}`} geometry={g.arch} material={M.black} position={[sd * (halfW - 0.03), s.r, z(u)]} rotation={[0, Math.PI / 2, 0]} />))}
          <mesh geometry={box} material={M.black} position={[0, (s.body[0][1] as number) + 0.03, z(s.body[0][0] as number) + 0.02]} scale={[s.W * 0.9, 0.12, 0.1]} />
          <mesh geometry={box} material={M.black} position={[0, (s.body[s.body.length - 1][1] as number) + 0.03, z(s.body[s.body.length - 1][0] as number) - 0.02]} scale={[s.W * 0.9, 0.12, 0.1]} />
        </>
      )}

      {s.bed && (
        <group>
          {/* side walls, tailgate and the bed floor */}
          {[-1, 1].map((sd) => (
            <mesh key={sd} geometry={box} material={paint} position={[sd * (halfW - 0.05), (s.bed!.floor + s.bed!.top) / 2, z((s.bed!.u0 + s.bed!.u1) / 2)]} scale={[0.1, s.bed!.top - s.bed!.floor, s.bed!.u0 - s.bed!.u1]} />
          ))}
          <mesh geometry={box} material={paint} position={[0, (s.bed.floor + s.bed.top) / 2, z(s.bed.u1) - 0.05]} scale={[s.W - 0.02, s.bed.top - s.bed.floor, 0.1]} />
          <mesh geometry={box} material={M.bedFloor} position={[0, s.bed.floor + 0.01, z((s.bed.u0 + s.bed.u1) / 2)]} scale={[s.W - 0.2, 0.02, s.bed.u0 - s.bed.u1 - 0.1]} />
          {/* roll bar behind the cab */}
          <mesh geometry={box} material={M.black} position={[0, s.bed.top + 0.12, z(s.bed.u0 - 0.15)]} scale={[s.W - 0.15, 0.06, 0.06]} />
          {[-1, 1].map((sd) => (
            <mesh key={sd} geometry={box} material={M.black} position={[sd * (halfW - 0.1), s.bed!.top + 0.06, z(s.bed!.u0 - 0.15)]} scale={[0.06, 0.14, 0.06]} />
          ))}
          {/* roof light bar */}
          <mesh geometry={box} material={M.led} position={[0, 1.88, z(0.35)]} scale={[1.2, 0.04, 0.06]} />
        </group>
      )}

      {s.axles.map((u) => [-1, 1].map((sd) => <Wheel key={`${u}${sd}`} x={sd * (halfW - 0.14)} z={z(u)} r={s.r} spokes={s.spokes} dark={!!s.cladding && model !== "suv"} />))}
    </group>
  );
}
