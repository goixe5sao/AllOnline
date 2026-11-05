"use client";

/**
 * "Siêu đẹp" graphics: real glow (bloom) around every light, using three's own post-processing
 * passes (no extra dependency, nothing to download). Opt-in per viewer; the server is not involved.
 *
 * Cost is on the viewer's GPU only: one extra full-screen pass + a half-resolution blur chain.
 * A frame-rate watchdog calls `onSlow` when the device cannot keep up, so the room falls back to
 * "Đầy đủ" on its own instead of stuttering.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/** Below this average frame rate for three windows in a row → too slow for bloom (many phones and
 * laptops on battery saver run at 30 fps: that is fine). */
const MIN_FPS = 22;
const WINDOW_S = 3;
const WARMUP_S = 8;

export function UltraFx({ onSlow }: { onSlow?: () => void }) {
  const { gl, scene, camera, size } = useThree();
  const composer = useMemo(() => {
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));
    // strength, radius, threshold: only bright things (neon, LED beads, stars, planets) glow
    c.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.95, 0.5, 0.72));
    c.addPass(new OutputPass());
    return c;
  }, [gl, scene, camera]);

  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
  }, [composer, gl, size.width, size.height]);
  useEffect(() => () => composer.dispose(), [composer]);

  const perf = useRef({ t: 0, frames: 0, slow: 0, done: false });
  // priority 1: R3F stops its own render, the composer draws the frame
  useFrame((_, dt) => {
    composer.render(dt);
    const p = perf.current;
    if (p.done || !onSlow || dt > 3) return; // back from a hidden tab: not a measurement
    p.t += dt;
    p.frames++;
    if (p.t < WARMUP_S) {
      p.frames = 0;
      return;
    }
    const span = p.t - WARMUP_S;
    if (span >= WINDOW_S) {
      const fps = p.frames / span;
      p.slow = fps < MIN_FPS ? p.slow + 1 : 0;
      p.t = WARMUP_S;
      p.frames = 0;
      if (p.slow >= 3) {
        p.done = true;
        onSlow();
      }
    }
  }, 1);
  return null;
}
