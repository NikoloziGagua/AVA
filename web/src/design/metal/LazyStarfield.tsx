import { Component, lazy, Suspense, type ReactNode } from "react";

const Stars = lazy(async () => ({ default: (await import("./Starfield.js")).Starfield }));

/** Decoration can fail independently; the static atmosphere and controls remain. */
class StarsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

export function LazyStarfield() {
  return <StarsBoundary><Suspense fallback={null}><Stars /></Suspense></StarsBoundary>;
}
