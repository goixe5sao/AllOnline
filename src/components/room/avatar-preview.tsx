"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type * as THREE from "three";
import { AVATARS } from "@/core/maps";
import { HumanModel } from "./people";

function Turntable({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    // face the viewer most of the time, swaying left and right
    if (g.current) g.current.rotation.y = Math.PI + Math.sin(clock.elapsedTime * 0.8) * 0.7;
  });
  return <group ref={g}>{children}</group>;
}

/** Small 3D preview of the chosen boy / girl on the invite page. */
export default function AvatarPreview({ model }: { model: string }) {
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
