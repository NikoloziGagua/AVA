import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useReducedMotion } from "../../lib/useReducedMotion.js";
import { glPaused } from "../../lib/deckMotion.js";

export interface DottedSurfaceProps {
  className?: string;
  /**
   * Called at most once when drawing fails after mount (an animation frame,
   * the reduced-motion render or a resize). By then the loop has stopped and
   * every GL resource is released, so the caller only swaps in a fallback.
   */
  onError?: (error: unknown) => void;
}

export function DottedSurface({ className, onError }: DottedSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  const reduced = useReducedMotion();

  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl) return;
    const container = containerEl;

    const SEPARATION = 150;
    const AMOUNTX = 40;
    const AMOUNTY = 60;

    const scene = new THREE.Scene();

    const width = container.clientWidth;
    const height = container.clientHeight;

    const camera = new THREE.PerspectiveCamera(60, width / height, 1, 10000);
    camera.position.set(0, 355, 1220);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
    });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const positions: number[] = [];
    const colors: number[] = [];
    const geometry = new THREE.BufferGeometry();

    for (let ix = 0; ix < AMOUNTX; ix++) {
      for (let iy = 0; iy < AMOUNTY; iy++) {
        const x = ix * SEPARATION - (AMOUNTX * SEPARATION) / 2;
        const z = iy * SEPARATION - (AMOUNTY * SEPARATION) / 2;
        positions.push(x, 0, z);
        colors.push(220, 220, 235);
      }
    }

    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 7,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    let count = 0;
    let frameId = 0;
    let stopped = false;

    // Idempotent teardown shared by unmount and failure. Each release runs on
    // its own, so one throwing disposal never leaves the others behind.
    function stop() {
      if (stopped) return;
      stopped = true;
      window.removeEventListener("resize", resize);
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      const releases = [
        () => geometry.dispose(),
        () => material.dispose(),
        () => renderer.dispose(),
        () => {
          if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
        },
      ];
      for (const release of releases) {
        try { release(); } catch { /* keep releasing the rest */ }
      }
    }

    // A frame or resize runs outside React, so no error boundary would see it:
    // stop everything here and report once.
    function fail(error: unknown) {
      if (stopped) return;
      stop();
      onErrorRef.current?.(error);
    }

    function draw() {
      const positionAttribute = geometry.attributes.position as THREE.BufferAttribute | undefined;
      if (!positionAttribute) return;
      const arr = positionAttribute.array as Float32Array;
      let i = 0;
      for (let ix = 0; ix < AMOUNTX; ix++) {
        for (let iy = 0; iy < AMOUNTY; iy++) {
          const idx = i * 3;
          arr[idx + 1] =
            Math.sin((ix + count) * 0.3) * 50 +
            Math.sin((iy + count) * 0.5) * 50;
          i++;
        }
      }
      positionAttribute.needsUpdate = true;
      renderer.render(scene, camera);
      count += 0.08;
    }

    function tick() {
      frameId = 0;
      if (stopped) return;
      try {
        // Idle the loop while a page transition is mid-flight (this surface is on
        // the outgoing/incoming hero, invisible under the opaque swap) or while the
        // tab is hidden — no wave update, no GL draw, resumes on the next frame.
        if (!document.hidden && !glPaused()) draw();
      } catch (error) {
        fail(error);
        return;
      }
      // The next frame is scheduled only after this one drew successfully.
      frameId = requestAnimationFrame(tick);
    }

    function resize() {
      try {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      } catch (error) {
        fail(error);
      }
    }

    window.addEventListener("resize", resize);
    if (reduced) {
      // single-frame static render
      try {
        renderer.render(scene, camera);
      } catch (error) {
        fail(error);
      }
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return stop;
  }, [reduced]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
      aria-hidden="true"
    />
  );
}
