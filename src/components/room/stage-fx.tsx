"use client";

/**
 * "Sân khấu hành tinh tương lai" (glam stage), for every map: an LED light curtain (hanging bead
 * strands with colour waves running down) on both sides of the screen and as a valance on top, a
 * holographic arch with chaser lights, neon frame, sweeping beams, LED strip + footlights, crystal
 * light pillars, sparkles, and an alien sky (stars, ringed planet, moon, aurora) over the hall.
 *
 * The owner / a co-host switches the stage lights: everything here fades with one shared level
 * (0 = dark, 1 = lit); switching on cascades the curtain from the top down. Procedural only (no
 * assets); glows are unlit additive materials so they look bright without post-processing.
 */
import { createContext, useContext, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Layout } from "@/core/maps";

const CYAN = "#3df5ff";
const PINK = "#ff4fd8";
const VIOLET = "#8b5cff";
const LIME = "#7dffb2";

/** Shared stage-light level: `cur` eases toward `target`; `reveal` drives the top-down cascade. */
interface Level {
  target: number;
  cur: number;
  reveal: number;
}
const LevelCtx = createContext<MutableRefObject<Level> | null>(null);
const useLevel = () => useContext(LevelCtx)!;

function glow(color: string, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false, depthWrite: opacity === 1, blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending });
}

/** Dim a set of basic materials with the light level (keeps a faint `floor` glow when off). */
function useDim(mats: THREE.MeshBasicMaterial[], floor = 0.12) {
  const lv = useLevel();
  const base = useMemo(() => mats.map((m) => ({ m, c: m.color.clone(), o: m.opacity })), [mats]);
  useFrame(() => {
    const f = floor + (1 - floor) * lv.current.cur;
    for (const b of base) {
      b.m.color.copy(b.c).multiplyScalar(f);
      if (b.m.transparent) b.m.opacity = b.o * f;
    }
  });
}

/** Two neon lines around the stage screen with a soft halo. */
function NeonFrame({ layout }: { layout: Layout }) {
  const sc = layout.screen;
  const mats = useMemo(() => ({ cyan: glow(CYAN), pink: glow(PINK), halo: glow(VIOLET, 0.12) }), []);
  useDim(useMemo(() => [mats.cyan, mats.pink, mats.halo], [mats]), 0.18);
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
      <mesh position={[sc.x, sc.y, sc.z - 0.19]} material={mats.halo}>
        <planeGeometry args={[sc.width + 3.2, sc.height + 3.2]} />
      </mesh>
    </group>
  );
}

// ---------------- LED light curtain ----------------

const curtainVert = /* glsl */ `
  attribute float aSeed;
  uniform float uTime, uScale, uSize, uTop, uSpan, uReveal;
  varying float vB;
  varying vec3 vC;
  vec3 pal(float t) {
    // cyan → violet → pink → lime, looping
    return 0.55 + 0.45 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) * 0.9 + t + vec3(0.48, 0.1, 0.62)));
  }
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uScale / -mv.z;
    float down = (uTop - position.y) / uSpan;          // 0 at the top, 1 at the floor
    float rain = 0.5 + 0.5 * sin(position.y * 2.2 + uTime * 3.2 + position.x * 0.7); // light running down
    float twinkle = 0.75 + 0.25 * sin(uTime * 4.0 + aSeed * 40.0);
    float shown = smoothstep(down - 0.04, down, uReveal);  // cascade when switched on
    vB = (0.45 + 0.75 * rain) * twinkle * shown;
    vC = pal(position.y * 0.05 + position.x * 0.025 - uTime * 0.06);
  }
`;
const curtainFrag = /* glsl */ `
  uniform float uLevel;
  varying float vB;
  varying vec3 vC;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d);
    float core = smoothstep(0.18, 0.0, d);
    float b = vB * (0.07 + 0.93 * uLevel);
    gl_FragColor = vec4((vC + core * 0.6) * a * b, 1.0);
  }
`;

/** Bead positions: strands on both wings (with a slight sway curve) and a scalloped valance. */
function curtainPoints(layout: Layout, lite: boolean) {
  const sc = layout.screen;
  const top = sc.y + sc.height / 2 + 1.5;
  const bottom = layout.map === "drive_in" ? 0.2 : 0.62;
  const strands = lite ? 6 : 11;
  const step = lite ? 0.26 : 0.17;
  const gap = 0.34;
  const p: number[] = [];
  const seed: number[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < strands; i++) {
      const x0 = sc.x + side * (sc.width / 2 + 0.8 + i * gap);
      // strands closer to the screen are a little shorter → the wing reads as a drape
      const end = bottom + (strands - 1 - i) * 0.05;
      for (let y = top; y >= end; y -= step) {
        const sway = Math.sin(y * 0.9 + i) * 0.05;
        p.push(x0 + sway, y, sc.z - 0.05 + ((i % 2) * 0.08));
        seed.push(Math.random());
      }
    }
  }
  // valance: short scalloped drapes across the full width above the screen
  const half = sc.width / 2 + 0.8 + strands * gap;
  for (let x = -half; x <= half; x += lite ? 0.3 : 0.2) {
    const len = 0.35 + 0.55 * Math.abs(Math.sin((x / 1.4) * Math.PI)); // swags
    for (let d = 0; d <= len; d += step) {
      p.push(sc.x + x, top + 0.05 - d, sc.z + 0.18);
      seed.push(Math.random());
    }
  }
  return { pos: new Float32Array(p), seed: new Float32Array(seed), top, span: top - bottom, half };
}

function LightCurtain({ layout, lite }: { layout: Layout; lite: boolean }) {
  const lv = useLevel();
  const { size, gl } = useThree();
  const data = useMemo(() => curtainPoints(layout, lite), [layout, lite]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: curtainVert,
        fragmentShader: curtainFrag,
        uniforms: { uTime: { value: 0 }, uScale: { value: 400 }, uSize: { value: 0.21 }, uTop: { value: data.top }, uSpan: { value: data.span }, uReveal: { value: 1.2 }, uLevel: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [data],
  );
  const sc = layout.screen;
  const rail = useMemo(() => glow("#c9b8ff"), []);
  useDim(useMemo(() => [rail], [rail]), 0.25);
  useFrame(({ clock }) => {
    const u = mat.uniforms;
    u.uTime.value = clock.elapsedTime;
    u.uScale.value = (size.height * gl.getPixelRatio()) / 2;
    u.uLevel.value = lv.current.cur;
    u.uReveal.value = lv.current.reveal;
  });
  return (
    <group>
      <points material={mat} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.pos, 3]} />
          <bufferAttribute attach="attributes-aSeed" args={[data.seed, 1]} />
        </bufferGeometry>
      </points>
      {/* the rail the strands hang from */}
      <mesh position={[sc.x, data.top + 0.1, sc.z + 0.05]} material={rail}>
        <boxGeometry args={[data.half * 2 + 0.3, 0.06, 0.06]} />
      </mesh>
    </group>
  );
}

// ---------------- holographic arch ----------------

/** A half-ring arch over the screen with chaser dots running along it. */
function HoloArch({ layout }: { layout: Layout }) {
  const lv = useLevel();
  const sc = layout.screen;
  const cy = sc.y - sc.height / 2 - 0.4;
  const r = Math.max(sc.width / 2 + 2.6, sc.height + 2.4);
  const mats = useMemo(() => ({ a: glow(VIOLET, 0.55), b: glow(CYAN, 0.35) }), []);
  useDim(useMemo(() => [mats.a, mats.b], [mats]), 0.15);
  const N = 28;
  const dots = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const dotMat = useMemo(() => glow("#ffffff"), []);
  useFrame(({ clock }) => {
    const im = dots.current;
    if (!im) return;
    const t = clock.elapsedTime * 0.12;
    const s = 0.05 + 0.1 * lv.current.cur;
    for (let i = 0; i < N; i++) {
      const a = (((i / N + t) % 1) + 1) % 1; // 0..1 along the arch, left → right
      const ang = Math.PI - a * Math.PI;
      tmp.position.set(sc.x + Math.cos(ang) * r, cy + Math.sin(ang) * r, sc.z - 0.35);
      tmp.scale.setScalar(s * (0.6 + 0.4 * Math.sin(a * Math.PI)));
      tmp.updateMatrix();
      im.setMatrixAt(i, tmp.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <mesh position={[sc.x, cy, sc.z - 0.4]} material={mats.a}>
        <torusGeometry args={[r, 0.07, 8, 96, Math.PI]} />
      </mesh>
      <mesh position={[sc.x, cy, sc.z - 0.45]} material={mats.b}>
        <torusGeometry args={[r + 0.45, 0.035, 6, 96, Math.PI]} />
      </mesh>
      <instancedMesh ref={dots} args={[undefined, undefined, N]} material={dotMat} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
      </instancedMesh>
    </group>
  );
}

/** Colour-cycling LED strip and warm footlights along the front edge of the stage. */
function StageEdge({ layout }: { layout: Layout }) {
  const lv = useLevel();
  const sc = layout.screen;
  const strip = useRef<THREE.MeshBasicMaterial>(null);
  const w = sc.width + 2;
  const front = sc.z + 2.5;
  const warm = useMemo(() => glow("#ffe2a8"), []);
  useDim(useMemo(() => [warm], [warm]), 0.1);
  useFrame(({ clock }) => strip.current?.color.setHSL((clock.elapsedTime * 0.06) % 1, 1, 0.08 + 0.52 * lv.current.cur));
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
  const lv = useLevel();
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
      [CYAN, PINK, VIOLET, LIME].map((c, i) => ({
        x: sc.x + (i - 1.5) * (sc.width / 3.2),
        phase: i * 1.7,
        mat: glow(c, 0.07),
        dot: glow(c),
      })),
    [sc.x, sc.width],
  );
  useDim(useMemo(() => beams.map((b) => b.dot), [beams]), 0.15);
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const down = useMemo(() => new THREE.Vector3(0, -1, 0), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const reach = Math.min(m.maxZ, sc.z + 22);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const l = lv.current.cur;
    beams.forEach((b, i) => {
      const mesh = refs.current[i];
      b.mat.opacity = 0.07 * l;
      if (!mesh) return;
      mesh.visible = l > 0.02;
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
      <mesh position={[sc.x, apexY + 0.15, sc.z + 2.6]}>
        <boxGeometry args={[sc.width + 2, 0.12, 0.12]} />
        <meshStandardMaterial color="#2a2a33" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** Crystal light pillars along both sides of the hall (a glowing rod topped by a floating crystal). */
function Pillars({ layout }: { layout: Layout }) {
  const m = layout.main;
  const sc = layout.screen;
  const mats = useMemo(() => [glow(CYAN), glow(PINK)], []);
  useDim(mats, 0.2);
  const crystals = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = crystals.current;
    if (!g) return;
    g.children.forEach((c, i) => {
      c.rotation.y = clock.elapsedTime * 0.8 + i;
      c.position.y = 3.95 + Math.sin(clock.elapsedTime * 1.3 + i) * 0.12;
    });
  });
  const zs: number[] = [];
  for (let z = sc.z + 3; z <= m.maxZ; z += 4.5) zs.push(z);
  const spots = [m.minX - 1.2, m.maxX + 1.2].flatMap((x, si) => zs.map((z, i) => ({ x, z, k: (i + si) % 2 })));
  return (
    <group>
      {spots.map((s, i) => (
        <mesh key={i} position={[s.x, 1.8, s.z]} material={mats[s.k]}>
          <boxGeometry args={[0.07, 3.6, 0.07]} />
        </mesh>
      ))}
      <group ref={crystals}>
        {spots.map((s, i) => (
          <mesh key={i} position={[s.x, 3.95, s.z]} material={mats[s.k]} scale={[0.16, 0.32, 0.16]}>
            <octahedronGeometry args={[1, 0]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

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

/** Slowly drifting, twinkling sparkles above the audience. */
function Sparkles({ layout }: { layout: Layout }) {
  const lv = useLevel();
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
    if (mat.current) {
      mat.current.size = 0.22 + Math.sin(clock.elapsedTime * 2.1) * 0.06;
      mat.current.opacity = 0.2 + 0.75 * lv.current.cur;
    }
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

// ---------------- alien sky ----------------

/** Banded gas-giant texture (drawn once). */
function planetTexture() {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 256;
  const g = c.getContext("2d")!;
  const bands = ["#2b1a5e", "#5b2c8a", "#c25aa8", "#ff9bc8", "#7a3d9e", "#3a2a7a", "#58c8e8", "#2b1a5e"];
  const grad = g.createLinearGradient(0, 0, 0, 256);
  bands.forEach((b, i) => grad.addColorStop(i / (bands.length - 1), b));
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 256);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`;
    g.fillRect(0, Math.random() * 256, 32, 1 + Math.random() * 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const auroraVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const auroraFrag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uA, uB;
  varying vec2 vUv;
  void main() {
    float wave = sin(vUv.x * 9.0 + uTime * 0.35) * 0.08 + sin(vUv.x * 23.0 - uTime * 0.6) * 0.03;
    float y = vUv.y - 0.35 - wave;
    float band = smoothstep(0.0, 0.08, y) * smoothstep(0.55, 0.1, y);
    float rays = 0.6 + 0.4 * sin(vUv.x * 140.0 + uTime * 1.5 + sin(vUv.x * 13.0) * 3.0);
    float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
    vec3 col = mix(uA, uB, clamp(y * 2.0, 0.0, 1.0));
    gl_FragColor = vec4(col * band * rays * edge * 0.55, 1.0);
  }
`;

/** Stars, a ringed planet, a moon and aurora ribbons far behind the stage (no fog, always visible). */
function AlienSky({ layout, lite }: { layout: Layout; lite: boolean }) {
  const sc = layout.screen;
  const stars = useMemo(() => {
    const n = lite ? 700 : 1600;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // upper hemisphere, radius 260 around the hall
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(1 - Math.random() * 0.95);
      a[i * 3] = Math.sin(v) * Math.cos(u) * 260;
      a[i * 3 + 1] = Math.cos(v) * 260 + 8;
      a[i * 3 + 2] = Math.sin(v) * Math.sin(u) * 260;
    }
    return a;
  }, [lite]);
  const starMat = useRef<THREE.PointsMaterial>(null);
  const planet = useMemo(() => planetTexture(), []);
  const aurora = useMemo(
    () =>
      [
        ["#3dffb0", "#8b5cff", 0],
        ["#3df5ff", "#ff4fd8", 1.7],
      ].map(
        ([a, b, ph]) =>
          new THREE.ShaderMaterial({
            vertexShader: auroraVert,
            fragmentShader: auroraFrag,
            uniforms: { uTime: { value: ph as number }, uA: { value: new THREE.Color(a as string) }, uB: { value: new THREE.Color(b as string) } },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
          }),
      ),
    [],
  );
  const ring = useRef<THREE.Group>(null);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    aurora.forEach((m, i) => (m.uniforms.uTime.value = t + i * 1.7));
    if (starMat.current) starMat.current.opacity = 0.75 + Math.sin(t * 1.7) * 0.15;
    if (ring.current) ring.current.rotation.y += dt * 0.02;
  });
  const back = sc.z - 150;
  return (
    <group>
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[stars, 3]} />
        </bufferGeometry>
        <pointsMaterial ref={starMat} map={dotTexture()} color="#dfe6ff" size={1.6} sizeAttenuation transparent opacity={0.8} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} toneMapped={false} />
      </points>
      {/* ringed gas giant up-left behind the stage */}
      <group position={[sc.x - 70, 62, back]} rotation={[0.25, 0, 0.35]}>
        <mesh>
          <sphereGeometry args={[24, 48, 32]} />
          <meshBasicMaterial map={planet} fog={false} toneMapped={false} />
        </mesh>
        <group ref={ring}>
          <mesh rotation={[Math.PI / 2.3, 0, 0]}>
            <ringGeometry args={[31, 46, 96]} />
            <meshBasicMaterial color="#e8b8ff" transparent opacity={0.28} side={THREE.DoubleSide} fog={false} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </mesh>
        </group>
      </group>
      {/* small cyan moon up-right */}
      <mesh position={[sc.x + 80, 78, back + 20]}>
        <sphereGeometry args={[7, 32, 24]} />
        <meshBasicMaterial color="#9ff3ff" fog={false} toneMapped={false} />
      </mesh>
      <mesh position={[sc.x + 80, 78, back + 19]}>
        <circleGeometry args={[11, 48]} />
        <meshBasicMaterial color="#3df5ff" transparent opacity={0.12} fog={false} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {/* aurora ribbons */}
      {aurora.map((m, i) => (
        <mesh key={i} material={m} position={[sc.x + (i ? 40 : -30), 55 + i * 12, back + 30 + i * 15]} rotation={[0.15, i ? -0.25 : 0.2, 0]}>
          <planeGeometry args={[220, 70, 1, 1]} />
        </mesh>
      ))}
    </group>
  );
}

/** Coloured lights that pulse slowly (they also tint the avatars and seats). */
function MoodLights({ layout }: { layout: Layout }) {
  const lv = useLevel();
  const sc = layout.screen;
  const a = useRef<THREE.PointLight>(null);
  const b = useRef<THREE.PointLight>(null);
  const c = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const l = 0.08 + 0.92 * lv.current.cur;
    if (a.current) a.current.intensity = (26 + Math.sin(t * 0.9) * 10) * l;
    if (b.current) b.current.intensity = (26 + Math.cos(t * 0.7) * 10) * l;
    if (c.current) c.current.intensity = 30 * l;
  });
  return (
    <>
      <pointLight ref={a} position={[sc.x - sc.width / 2, 3, sc.z + 5]} color={PINK} distance={30} decay={1.6} />
      <pointLight ref={b} position={[sc.x + sc.width / 2, 3, sc.z + 5]} color={CYAN} distance={30} decay={1.6} />
      <pointLight ref={c} position={[sc.x, sc.y + sc.height / 2 + 2, sc.z + 8]} color="#fff1dc" distance={40} decay={1.4} />
    </>
  );
}

/** Eases the shared level toward the switch state; switching on replays the top-down cascade. */
function LevelDriver({ on }: { on: boolean }) {
  const lv = useLevel();
  useEffect(() => {
    lv.current.target = on ? 1 : 0;
  }, [on, lv]);
  useFrame((_, dt) => {
    const L = lv.current;
    const d = Math.min(dt, 0.1);
    const wasDark = L.cur < 0.05;
    L.cur += (L.target - L.cur) * Math.min(1, d * (L.target > L.cur ? 1.6 : 2.4));
    if (L.target === 1) {
      if (wasDark && L.reveal > 1.1) L.reveal = 0;
      L.reveal = Math.min(1.2, L.reveal + d * 0.7);
    }
  });
  return null;
}

export function GlamStage({ layout, lite, lights = true }: { layout: Layout; lite: boolean; lights?: boolean }) {
  const outdoor = layout.map === "drive_in";
  const level = useRef<Level>({ target: lights ? 1 : 0, cur: lights ? 1 : 0, reveal: 1.2 });
  return (
    <LevelCtx.Provider value={level}>
      <LevelDriver on={lights} />
      <group>
        <AlienSky layout={layout} lite={lite} />
        <NeonFrame layout={layout} />
        <LightCurtain layout={layout} lite={lite} />
        <HoloArch layout={layout} />
        {!outdoor && <StageEdge layout={layout} />}
        <Beams layout={layout} />
        <Pillars layout={layout} />
        {!lite && <Sparkles layout={layout} />}
        <MoodLights layout={layout} />
      </group>
    </LevelCtx.Provider>
  );
}
