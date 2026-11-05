"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type * as THREE from "three";
import { AVATARS } from "@/core/maps";
import { HumanModel } from "./people";
import { CarModel } from "./cars";

function Turntable({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    // face the viewer most of the time, swaying left and right
    if (g.current) g.current.rotation.y = Math.PI + Math.sin(clock.elapsedTime * 0.8) * 0.7;
  });
  return <group ref={g}>{children}</group>;
}

/** Turning car on a dark floor, front three-quarter view. */
function CarPreview({ model, color }: { model: string; color: string }) {
  const m = AVATARS.vehicles.models.find((x) => x.id === model);
  if (!m) return null;
  return (
    <div className="avatar-preview car-preview" aria-label={`Xem trước: ${m.label}`} role="img">
      <Canvas dpr={[1, 2]} camera={{ fov: 30, position: [4.4, 1.9, -5.9] }} gl={{ antialias: true, alpha: true }} onCreated={({ camera }) => camera.lookAt(0, 0.72, 0)}>
        <ambientLight intensity={0.55} />
        <hemisphereLight args={["#dfe8ff", "#30283a", 0.9]} />
        <directionalLight position={[4, 6, -3]} intensity={2.2} />
        <directionalLight position={[-5, 3, 4]} intensity={0.8} color="#9fc3ff" />
        <pointLight position={[0, 2, -5]} intensity={8} color="#3df5ff" />
        <CarTurntable>
          <CarModel model={model} color={color} />
        </CarTurntable>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <circleGeometry args={[3.6, 48]} />
          <meshStandardMaterial color="#1a1d26" transparent opacity={0.85} />
        </mesh>
      </Canvas>
    </div>
  );
}

function CarTurntable({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (g.current) g.current.rotation.y = Math.sin(clock.elapsedTime * 0.5) * 0.6;
  });
  return <group ref={g}>{children}</group>;
}

/** Small 3D preview of the chosen boy / girl or car on the invite page. */
export default function AvatarPreview({ model, group = "people", color }: { model: string; group?: "people" | "vehicles"; color?: string }) {
  if (group === "vehicles") return <CarPreview model={model} color={color ?? AVATARS.vehicles.models.find((x) => x.id === model)?.color ?? "#888"} />;
  const m = AVATARS.people.models.find((x) => x.id === model);
  if (!m) return null;
  return (
    <div className="avatar-preview" aria-label={`Xem trước: ${m.label}`} role="img">
      <Canvas dpr={[1, 2]} camera={{ fov: 30, position: [0, 1.05, 3.9] }} gl={{ antialias: true, alpha: true }} onCreated={({ camera }) => camera.lookAt(0, 0.92, 0)}>
        <ambientLight intensity={0.6} />
        <hemisphereLight args={["#bfd2ff", "#3a2440", 0.7]} />
        <directionalLight position={[2, 4, 3]} intensity={1.6} />
        <pointLight position={[-2, 2, 1]} intensity={6} color="#ff4fd8" />
        <pointLight position={[2, 1.5, -1]} intensity={6} color="#3df5ff" />
        <Turntable>
          <HumanModel color={m.color} gender={m.gender ?? "male"} hair={m.hair ?? "#2b1d16"} pose="stand" />
        </Turntable>
      </Canvas>
    </div>
  );
}
