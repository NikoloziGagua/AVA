import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import { cn } from "../cn.js";
import { FaceStill } from "./FaceStill.js";
import type { FaceStageProps } from "./FaceStage.js";

// The animated face is its own lazy chunk (contract ui-remodel v2 §1).
const FaceStage = lazy(async () => ({ default: (await import("./FaceStage.js")).FaceStage }));

/** A face chunk that fails to load leaves only the still face (contract ui-remodel v2 §6). */
class FaceBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[ava] face unavailable, showing the still face:", error.message, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * AVA's face wherever a screen places it: the still face while the live one
 * loads, the live one once it has, and the still face again if loading or
 * drawing fails. Nothing else on the screen waits for it or breaks with it.
 */
export function LazyFace({ stillSize = 220, className, ...props }: FaceStageProps & { stillSize?: number }) {
  const still = (
    <div className={cn("grid h-full place-items-center", className)} data-face="still">
      <FaceStill size={stillSize} label={props.label} />
    </div>
  );
  return (
    <FaceBoundary fallback={still}>
      <Suspense fallback={still}>
        <FaceStage {...props} stillSize={stillSize} className={className} />
      </Suspense>
    </FaceBoundary>
  );
}
