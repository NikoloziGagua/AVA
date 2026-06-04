// Pure helper for TubelightNav: which item is active. Separated so the lamp's
// initial position is testable without rendering.

export function resolveActiveIndex(items: { name: string }[], activeName?: string): number {
  if (items.length === 0) return -1;
  const i = items.findIndex((it) => it.name === activeName);
  return i >= 0 ? i : 0;
}
