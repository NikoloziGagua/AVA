import {
  Component,
  lazy,
  Suspense,
  useMemo,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useReducedMotion } from "../lib/useReducedMotion.js";

// Keep Three.js outside the splash graph. React invokes this loader only after
// Home is actually mounted and the motion/capability gate below selects WebGL.
const DottedSurface = lazy(async () => ({
  default: (await import("../components/ava/DottedSurface.js")).DottedSurface,
}));

export function supportsHomeWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Static visual parity for reduced-motion, unavailable WebGL and lazy errors. */
export function StaticHomeSurface() {
  return (
    <div
      aria-hidden="true"
      data-home-surface="static"
      className="pointer-events-none absolute inset-0 overflow-hidden opacity-55"
      style={{
        backgroundImage:
          "radial-gradient(circle at center, rgba(220,235,245,.28) 0 1px, transparent 1.7px)",
        backgroundPosition: "center 38%",
        backgroundSize: "38px 24px",
        maskImage: "radial-gradient(ellipse 66% 58% at 50% 48%, black 0%, transparent 78%)",
      }}
    />
  );
}

type HomeSurfaceBoundaryProps = { children: ReactNode };

/** A decorative renderer failure must never take down Home or its controls. */
export class HomeSurfaceBoundary extends Component<
  HomeSurfaceBoundaryProps,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[ava] home WebGL surface unavailable; using static fallback", error.message, info.componentStack);
  }

  render() {
    return this.state.failed ? <StaticHomeSurface /> : this.props.children;
  }
}

export function HomeSurface() {
  const reduced = useReducedMotion();
  // Short-circuiting is intentional: reduced-motion users do not even create
  // a probe context, and React.lazy never requests the Three.js module graph.
  const capable = useMemo(() => !reduced && supportsHomeWebGL(), [reduced]);

  if (!capable) return <StaticHomeSurface />;

  return (
    <HomeSurfaceBoundary>
      <Suspense fallback={<StaticHomeSurface />}>
        <div aria-hidden="true" data-home-surface="webgl" className="pointer-events-none absolute inset-0">
          <DottedSurface />
        </div>
      </Suspense>
    </HomeSurfaceBoundary>
  );
}
