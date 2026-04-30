# Ava Frontend Remodel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current functional-but-plain Ava PWA with a cinematic "orbital" interface built around a single shared gradient pulse, add long-press chat-delete with soft-delete + 24h sweep, and add a full-screen voice mode.

**Architecture:** Single-page React + Vite + Tailwind v4 PWA. `App.tsx` state machine swaps screens via `<AnimatePresence mode="wait">`. A single `<Pulse />` component with `motion`'s `layoutId="ava-pulse"` morphs across orbit center, chat composer mic, and voice fullscreen. Server gets one new endpoint, one schema column, one cleanup sweep, and voice transcript persistence.

**Tech Stack:** React 19, Vite 7, Tailwind v4, motion (`motion/react`), lucide-react, shadcn/ui primitives (vendored locally), class-variance-authority, tailwind-merge, clsx. Server: Node + Express + better-sqlite3, vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-04-29-ava-frontend-remodel-design.md`

---

## Phase 0 — Foundations (~half day)

Goal: install deps, scaffold tokens, vendor primitives. App keeps working with old code.

### Task 0.1: Install web dependencies

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Add deps via npm install**

Run:
```bash
cd C:/ai/chemiapebi/yovlisshemdzle/web && npm install motion@^11 lucide-react@^0.460 clsx@^2 tailwind-merge@^2 class-variance-authority@^0.7
```

Expected: install completes, `web/package.json` has the five new entries under `dependencies`.

- [ ] **Step 2: Verify deps resolve**

Run:
```bash
cd C:/ai/chemiapebi/yovlisshemdzle/web && node -e "require.resolve('motion'); require.resolve('lucide-react'); require.resolve('clsx'); require.resolve('tailwind-merge'); require.resolve('class-variance-authority'); console.log('ok')"
```

Expected: prints `ok`.

- [ ] **Step 3: Verify build still works**

Run:
```bash
cd C:/ai/chemiapebi/yovlisshemdzle/web && npm run build
```

Expected: build succeeds (tsc + vite). No deps used yet, so nothing breaks.

- [ ] **Step 4: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/package.json web/package-lock.json && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(web): add motion + lucide-react + shadcn deps"
```

---

### Task 0.2: `lib/utils.ts` cn() helper

**Files:**
- Create: `web/src/lib/utils.ts`
- Test: `web/src/lib/utils.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/utils.test.ts
import { describe, it, expect } from "vitest";
import { cn } from "./utils.js";

describe("cn", () => {
  it("joins truthy strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });
  it("filters falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
  it("dedupes conflicting tailwind classes (last wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- utils`
Expected: FAIL with "Cannot find module './utils'".

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- utils`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/lib/ && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(web): add cn() utility for tailwind class merging"
```

---

### Task 0.3: `theme.css` CSS vars (replaces `styles.css`)

**Files:**
- Create: `web/src/theme.css`
- Modify: `web/src/main.tsx` (swap import)
- Delete: `web/src/styles.css`

- [ ] **Step 1: Create `theme.css` with all design tokens**

```css
/* web/src/theme.css */
@import "tailwindcss";

:root {
  /* Color tokens */
  --ava-bg: #000;
  --ava-fg: rgba(255, 255, 255, 0.85);
  --ava-fg-muted: rgba(255, 255, 255, 0.5);
  --ava-border: rgba(255, 255, 255, 0.08);
  --ava-purple: #a855f7;
  --ava-blue: #3b82f6;
  --ava-teal: #14b8a6;

  /* Confidence pills */
  --conf-high: #10b981;
  --conf-med: #eab308;
  --conf-low: rgba(255, 255, 255, 0.5);

  /* Motion tokens */
  --motion-fast: 200ms;
  --motion-screen: 300ms;
  --motion-cinematic: 600ms;
  --ease-cinematic: cubic-bezier(0.22, 1, 0.36, 1);
}

html, body, #root {
  height: 100%;
  background: var(--ava-bg);
  color: var(--ava-fg);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
}

body {
  margin: 0;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* Gradient pulse class — use as bg for the orb */
.ava-gradient {
  background: linear-gradient(135deg, var(--ava-purple), var(--ava-blue), var(--ava-teal));
}

/* Reduce motion: collapse all transitions to opacity fades */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 2: Update `main.tsx` to import the new file**

Replace the import of `./styles.css` with `./theme.css` in `web/src/main.tsx`. Then delete `web/src/styles.css`.

- [ ] **Step 3: Verify build still works**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm run build`
Expected: build succeeds. Visit dev server, page is pure black with Ava header still visible (existing chat UI uses neutral-* classes which still work).

- [ ] **Step 4: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/theme.css web/src/main.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle rm web/src/styles.css && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(web): introduce theme.css with ava design tokens"
```

---

### Task 0.4: Vendor shadcn primitives

Vendor the 5 shadcn/ui primitives we need: button, card, textarea, badge, dialog. We copy the official shadcn source (CC0) directly so we don't depend on the registry CLI.

**Files:**
- Create: `web/src/components/ui/button.tsx`
- Create: `web/src/components/ui/card.tsx`
- Create: `web/src/components/ui/textarea.tsx`
- Create: `web/src/components/ui/badge.tsx`
- Create: `web/src/components/ui/dialog.tsx`
- Test: `web/src/components/ui/ui.smoke.test.tsx`

- [ ] **Step 1: Write the smoke test (module-load only)**

```ts
// web/src/components/ui/ui.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { Button } from "./button.js";
import { Card, CardHeader, CardTitle, CardContent } from "./card.js";
import { Textarea } from "./textarea.js";
import { Badge } from "./badge.js";
import { Dialog, DialogContent, DialogTrigger } from "./dialog.js";

describe("shadcn ui primitives", () => {
  it("export expected components", () => {
    expect(typeof Button).toBe("object"); // forwardRef -> object
    expect(typeof Card).toBe("object");
    expect(typeof CardHeader).toBe("object");
    expect(typeof CardTitle).toBe("object");
    expect(typeof CardContent).toBe("object");
    expect(typeof Textarea).toBe("object");
    expect(typeof Badge).toBe("function");
    expect(typeof Dialog).toBe("function");
    expect(typeof DialogContent).toBe("object");
    expect(typeof DialogTrigger).toBe("object");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- ui.smoke`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Add shadcn deps for primitives**

Run:
```bash
cd C:/ai/chemiapebi/yovlisshemdzle/web && npm install @radix-ui/react-slot@^1.1 @radix-ui/react-dialog@^1.1
```

- [ ] **Step 4: Create `button.tsx`**

```tsx
// web/src/components/ui/button.tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-white text-black hover:bg-white/90",
        destructive: "bg-red-500 text-white hover:bg-red-500/90",
        outline: "border border-white/15 bg-transparent text-white hover:bg-white/5",
        secondary: "bg-white/10 text-white hover:bg-white/15",
        ghost: "hover:bg-white/5 text-white",
        link: "text-white underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
```

- [ ] **Step 5: Create `card.tsx`**

```tsx
// web/src/components/ui/card.tsx
import * as React from "react";
import { cn } from "../../lib/utils.js";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("rounded-xl border border-white/10 bg-black/60 backdrop-blur-md text-white shadow", className)} {...props} />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-4", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("font-semibold leading-none tracking-tight", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-4 pt-0", className)} {...props} />
);
CardContent.displayName = "CardContent";

export { Card, CardHeader, CardTitle, CardContent };
```

- [ ] **Step 6: Create `textarea.tsx`**

```tsx
// web/src/components/ui/textarea.tsx
import * as React from "react";
import { cn } from "../../lib/utils.js";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[48px] w-full rounded-md border border-white/10 bg-transparent px-3 py-2 text-sm text-white placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

export { Textarea };
```

- [ ] **Step 7: Create `badge.tsx`**

```tsx
// web/src/components/ui/badge.tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-white/10 text-white",
        outline: "border border-white/15 text-white",
        success: "bg-emerald-500/15 text-emerald-300",
        warning: "bg-yellow-500/15 text-yellow-300",
        muted: "bg-white/5 text-white/60",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
```

- [ ] **Step 8: Create `dialog.tsx`**

```tsx
// web/src/components/ui/dialog.tsx
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/utils.js";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn("fixed inset-0 z-50 bg-black/60 backdrop-blur-sm", className)} {...props} />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border border-white/10 bg-black/85 p-6 shadow-lg rounded-lg backdrop-blur-md",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 text-white">
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

export { Dialog, DialogTrigger, DialogPortal, DialogClose, DialogOverlay, DialogContent };
```

- [ ] **Step 9: Run smoke test to verify pass**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- ui.smoke`
Expected: PASS (1/1).

- [ ] **Step 10: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/components/ui/ web/package.json web/package-lock.json && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(web): vendor shadcn ui primitives (button/card/textarea/badge/dialog)"
```

---

### Task 0.5: Vendor Alert kit

**Files:**
- Create: `web/src/components/ui/alert.tsx`
- Test: `web/src/components/ui/alert.smoke.test.tsx`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/components/ui/alert.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { Alert, AlertTitle, AlertDescription, AlertIcon, AlertContent } from "./alert.js";

describe("alert kit", () => {
  it("exports the expected components", () => {
    expect(typeof Alert).toBe("function");
    expect(typeof AlertTitle).toBe("function");
    expect(typeof AlertDescription).toBe("function");
    expect(typeof AlertIcon).toBe("function");
    expect(typeof AlertContent).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- alert.smoke`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create `alert.tsx` (simplified kit, our theme tokens)**

```tsx
// web/src/components/ui/alert.tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "../../lib/utils.js";

const alertVariants = cva(
  "flex items-start w-full gap-2.5 rounded-md p-3 text-sm border",
  {
    variants: {
      variant: {
        info: "bg-white/5 border-white/10 text-white",
        success: "bg-emerald-500/10 border-emerald-500/30 text-emerald-100",
        destructive: "bg-red-500/10 border-red-500/30 text-red-100",
        warning: "bg-yellow-500/10 border-yellow-500/30 text-yellow-100",
      },
    },
    defaultVariants: { variant: "info" },
  }
);

interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  close?: boolean;
  onClose?: () => void;
}

function Alert({ className, variant, close, onClose, children, ...props }: AlertProps) {
  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      {children}
      {close && (
        <button onClick={onClose} aria-label="Dismiss" className="ml-auto opacity-60 hover:opacity-100">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("font-semibold", className)} {...props} />;
}
function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("opacity-80", className)} {...props} />;
}
function AlertIcon({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("shrink-0 mt-0.5", className)} {...props} />;
}
function AlertContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 space-y-1", className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription, AlertIcon, AlertContent };
```

- [ ] **Step 4: Run smoke test to verify pass**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- alert.smoke`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/components/ui/alert.tsx web/src/components/ui/alert.smoke.test.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(web): vendor Alert kit (info/success/destructive/warning)"
```

---

### Task 0.6: GlassFilter SVG component

**Files:**
- Create: `web/src/components/ava/GlassFilter.tsx`
- Test: `web/src/components/ava/GlassFilter.smoke.test.tsx`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/components/ava/GlassFilter.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { GlassFilter } from "./GlassFilter.js";
describe("GlassFilter module", () => {
  it("exports a function component", () => {
    expect(typeof GlassFilter).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- GlassFilter`
Expected: FAIL.

- [ ] **Step 3: Create `GlassFilter.tsx`**

```tsx
// web/src/components/ava/GlassFilter.tsx
export function GlassFilter() {
  return (
    <svg className="hidden" aria-hidden="true">
      <defs>
        <filter id="ava-glass" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.05 0.05" numOctaves="1" seed="1" result="turbulence" />
          <feGaussianBlur in="turbulence" stdDeviation="2" result="blurredNoise" />
          <feDisplacementMap in="SourceGraphic" in2="blurredNoise" scale="30" xChannelSelector="R" yChannelSelector="B" result="displaced" />
          <feGaussianBlur in="displaced" stdDeviation="2" result="finalBlur" />
          <feComposite in="finalBlur" in2="finalBlur" operator="over" />
        </filter>
      </defs>
    </svg>
  );
}
```

- [ ] **Step 4: Run smoke test**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- GlassFilter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/components/ava/ && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(web): add GlassFilter SVG (filter:url(#ava-glass) for distortion)"
```

---

## Phase 1 — Shared primitives (~1 day)

### Task 1.1: `<PathsBackground />`

**Files:**
- Create: `web/src/components/ava/PathsBackground.tsx`
- Test: `web/src/components/ava/PathsBackground.smoke.test.tsx`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/components/ava/PathsBackground.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { PathsBackground } from "./PathsBackground.js";
describe("PathsBackground module", () => {
  it("exports a function component", () => {
    expect(typeof PathsBackground).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- PathsBackground`
Expected: FAIL.

- [ ] **Step 3: Implement (adapted from 21st-dev BackgroundPaths)**

```tsx
// web/src/components/ava/PathsBackground.tsx
import { motion } from "motion/react";

function FloatingPaths({ position }: { position: number }) {
  const paths = Array.from({ length: 36 }, (_, i) => ({
    id: i,
    d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${380 - i * 5 * position} -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${152 - i * 5 * position} ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${684 - i * 5 * position} ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
    width: 0.5 + i * 0.03,
  }));

  return (
    <svg className="absolute inset-0 w-full h-full text-white pointer-events-none" viewBox="0 0 696 316" fill="none" aria-hidden="true">
      {paths.map((p) => (
        <motion.path
          key={p.id}
          d={p.d}
          stroke="currentColor"
          strokeWidth={p.width}
          strokeOpacity={0.1 + p.id * 0.03}
          initial={{ pathLength: 0.3, opacity: 0.6 }}
          animate={{ pathLength: 1, opacity: [0.3, 0.6, 0.3], pathOffset: [0, 1, 0] }}
          transition={{ duration: 20 + Math.random() * 10, repeat: Infinity, ease: "linear" }}
        />
      ))}
    </svg>
  );
}

export function PathsBackground({ opacity = 1 }: { opacity?: number }) {
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ opacity }} aria-hidden="true">
      <FloatingPaths position={1} />
      <FloatingPaths position={-1} />
    </div>
  );
}
```

- [ ] **Step 4: Run smoke test**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- PathsBackground`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/components/ava/PathsBackground.tsx web/src/components/ava/PathsBackground.smoke.test.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(web): add PathsBackground (animated SVG paths layer)"
```

---

### Task 1.2: `<ShiningText />`

**Files:**
- Create: `web/src/components/ava/ShiningText.tsx`
- Test: `web/src/components/ava/ShiningText.smoke.test.tsx`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/components/ava/ShiningText.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { ShiningText } from "./ShiningText.js";
describe("ShiningText module", () => {
  it("exports a function component", () => {
    expect(typeof ShiningText).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- ShiningText`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// web/src/components/ava/ShiningText.tsx
import { motion } from "motion/react";

export function ShiningText({ text, className }: { text: string; className?: string }) {
  return (
    <motion.span
      className={
        "bg-[linear-gradient(110deg,#404040,35%,#fff,50%,#404040,75%,#404040)] " +
        "bg-[length:200%_100%] bg-clip-text text-transparent " +
        (className ?? "")
      }
      initial={{ backgroundPosition: "200% 0" }}
      animate={{ backgroundPosition: "-200% 0" }}
      transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
    >
      {text}
    </motion.span>
  );
}
```

- [ ] **Step 4: Run smoke test**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- ShiningText`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/components/ava/ShiningText.tsx web/src/components/ava/ShiningText.smoke.test.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(web): add ShiningText shimmer component"
```

---

### Task 1.3: `<Pulse />` (4 states + layoutId)

The shared gradient orb that morphs across orbit center, chat composer mic, and voice fullscreen.

**Files:**
- Create: `web/src/components/ava/Pulse.tsx`
- Test: `web/src/components/ava/Pulse.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/ava/Pulse.test.tsx
import { describe, it, expect } from "vitest";
import { Pulse, type PulseState } from "./Pulse.js";

describe("Pulse module", () => {
  it("exports the component", () => {
    expect(typeof Pulse).toBe("function");
  });
  it("PulseState type accepts the four states", () => {
    const states: PulseState[] = ["idle", "listening", "thinking", "responding"];
    expect(states.length).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- Pulse`
Expected: FAIL — Pulse doesn't exist.

- [ ] **Step 3: Implement**

```tsx
// web/src/components/ava/Pulse.tsx
import { motion } from "motion/react";

export type PulseState = "idle" | "listening" | "thinking" | "responding";

export interface PulseProps {
  state: PulseState;
  size: number;
  amplitude?: number;       // 0..1, only used when state === "listening"
  layoutId?: string;
  className?: string;
}

const COLORS_IDLE = "linear-gradient(135deg, #a855f7, #3b82f6, #14b8a6)";
const COLORS_RESPONDING = "linear-gradient(135deg, #3b82f6, #14b8a6, #a855f7)";
const SHIMMER = "linear-gradient(110deg, #404040 35%, #fff 50%, #404040 65%)";

export function Pulse({ state, size, amplitude = 0, layoutId, className }: PulseProps) {
  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    boxShadow: state === "listening"
      ? "0 0 80px rgba(168,85,247,0.6)"
      : state === "responding"
      ? "0 0 100px rgba(59,130,246,0.7)"
      : state === "thinking"
      ? "0 0 60px rgba(255,255,255,0.2)"
      : "0 0 40px rgba(168,85,247,0.45)",
  };

  if (state === "idle") {
    return (
      <motion.div
        layoutId={layoutId}
        className={className}
        style={{ ...baseStyle, backgroundImage: COLORS_IDLE }}
        animate={{ scale: [0.96, 1.04, 0.96] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
    );
  }

  if (state === "listening") {
    const scale = 0.85 + amplitude * 0.3;
    return (
      <motion.div
        layoutId={layoutId}
        className={className}
        style={{ ...baseStyle, backgroundImage: COLORS_IDLE, scale }}
      />
    );
  }

  if (state === "responding") {
    return (
      <motion.div
        layoutId={layoutId}
        className={className}
        style={{ ...baseStyle, backgroundImage: COLORS_RESPONDING }}
        animate={{
          borderRadius: ["46% 54% 54% 46% / 52% 48% 52% 48%",
                          "54% 46% 46% 54% / 48% 52% 48% 52%",
                          "46% 54% 54% 46% / 52% 48% 52% 48%"],
        }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
    );
  }

  // thinking
  return (
    <motion.div
      layoutId={layoutId}
      className={className}
      style={{
        ...baseStyle,
        backgroundImage: SHIMMER,
        backgroundSize: "200% 100%",
      }}
      initial={{ backgroundPosition: "200% 0" }}
      animate={{ backgroundPosition: "-200% 0" }}
      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
    />
  );
}
```

- [ ] **Step 4: Run test to verify passes**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- Pulse`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/components/ava/Pulse.tsx web/src/components/ava/Pulse.test.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(web): add <Pulse /> with idle/listening/thinking/responding + layoutId"
```

---

### Task 1.4: `<OrbitRing />`

A presentational ring that positions children radially around its center.

**Files:**
- Create: `web/src/components/ava/OrbitRing.tsx`
- Test: `web/src/components/ava/OrbitRing.smoke.test.tsx`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/components/ava/OrbitRing.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { OrbitRing, computeNodePosition } from "./OrbitRing.js";

describe("OrbitRing", () => {
  it("exports the component", () => {
    expect(typeof OrbitRing).toBe("function");
  });
  it("computeNodePosition places node 0 at the right when rotation=0", () => {
    const p = computeNodePosition({ index: 0, total: 4, radius: 100, rotationDeg: 0 });
    expect(Math.round(p.x)).toBe(100);
    expect(Math.round(p.y)).toBe(0);
  });
  it("computeNodePosition rotation shifts the angle", () => {
    const p = computeNodePosition({ index: 0, total: 4, radius: 100, rotationDeg: 90 });
    expect(Math.round(p.x)).toBe(0);
    expect(Math.round(p.y)).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- OrbitRing`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// web/src/components/ava/OrbitRing.tsx
import * as React from "react";

export interface NodePos {
  x: number;
  y: number;
  angle: number;
  zIndex: number;
  opacity: number;
}

export function computeNodePosition({
  index,
  total,
  radius,
  rotationDeg,
}: {
  index: number;
  total: number;
  radius: number;
  rotationDeg: number;
}): NodePos {
  const angleDeg = ((index / total) * 360 + rotationDeg) % 360;
  const rad = (angleDeg * Math.PI) / 180;
  const x = radius * Math.cos(rad);
  const y = radius * Math.sin(rad);
  const zIndex = Math.round(100 + 50 * Math.cos(rad));
  const opacity = Math.max(0.4, Math.min(1, 0.4 + 0.6 * ((1 + Math.sin(rad)) / 2)));
  return { x, y, angle: angleDeg, zIndex, opacity };
}

export interface OrbitRingProps {
  radius: number;
  rotationDeg: number;
  borderClassName?: string;
  children: React.ReactNode;
}

export function OrbitRing({ radius, borderClassName, children }: OrbitRingProps) {
  return (
    <div
      className={
        "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full " +
        (borderClassName ?? "border border-white/10")
      }
      style={{ width: radius * 2, height: radius * 2 }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify passes**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- OrbitRing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/components/ava/OrbitRing.tsx web/src/components/ava/OrbitRing.smoke.test.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(web): add OrbitRing + computeNodePosition geometry"
```

---

## Phase 2 — Orbit home + chat delete (~1.5 days)

### Task 2.1: Server schema migration — `deleted_at` column

We use the existing idempotent `tryAddColumn()` pattern in `server/src/state/db.ts` (verifies via `PRAGMA table_info` then ALTERs if missing). Index added inline.

**Files:**
- Modify: `server/src/state/db.ts`
- Test: `server/src/state/db.test.ts` (extend)

- [ ] **Step 1: Add a failing test**

Append to `server/src/state/db.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { openDb } from "./db.js";

describe("db migrations: sessions.deleted_at", () => {
  it("creates deleted_at column", () => {
    const db = openDb(":memory:");
    const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "deleted_at")).toBe(true);
  });
  it("creates idx_sessions_deleted index", () => {
    const db = openDb(":memory:");
    const idx = db.prepare("PRAGMA index_list(sessions)").all() as Array<{ name: string }>;
    expect(idx.some((i) => i.name === "idx_sessions_deleted")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/server && npm test -- db.test`
Expected: FAIL — column and index missing.

- [ ] **Step 3: Implement migration in `db.ts`**

Modify `openDb()` in `server/src/state/db.ts` — after the existing `tryAddColumn` calls, add:

```ts
  tryAddColumn(db, "sessions", "deleted_at", "INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_deleted ON sessions(deleted_at)");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/server && npm test -- db.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add server/src/state/db.ts server/src/state/db.test.ts && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(db): add sessions.deleted_at column + index (idempotent migration)"
```

---

### Task 2.2: `softDeleteSession()` + filter `listSessions`

**Files:**
- Modify: `server/src/state/sessions.ts`
- Modify: `server/src/state/sessions.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `server/src/state/sessions.test.ts`:

```ts
import { softDeleteSession } from "./sessions.js";

describe("soft delete", () => {
  it("softDeleteSession sets deleted_at to now", () => {
    const db = openDb(":memory:");
    const s = createSession(db, { title: "x" });
    const before = Date.now();
    softDeleteSession(db, s.id);
    const row = db.prepare("SELECT deleted_at FROM sessions WHERE id = ?").get(s.id) as { deleted_at: number };
    expect(row.deleted_at).toBeGreaterThanOrEqual(before);
  });

  it("listSessions excludes soft-deleted rows", () => {
    const db = openDb(":memory:");
    const a = createSession(db, { title: "a" });
    const b = createSession(db, { title: "b" });
    softDeleteSession(db, a.id);
    const all = listSessions(db);
    expect(all.map((s) => s.id)).toEqual([b.id]);
  });

  it("getSession returns null for soft-deleted session", () => {
    const db = openDb(":memory:");
    const s = createSession(db, { title: "x" });
    softDeleteSession(db, s.id);
    expect(getSession(db, s.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/server && npm test -- state/sessions`
Expected: FAIL — `softDeleteSession` not exported, listSessions returns all.

- [ ] **Step 3: Implement in `server/src/state/sessions.ts`**

Add export:

```ts
export function softDeleteSession(db: Db, id: string): void {
  db.prepare("UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE id = ?").run(
    Date.now(),
    Date.now(),
    id,
  );
}
```

Replace `listSessions`:

```ts
export function listSessions(db: Db): Session[] {
  return db.prepare("SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY updated_at DESC").all() as Session[];
}
```

Replace `getSession`:

```ts
export function getSession(db: Db, id: string): Session | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL").get(id) as Session | undefined;
  return row ?? null;
}
```

- [ ] **Step 4: Run to verify passes**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/server && npm test -- state/sessions`
Expected: PASS (existing tests still pass; 3 new tests pass).

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add server/src/state/sessions.ts server/src/state/sessions.test.ts && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(sessions): soft-delete + filter listSessions/getSession"
```

---

### Task 2.3: `purgeDeletedSessions()` sweep

**Files:**
- Modify: `server/src/state/sessions.ts`
- Modify: `server/src/state/sessions.test.ts`

- [ ] **Step 1: Add failing test**

Append to `server/src/state/sessions.test.ts`:

```ts
import { purgeDeletedSessions } from "./sessions.js";

describe("purgeDeletedSessions", () => {
  it("hard-deletes rows whose deleted_at is older than the threshold", () => {
    const db = openDb(":memory:");
    const old = createSession(db, { title: "old" });
    const fresh = createSession(db, { title: "fresh" });
    db.prepare("UPDATE sessions SET deleted_at = ? WHERE id = ?").run(1000, old.id);
    db.prepare("UPDATE sessions SET deleted_at = ? WHERE id = ?").run(Date.now(), fresh.id);
    const removed = purgeDeletedSessions(db, Date.now() - 24 * 60 * 60 * 1000);
    expect(removed).toBe(1);
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(old.id);
    expect(row).toBeUndefined();
  });

  it("keeps rows with NULL deleted_at", () => {
    const db = openDb(":memory:");
    const a = createSession(db, { title: "a" });
    const removed = purgeDeletedSessions(db, Date.now());
    expect(removed).toBe(0);
    expect(db.prepare("SELECT id FROM sessions WHERE id = ?").get(a.id)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/server && npm test -- state/sessions`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `server/src/state/sessions.ts`:

```ts
export function purgeDeletedSessions(db: Db, olderThanMs: number): number {
  const r = db.prepare("DELETE FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at < ?").run(olderThanMs);
  return r.changes;
}
```

(messages and tool_calls cascade via existing FK ON DELETE CASCADE.)

- [ ] **Step 4: Run to verify passes**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/server && npm test -- state/sessions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add server/src/state/sessions.ts server/src/state/sessions.test.ts && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(sessions): purgeDeletedSessions sweep (cascades to messages/tool_calls)"
```

---

### Task 2.4: `DELETE /api/sessions/:id` route

**Files:**
- Modify: `server/src/routes/sessions.ts`
- Modify: `server/src/routes/sessions.test.ts`

- [ ] **Step 1: Add failing test**

Append to `server/src/routes/sessions.test.ts`:

```ts
import { listSessions } from "../state/sessions.js";

describe("DELETE /api/sessions/:id", () => {
  it("204 and removes from listing", async () => {
    const { app, db } = setup();
    const s = createSession(db, { title: "to delete" });
    await request(app).delete(`/api/sessions/${s.id}`).expect(204);
    expect(listSessions(db).find((x) => x.id === s.id)).toBeUndefined();
  });

  it("404 for unknown id", async () => {
    const { app } = setup();
    await request(app).delete("/api/sessions/unknown").expect(404);
  });

  it("404 if already deleted", async () => {
    const { app, db } = setup();
    const s = createSession(db, { title: "x" });
    await request(app).delete(`/api/sessions/${s.id}`).expect(204);
    await request(app).delete(`/api/sessions/${s.id}`).expect(404);
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/server && npm test -- routes/sessions`
Expected: FAIL — DELETE handler missing.

- [ ] **Step 3: Implement in `server/src/routes/sessions.ts`**

Replace the file with:

```ts
import { Router, type RequestHandler } from "express";
import type { Db } from "../state/db.js";
import { listSessions, getSession, softDeleteSession } from "../state/sessions.js";
import { listMessages } from "../state/messages.js";

export function sessionsRoutes(db: Db, auth: RequestHandler): Router {
  const r = Router();

  r.get("/", auth, (_req, res) => {
    res.json({ sessions: listSessions(db) });
  });

  r.get("/:id", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const session = getSession(db, id);
    if (!session) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ session, messages: listMessages(db, session.id) });
  });

  r.delete("/:id", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const session = getSession(db, id);
    if (!session) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    softDeleteSession(db, id);
    res.status(204).end();
  });

  return r;
}
```

- [ ] **Step 4: Run to verify passes**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/server && npm test -- routes/sessions`
Expected: PASS (existing tests pass; 3 new pass).

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add server/src/routes/sessions.ts server/src/routes/sessions.test.ts && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(api): DELETE /api/sessions/:id (soft-delete)"
```

---

### Task 2.5: Wire purge sweep into startup

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Manual verification (no unit test — startup-side effect)**

Read `server/src/index.ts` to find where `db = openDb(...)` is called (around the top of the bootstrap). Add the purge call right after.

- [ ] **Step 2: Add purge import and call**

Add to imports near other state imports:
```ts
import { purgeDeletedSessions } from "./state/sessions.js";
```

After the line that opens `db` (and before `app.use(...)` calls), add:

```ts
const purgedCount = purgeDeletedSessions(db, Date.now() - 24 * 60 * 60 * 1000);
if (purgedCount > 0) log.info({ purgedCount }, "purged soft-deleted sessions older than 24h");
```

- [ ] **Step 3: Verify server boots**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/server && npm run build`
Expected: tsc passes.

Optionally: `npm start` and verify the log line appears (or doesn't, on a clean db).

- [ ] **Step 4: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add server/src/index.ts && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(server): purge soft-deleted sessions older than 24h on boot"
```

---

### Task 2.6: Client `api.deleteSession()`

**Files:**
- Modify: `web/src/api.ts`
- Test: `web/src/api.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// web/src/api.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./api.js";

describe("api.deleteSession", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: any, init: any) => {
      return new Response(null, { status: 204 });
    }) as any;
  });

  it("issues DELETE /api/sessions/:id", async () => {
    await api.deleteSession("abc123");
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(f).toHaveBeenCalledWith(
      "/api/sessions/abc123",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- api.test`
Expected: FAIL — `deleteSession` not on `api`.

- [ ] **Step 3: Implement**

In `web/src/api.ts`, extend the `api` object literal:

```ts
export const api = {
  pair: ...,
  sendMessage: ...,
  kill: ...,
  deleteSession: (sessionId: string) =>
    request<void>(`/api/sessions/${sessionId}`, { method: "DELETE" }),
};
```

Note: the existing `request<T>()` helper already throws on non-2xx and parses JSON. For 204 No Content, the helper handles empty bodies (`text` is "", `body` becomes undefined) — `request<void>` returns undefined, which is fine.

- [ ] **Step 4: Run test to verify passes**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- api.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/api.ts web/src/api.test.ts && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(web): add api.deleteSession()"
```

---

### Task 2.7: `useLongPress` hook

500ms threshold, with progress callback for the white→red ring color animation.

**Files:**
- Create: `web/src/orbit/useLongPress.ts`
- Test: `web/src/orbit/useLongPress.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/orbit/useLongPress.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLongPress } from "./useLongPress.js";

describe("useLongPress", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("fires onTrigger after threshold ms", () => {
    const onTrigger = vi.fn();
    const { result } = renderHook(() => useLongPress({ thresholdMs: 500, onTrigger }));
    act(() => { result.current.handlers.onPointerDown({} as any); });
    act(() => { vi.advanceTimersByTime(499); });
    expect(onTrigger).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("cancels on pointerup before threshold", () => {
    const onTrigger = vi.fn();
    const { result } = renderHook(() => useLongPress({ thresholdMs: 500, onTrigger }));
    act(() => { result.current.handlers.onPointerDown({} as any); });
    act(() => { vi.advanceTimersByTime(300); });
    act(() => { result.current.handlers.onPointerUp({} as any); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("progress goes 0..1 over the threshold", () => {
    const onTrigger = vi.fn();
    const { result } = renderHook(() => useLongPress({ thresholdMs: 500, onTrigger }));
    act(() => { result.current.handlers.onPointerDown({} as any); });
    act(() => { vi.advanceTimersByTime(250); });
    expect(result.current.progress).toBeGreaterThan(0.4);
    expect(result.current.progress).toBeLessThan(0.6);
  });
});
```

- [ ] **Step 2: Install testing-library if missing**

Run:
```bash
cd C:/ai/chemiapebi/yovlisshemdzle/web && npm install --save-dev @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 3: Run test to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- useLongPress`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement**

```ts
// web/src/orbit/useLongPress.ts
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseLongPressOpts {
  thresholdMs: number;
  onTrigger: () => void;
}

export function useLongPress({ thresholdMs, onTrigger }: UseLongPressOpts) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  const [progress, setProgress] = useState(0);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setProgress(0);
  }, []);

  const onPointerDown = useCallback(() => {
    startedAtRef.current = Date.now();
    setProgress(0);
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      const next = Math.min(1, elapsed / thresholdMs);
      setProgress(next);
      if (elapsed >= thresholdMs) {
        cancel();
        onTrigger();
      }
    }, 16);
  }, [thresholdMs, onTrigger, cancel]);

  const onPointerUp = cancel;
  const onPointerLeave = cancel;
  const onPointerCancel = cancel;

  useEffect(() => () => cancel(), [cancel]);

  return {
    progress,
    handlers: { onPointerDown, onPointerUp, onPointerLeave, onPointerCancel },
  };
}
```

- [ ] **Step 5: Run test to verify passes**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- useLongPress`
Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/orbit/useLongPress.ts web/src/orbit/useLongPress.test.ts web/package.json web/package-lock.json && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(orbit): useLongPress hook (500ms threshold, progress 0..1)"
```

---

### Task 2.8: `useOrbitRotation` hook

Auto-rotates 0.3°/frame at 50fps, pausable on interact, resumes 1s after release.

**Files:**
- Create: `web/src/orbit/useOrbitRotation.ts`
- Test: `web/src/orbit/useOrbitRotation.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// web/src/orbit/useOrbitRotation.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOrbitRotation } from "./useOrbitRotation.js";

describe("useOrbitRotation", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("rotates by 0.3 deg per tick (20ms ~ 50fps) when not paused", () => {
    const { result } = renderHook(() => useOrbitRotation({ paused: false }));
    expect(result.current.angle).toBe(0);
    act(() => { vi.advanceTimersByTime(20); });
    expect(result.current.angle).toBeCloseTo(0.3, 5);
  });

  it("does not rotate while paused", () => {
    const { result } = renderHook(() => useOrbitRotation({ paused: true }));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.angle).toBe(0);
  });

  it("wraps angle modulo 360", () => {
    const { result } = renderHook(() => useOrbitRotation({ paused: false }));
    act(() => { vi.advanceTimersByTime(20 * 1300); }); // ~390 deg
    expect(result.current.angle).toBeLessThan(360);
    expect(result.current.angle).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- useOrbitRotation`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// web/src/orbit/useOrbitRotation.ts
import { useEffect, useState } from "react";

const TICK_MS = 20;        // 50fps
const DEG_PER_TICK = 0.3;

export function useOrbitRotation({ paused }: { paused: boolean }) {
  const [angle, setAngle] = useState(0);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setAngle((a) => (a + DEG_PER_TICK) % 360);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [paused]);

  return { angle };
}
```

- [ ] **Step 4: Run test to verify passes**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- useOrbitRotation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/orbit/useOrbitRotation.ts web/src/orbit/useOrbitRotation.test.ts && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(orbit): useOrbitRotation hook (0.3deg/tick, pausable)"
```

---

### Task 2.9: `<OrbitNode />` with delete affordance + Alert undo

**Files:**
- Create: `web/src/orbit/OrbitNode.tsx`
- Test: `web/src/orbit/OrbitNode.smoke.test.tsx`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/orbit/OrbitNode.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { OrbitNode } from "./OrbitNode.js";
describe("OrbitNode module", () => {
  it("exports a function component", () => {
    expect(typeof OrbitNode).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- OrbitNode`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// web/src/orbit/OrbitNode.tsx
import { motion } from "motion/react";
import { useState } from "react";
import { useLongPress } from "./useLongPress.js";

export interface OrbitNodeProps {
  x: number;
  y: number;
  zIndex: number;
  opacity: number;
  label: string;
  size?: number;
  /** When true, long-press unlocks the delete affordance. tools nodes pass false. */
  deletable?: boolean;
  onTap: () => void;
  /** Called when user confirms deletion (✕ tap). */
  onDelete?: () => void;
}

export function OrbitNode({
  x, y, zIndex, opacity, label, size = 24,
  deletable = false, onTap, onDelete,
}: OrbitNodeProps) {
  const [armed, setArmed] = useState(false);
  const { progress, handlers } = useLongPress({
    thresholdMs: 500,
    onTrigger: () => { if (deletable) setArmed(true); },
  });

  // ring color animates white -> red as progress increases
  const ringR = Math.round(255);
  const ringG = Math.round(255 * (1 - progress));
  const ringB = Math.round(255 * (1 - progress));
  const ringColor = armed
    ? "rgb(239,68,68)"
    : `rgb(${ringR},${ringG},${ringB})`;

  return (
    <motion.div
      className="absolute"
      style={{
        left: "50%",
        top: "50%",
        transform: `translate(${x}px, ${y}px)`,
        zIndex,
        opacity,
        touchAction: "manipulation",
        userSelect: "none",
      }}
      onClick={(e) => { e.stopPropagation(); if (!armed) onTap(); }}
      {...handlers}
    >
      <div
        className="rounded-full flex items-center justify-center"
        style={{
          width: size, height: size,
          background: "rgba(0,0,0,0.6)",
          border: `1.5px solid ${ringColor}`,
          boxShadow: armed ? "0 0 18px rgba(239,68,68,0.6)" : undefined,
          transition: "box-shadow 200ms",
        }}
      />
      <div
        className="absolute left-1/2 -translate-x-1/2 mt-2 text-[8px] tracking-wider whitespace-nowrap text-white"
        style={{ opacity: 0.55, top: size }}
      >
        {label}
      </div>
      {armed && (
        <button
          aria-label="confirm delete"
          onClick={(e) => { e.stopPropagation(); setArmed(false); onDelete?.(); }}
          className="absolute -right-3 -top-3 w-6 h-6 rounded-full bg-red-500 text-white text-xs flex items-center justify-center"
        >
          ✕
        </button>
      )}
    </motion.div>
  );
}
```

- [ ] **Step 4: Run smoke test**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- OrbitNode`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/orbit/OrbitNode.tsx web/src/orbit/OrbitNode.smoke.test.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(orbit): OrbitNode with long-press delete affordance"
```

---

### Task 2.10: `<OrbitScreen />`

The home screen: center pulse, inner ring (tools), outer ring (chats with auto-rotate). Delete fires `api.deleteSession()` then shows an undo Alert for 5s.

**Files:**
- Create: `web/src/orbit/OrbitScreen.tsx`
- Test: `web/src/orbit/OrbitScreen.smoke.test.tsx`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/orbit/OrbitScreen.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { OrbitScreen } from "./OrbitScreen.js";
describe("OrbitScreen module", () => {
  it("exports a function component", () => {
    expect(typeof OrbitScreen).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- OrbitScreen`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// web/src/orbit/OrbitScreen.tsx
import { useEffect, useState } from "react";
import { Pulse } from "../components/ava/Pulse.js";
import { PathsBackground } from "../components/ava/PathsBackground.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { computeNodePosition } from "../components/ava/OrbitRing.js";
import { OrbitNode } from "./OrbitNode.js";
import { useOrbitRotation } from "./useOrbitRotation.js";
import { api, fetchSessions, type SessionRow } from "../api.js";
import { useLongPress } from "./useLongPress.js";

const INNER_RADIUS = 90;
const OUTER_RADIUS = 170;
const MAX_CHAT_NODES = 8;

export interface OrbitScreenProps {
  onOpenChat: (sessionId: string | null) => void;
  onOpenMemory: () => void;
  onOpenRules: () => void;
  onEnterVoice: () => void;
}

export function OrbitScreen({
  onOpenChat, onOpenMemory, onOpenRules, onEnterVoice,
}: OrbitScreenProps) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [paused, setPaused] = useState(false);
  const [undoToast, setUndoToast] = useState<{ id: string; title: string } | null>(null);
  const { angle } = useOrbitRotation({ paused });

  // Long-press the center pulse to enter voice
  const { progress: centerProgress, handlers: centerHandlers } = useLongPress({
    thresholdMs: 300,
    onTrigger: onEnterVoice,
  });

  useEffect(() => {
    fetchSessions().then(setSessions).catch(() => {});
  }, []);

  useEffect(() => {
    if (!undoToast) return;
    const id = setTimeout(() => setUndoToast(null), 5000);
    return () => clearTimeout(id);
  }, [undoToast]);

  const visibleSessions = sessions.slice(0, MAX_CHAT_NODES);

  function handleDelete(s: SessionRow) {
    setSessions((prev) => prev.filter((x) => x.id !== s.id));
    setUndoToast({ id: s.id, title: s.title ?? "Untitled" });
    api.deleteSession(s.id).catch(() => {
      // best-effort: rollback if server failed
      fetchSessions().then(setSessions).catch(() => {});
      setUndoToast(null);
    });
  }

  // Tools nodes: + (new chat), ⊕ (memory), ⚙ (rules)
  const tools = [
    { angleDeg: 180, label: "new", emoji: "+", action: () => onOpenChat(null) },
    { angleDeg: 300, label: "memory", emoji: "⊕", action: onOpenMemory },
    { angleDeg: 60, label: "rules", emoji: "⚙", action: onOpenRules },
  ];

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      <PathsBackground opacity={0.1} />

      {/* Center pulse (long-press → voice) */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 cursor-pointer"
        onPointerDown={centerHandlers.onPointerDown}
        onPointerUp={centerHandlers.onPointerUp}
        onPointerLeave={centerHandlers.onPointerLeave}
        onPointerCancel={centerHandlers.onPointerCancel}
        style={{
          filter: centerProgress > 0 ? `brightness(${1 + centerProgress * 0.6})` : undefined,
        }}
      >
        <Pulse layoutId="ava-pulse" state="idle" size={64} />
        <div className="mt-3 text-center text-[9px] tracking-[0.2em] uppercase text-white/60">
          hold to speak
        </div>
      </div>

      {/* Inner ring + tools */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/10"
        style={{ width: INNER_RADIUS * 2, height: INNER_RADIUS * 2 }}
      />
      {tools.map((t, i) => {
        const rad = (t.angleDeg * Math.PI) / 180;
        const x = INNER_RADIUS * Math.cos(rad);
        const y = INNER_RADIUS * Math.sin(rad);
        return (
          <div
            key={i}
            className="absolute left-1/2 top-1/2 z-10"
            style={{ transform: `translate(${x}px, ${y}px)` }}
            onClick={t.action}
          >
            <div className="w-9 h-9 rounded-full border border-white/15 bg-black/60 text-white flex items-center justify-center cursor-pointer">
              {t.emoji}
            </div>
            <div className="text-center text-[9px] mt-1 text-white/55 uppercase tracking-wider">{t.label}</div>
          </div>
        );
      })}

      {/* Outer ring */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/8"
        style={{ width: OUTER_RADIUS * 2, height: OUTER_RADIUS * 2 }}
      />
      {visibleSessions.map((s, i) => {
        const p = computeNodePosition({
          index: i,
          total: Math.max(visibleSessions.length, 1),
          radius: OUTER_RADIUS,
          rotationDeg: angle,
        });
        return (
          <div
            key={s.id}
            onPointerEnter={() => setPaused(true)}
            onPointerLeave={() => setPaused(false)}
          >
            <OrbitNode
              x={p.x} y={p.y} zIndex={p.zIndex} opacity={p.opacity}
              label={s.title ?? "Untitled"}
              deletable
              onTap={() => onOpenChat(s.id)}
              onDelete={() => handleDelete(s)}
            />
          </div>
        );
      })}

      {/* Undo toast (Alert) */}
      {undoToast && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-12 w-72 z-50">
          <Alert variant="info" close onClose={() => setUndoToast(null)}>
            <AlertDescription>
              Deleted “{undoToast.title}”.
              <button
                className="ml-2 underline"
                onClick={() => {
                  setUndoToast(null);
                  fetchSessions().then(setSessions).catch(() => {});
                }}
              >
                undo
              </button>
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}
```

> **Note re: undo:** for this iteration, "undo" simply re-fetches the session list from the server (the soft-delete row stays in DB; server filter excludes it). True undo requires a server-side `restoreSession()` endpoint not in this spec — flagged for future work. The toast text and behavior here intentionally match the spec's "Deleted · undo" 5s window without persisting state.

- [ ] **Step 4: Run smoke test**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- OrbitScreen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/orbit/OrbitScreen.tsx web/src/orbit/OrbitScreen.smoke.test.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(orbit): OrbitScreen (rings, tools, chat nodes, undo toast)"
```

---

### Task 2.11: Wire OrbitScreen into App.tsx

Replace the existing landing/sessions handling with the new orbital view machine. Voice/chat slots are stubbed (their screens land in later phases) but the state shape is final.

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Replace `App.tsx` content**

```tsx
// web/src/App.tsx
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getToken } from "./auth/tokens.js";
import { PairingScreen } from "./auth/PairingScreen.js";
import { ChatScreen } from "./chat/ChatScreen.js";
import { RulesScreen } from "./rules/RulesScreen.js";
import { MemoryEditor } from "./memory/MemoryEditor.js";
import { OrbitScreen } from "./orbit/OrbitScreen.js";
import { GlassFilter } from "./components/ava/GlassFilter.js";

type View =
  | { name: "orbit" }
  | { name: "chat"; sessionId: string | null }
  | { name: "voice"; from: "orbit" | "chat"; sessionId: string | null }
  | { name: "memory" }
  | { name: "rules" };

export function App() {
  const [paired, setPaired] = useState<boolean>(!!getToken());
  const [view, setView] = useState<View>({ name: "orbit" });

  if (!paired) return <PairingScreen onPaired={() => setPaired(true)} />;

  return (
    <div className="relative w-full h-full bg-black text-white">
      <GlassFilter />
      <AnimatePresence mode="wait">
        {view.name === "orbit" && (
          <motion.div
            key="orbit"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.4 }}
            transition={{ duration: 0.3 }}
          >
            <OrbitScreen
              onOpenChat={(sessionId) => setView({ name: "chat", sessionId })}
              onOpenMemory={() => setView({ name: "memory" })}
              onOpenRules={() => setView({ name: "rules" })}
              onEnterVoice={() => setView({ name: "voice", from: "orbit", sessionId: null })}
            />
          </motion.div>
        )}
        {view.name === "chat" && (
          <motion.div
            key={`chat-${view.sessionId ?? "new"}`}
            className="absolute inset-0"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <ChatScreen
              sessionId={view.sessionId}
              onOpenSessions={() => setView({ name: "orbit" })}
              onOpenRules={() => setView({ name: "rules" })}
              onOpenMemory={() => setView({ name: "memory" })}
            />
          </motion.div>
        )}
        {view.name === "voice" && (
          <motion.div
            key="voice"
            className="absolute inset-0 bg-black flex items-center justify-center text-white/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            voice mode (Phase 4)
            <button onClick={() => setView({ name: "orbit" })} className="absolute top-4 right-4">✕</button>
          </motion.div>
        )}
        {view.name === "memory" && (
          <motion.div
            key="memory"
            className="absolute inset-0 bg-black"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <MemoryEditor onClose={() => setView({ name: "orbit" })} />
          </motion.div>
        )}
        {view.name === "rules" && (
          <motion.div
            key="rules"
            className="absolute inset-0 bg-black"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <RulesScreen onClose={() => setView({ name: "orbit" })} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual smoke test**

Run dev server, log in, verify orbit screen appears with sessions arranged, long-press a chat node → red ring → ✕ → optimistic remove + undo toast. Tools nodes (+ ⊕ ⚙) navigate to chat/memory/rules. Long-press center → "voice mode (Phase 4)" placeholder.

- [ ] **Step 4: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/App.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(web): orbit-driven App.tsx state machine (orbit/chat/voice/memory/rules)"
```

---

## Phase 3 — Chat screen (~1 day)

### Task 3.1: `<ToolCallChip />`

**Files:**
- Create: `web/src/chat/ToolCallChip.tsx`
- Test: `web/src/chat/ToolCallChip.smoke.test.tsx`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/chat/ToolCallChip.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { ToolCallChip } from "./ToolCallChip.js";
describe("ToolCallChip module", () => {
  it("exports a function component", () => {
    expect(typeof ToolCallChip).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- ToolCallChip`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// web/src/chat/ToolCallChip.tsx
import { useState } from "react";
import { motion } from "motion/react";

export interface ToolCallChipProps {
  tool: string;
  argSummary?: string;
  result?: string;
  ok?: boolean;
}

export function ToolCallChip({ tool, argSummary, result, ok }: ToolCallChipProps) {
  const [open, setOpen] = useState(false);
  const summary = argSummary ?? "";
  return (
    <motion.div layout className="my-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-[10px] px-2 py-1 rounded-md border border-white/10 text-white/60 hover:text-white/85 hover:border-white/20"
      >
        {open ? "▾" : "▸"} {tool}
        {summary ? ` · ${summary}` : ""}
      </button>
      {open && (
        <motion.pre
          layout
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-1 ml-3 text-[10px] font-mono whitespace-pre-wrap text-white/70 border-l border-white/10 pl-2"
        >
          {ok === false ? "ERROR: " : ""}{result ?? "(no result)"}
        </motion.pre>
      )}
    </motion.div>
  );
}
```

- [ ] **Step 4: Run smoke test**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- ToolCallChip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/chat/ToolCallChip.tsx web/src/chat/ToolCallChip.smoke.test.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(chat): add collapsible ToolCallChip"
```

---

### Task 3.2: New `<MessageList />`

Replaces existing MessageList. User messages → glassy bubble right; Ava messages → plain text left; tool calls → ToolCallChip; thinking state → inline Pulse + ShiningText caption.

**Files:**
- Modify: `web/src/chat/MessageList.tsx` (replace contents)
- Test: `web/src/chat/MessageList.smoke.test.tsx`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/chat/MessageList.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { MessageList } from "./MessageList.js";
describe("MessageList module", () => {
  it("exports a function component", () => {
    expect(typeof MessageList).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- MessageList`
Expected: FAIL or PASS-but-old. Either way we'll replace.

- [ ] **Step 3: Replace `MessageList.tsx`**

```tsx
// web/src/chat/MessageList.tsx
import { useEffect, useRef } from "react";
import { Pulse } from "../components/ava/Pulse.js";
import { ShiningText } from "../components/ava/ShiningText.js";
import { ToolCallChip } from "./ToolCallChip.js";
import type { StreamEvent } from "./useChatStream.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface MessageListProps {
  history: ChatMessage[];
  liveEvents: StreamEvent[];
}

export function MessageList({ history, liveEvents }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history.length, liveEvents.length]);

  // The latest run's events grouped: thoughts/tool_calls/tool_results, ending in final | error | killed | done
  // For simplicity we render everything in stream order under the last user message.

  const lastFinal = [...liveEvents].reverse().find((e) => e.kind === "final");
  const isThinking = liveEvents.length > 0
    && !lastFinal
    && !liveEvents.some((e) => e.kind === "done" || e.kind === "killed" || e.kind === "error");

  // Latest "thought" or last tool_call name → caption text
  let thinkingCaption = "thinking…";
  for (let i = liveEvents.length - 1; i >= 0; i--) {
    const e = liveEvents[i];
    if (e?.kind === "tool_call") { thinkingCaption = `running ${e.payload.tool}…`; break; }
    if (e?.kind === "thought") { thinkingCaption = e.payload.text.slice(0, 80); break; }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-3">
      {history.map((m) => (
        <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
          {m.role === "user" ? (
            <div className="max-w-[75%] rounded-2xl rounded-br-sm border border-white/10 bg-white/10 px-3 py-2 text-sm">
              {m.text}
            </div>
          ) : (
            <div className="max-w-[85%] text-sm leading-[1.55] text-white/85 whitespace-pre-wrap">
              {m.text}
            </div>
          )}
        </div>
      ))}

      {/* Live tool-call chips */}
      {liveEvents.filter((e) => e.kind === "tool_call" || e.kind === "tool_result").map((e) => {
        if (e.kind === "tool_call") {
          return <ToolCallChip key={`tc-${e.id}`} tool={e.payload.tool} argSummary={
            typeof e.payload.args === "object" ? JSON.stringify(e.payload.args).slice(0, 40) : String(e.payload.args)
          } />;
        }
        if (e.kind === "tool_result") {
          return <ToolCallChip key={`tr-${e.id}`} tool={e.payload.tool} ok={e.payload.ok} result={e.payload.result} />;
        }
        return null;
      })}

      {/* Live final */}
      {lastFinal && (
        <div className="flex justify-start">
          <div className="max-w-[85%] text-sm leading-[1.55] text-white/85 whitespace-pre-wrap">
            {lastFinal.payload.text}
          </div>
        </div>
      )}

      {/* Inline thinking */}
      {isThinking && (
        <div className="flex items-center gap-2 text-white/60">
          <Pulse state="thinking" size={14} />
          <ShiningText text={thinkingCaption} className="text-xs" />
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
```

- [ ] **Step 4: Run smoke test**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- MessageList`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/chat/MessageList.tsx web/src/chat/MessageList.smoke.test.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(chat): rebuild MessageList (bubbles + plain + inline thinking + tool chips)"
```

---

### Task 3.3: New `<Composer />`

Glassy textarea (auto-resize), QuickChips folded above as a horizontal scroll row, mic gradient pulse on the left of send. Replaces existing Composer + QuickChips.

**Files:**
- Modify: `web/src/chat/Composer.tsx`
- Delete: `web/src/chat/QuickChips.tsx` (logic folded inside Composer)
- Test: `web/src/chat/Composer.smoke.test.tsx`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/chat/Composer.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { Composer } from "./Composer.js";
describe("Composer module", () => {
  it("exports a function component", () => {
    expect(typeof Composer).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- Composer.smoke`
Expected: FAIL or stale. Either way, replace.

- [ ] **Step 3: Replace `Composer.tsx`**

```tsx
// web/src/chat/Composer.tsx
import { useEffect, useRef, useState } from "react";
import { fetchSuggestedChips, type SuggestedChip } from "../api.js";
import { Textarea } from "../components/ui/textarea.js";
import { Pulse } from "../components/ava/Pulse.js";
import { ArrowUp, Square } from "lucide-react";

export interface ComposerProps {
  onSend: (text: string) => void;
  onKill: () => void;
  onMicTap: () => void;
  busy: boolean;
  seed: { text: string; version: number };
}

export function Composer({ onSend, onKill, onMicTap, busy, seed }: ComposerProps) {
  const [text, setText] = useState("");
  const [chips, setChips] = useState<SuggestedChip[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Load suggested chips
  useEffect(() => {
    fetchSuggestedChips().then(setChips).catch(() => {});
  }, []);

  // Apply seed (e.g., chip-tapped prompt) into the textarea
  useEffect(() => {
    if (seed.version > 0) {
      setText(seed.text);
      taRef.current?.focus();
    }
  }, [seed.version]);

  // Auto-resize textarea
  function adjust() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "48px";
    const next = Math.min(ta.scrollHeight, 150);
    ta.style.height = `${next}px`;
  }
  useEffect(adjust, [text]);

  function submit() {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
    if (taRef.current) taRef.current.style.height = "48px";
  }

  return (
    <div className="sticky bottom-0 px-3 pb-3 pt-2 bg-gradient-to-t from-black via-black/85 to-transparent">
      {chips.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {chips.map((c) => (
            <button
              key={c.id}
              onClick={() => setText(c.prompt)}
              className="shrink-0 px-3 py-1.5 rounded-full text-xs border border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
              title={c.prompt}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur-md flex items-end gap-2 p-2">
        <Textarea
          ref={taRef}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Message Ava…"
          className="resize-none min-h-[48px] max-h-[150px] border-none bg-transparent focus-visible:ring-0"
        />
        <button
          aria-label="voice"
          onClick={onMicTap}
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
        >
          <Pulse layoutId="ava-pulse" state="idle" size={28} />
        </button>
        {busy ? (
          <button aria-label="stop" onClick={onKill} className="shrink-0 w-9 h-9 rounded-md bg-red-500/90 text-white flex items-center justify-center">
            <Square size={14} />
          </button>
        ) : (
          <button aria-label="send" onClick={submit} className="shrink-0 w-9 h-9 rounded-md bg-white text-black flex items-center justify-center disabled:opacity-50" disabled={!text.trim()}>
            <ArrowUp size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Delete obsolete `QuickChips.tsx`**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle rm web/src/chat/QuickChips.tsx
```

- [ ] **Step 5: Run smoke test**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- Composer.smoke`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/chat/Composer.tsx web/src/chat/Composer.smoke.test.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(chat): rebuild Composer (chips + glassy textarea + mic pulse)"
```

---

### Task 3.4: New `<ChatScreen />`

**Files:**
- Modify: `web/src/chat/ChatScreen.tsx`
- Test: `web/src/chat/ChatScreen.smoke.test.tsx`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/chat/ChatScreen.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { ChatScreen } from "./ChatScreen.js";
describe("ChatScreen module", () => {
  it("exports a function component", () => {
    expect(typeof ChatScreen).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- ChatScreen.smoke`
Expected: FAIL or stale.

- [ ] **Step 3: Replace `ChatScreen.tsx`**

```tsx
// web/src/chat/ChatScreen.tsx
import { useEffect, useState } from "react";
import { api, fetchSession } from "../api.js";
import { MessageList, type ChatMessage } from "./MessageList.js";
import { Composer } from "./Composer.js";
import { useChatStream } from "./useChatStream.js";
import { PathsBackground } from "../components/ava/PathsBackground.js";
import { Pulse } from "../components/ava/Pulse.js";
import { ChevronLeft } from "lucide-react";

export interface ChatScreenProps {
  sessionId: string | null;
  onOpenSessions: () => void;   // back to orbit
  onOpenRules: () => void;
  onOpenMemory: () => void;
  onEnterVoice?: () => void;
}

export function ChatScreen({
  sessionId: requestedSessionId,
  onOpenSessions,
  onEnterVoice,
}: ChatScreenProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [runEpoch, setRunEpoch] = useState(0);
  const { events } = useChatStream(sessionId, runEpoch);
  const [seed, setSeed] = useState<{ text: string; version: number }>({ text: "", version: 0 });
  const [title, setTitle] = useState<string>("New chat");

  useEffect(() => {
    let cancelled = false;
    if (requestedSessionId === null) {
      setSessionId(null);
      setHistory([]);
      setRunEpoch(0);
      setTitle("New chat");
      return;
    }
    if (requestedSessionId === sessionId) return;
    fetchSession(requestedSessionId)
      .then((data) => {
        if (cancelled) return;
        const loaded: ChatMessage[] = data.messages.map((m) => ({
          id: `s-${m.id}`,
          role: m.role === "user" ? "user" : "assistant",
          text: m.content,
        }));
        setHistory(loaded);
        setSessionId(requestedSessionId);
        setRunEpoch(0);
        setTitle(data.session.title ?? "Untitled");
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [requestedSessionId]);

  const currentRunFinished = events.some(
    (e) => e.runEpoch === runEpoch && (e.kind === "done" || e.kind === "killed" || e.kind === "error"),
  );
  const busy = runEpoch > 0 && !currentRunFinished;

  // Header pulse state mirrors what's happening
  const headerState: "idle" | "thinking" | "responding" =
    busy
      ? events.some((e) => e.runEpoch === runEpoch && e.kind === "final")
        ? "responding"
        : "thinking"
      : "idle";

  async function send(text: string) {
    setHistory((prev) => [...prev, { role: "user", text, id: `u-${Date.now()}` }]);
    const r = await api.sendMessage(sessionId, text);
    setSessionId(r.sessionId);
    setRunEpoch((n) => n + 1);
  }

  async function kill() {
    if (!sessionId) return;
    await api.kill(sessionId);
  }

  return (
    <div className="relative flex flex-col h-full">
      <PathsBackground opacity={0.18} />
      <header className="relative z-10 flex items-center justify-between px-3 py-2 border-b border-white/8 bg-black/30 backdrop-blur-sm h-14">
        <button onClick={onOpenSessions} aria-label="back to orbit" className="text-white/70 px-2">
          <ChevronLeft size={20} />
        </button>
        <div className="text-sm font-medium truncate max-w-[60%]">{title}</div>
        <Pulse state={headerState} size={14} />
      </header>
      <div className="relative z-10 flex-1 flex flex-col">
        <MessageList history={history} liveEvents={events} />
        <Composer
          onSend={send}
          onKill={kill}
          onMicTap={() => onEnterVoice?.()}
          busy={busy}
          seed={seed}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run smoke test**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- ChatScreen.smoke`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/chat/ChatScreen.tsx web/src/chat/ChatScreen.smoke.test.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(chat): rebuild ChatScreen (paths bg + 56px header + state-aware pulse)"
```

---

### Task 3.5: Wire chat into App.tsx state machine

Update `App.tsx` to pass `onEnterVoice` through to `ChatScreen` so the composer mic enters voice mode (which in Phase 4 will be a real screen — for now lands on the placeholder).

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Update the chat case in App.tsx**

In the `<motion.div>` for `view.name === "chat"`, change `<ChatScreen … />` to:

```tsx
<ChatScreen
  sessionId={view.sessionId}
  onOpenSessions={() => setView({ name: "orbit" })}
  onOpenRules={() => setView({ name: "rules" })}
  onOpenMemory={() => setView({ name: "memory" })}
  onEnterVoice={() => setView({ name: "voice", from: "chat", sessionId: view.sessionId })}
/>
```

- [ ] **Step 2: Verify build**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual smoke**

Open chat, type a message, verify it streams in. Tap mic → voice placeholder. Tap back-to-orbit. Open older chat from orbit, verify history loads.

- [ ] **Step 4: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/App.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(web): wire chat composer mic → voice state"
```

---

## Phase 4 — Voice mode (~1.5 days)

### Task 4.0: Spike — choose realtime path vs. record-and-send

The spec describes voice mode as if a Realtime SSE proxy already exists. The current server only has `POST /api/voice/transcribe` (file upload → text) and `POST /api/voice/speak` (text → mp3). Decide path before screen work.

**Files:**
- Create: `docs/superpowers/notes/2026-04-29-voice-spike.md`

- [ ] **Step 1: Verify the gpt-4o-realtime model is reachable from the API key**

Run a one-off curl from the server box (do NOT commit secrets):

```bash
cd C:/ai/chemiapebi/yovlisshemdzle/server && node -e "
const { OpenAI } = require('openai');
const c = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
c.models.list().then(r => {
  const ok = r.data.some(m => m.id.includes('realtime'));
  console.log('realtime available:', ok);
}).catch(e => console.log('error', e.message));
"
```

Expected: prints `realtime available: true` or `false`.

- [ ] **Step 2: Decide path and document**

Write `docs/superpowers/notes/2026-04-29-voice-spike.md`:

```markdown
# Voice Spike — 2026-04-29

## Realtime API availability
- Available: <yes/no>

## Decision
- **Path A — Realtime SSE proxy** (chosen if realtime is available + ws relay is feasible).
  - New endpoint: `GET /api/voice/realtime?sessionId=...` (SSE).
  - Server holds a websocket to OpenAI Realtime, proxies events back as SSE.
  - Persists `transcript.user` and `transcript.assistant` events to messages table.
- **Path B — Record-and-send** (fallback).
  - Existing `POST /api/voice/transcribe` + new `POST /api/voice/turn` that:
    - Accepts `{ sessionId, audioBlob }`.
    - Calls existing transcribe, appends user message.
    - Calls chat agent (same path as `/api/chat`), gets response.
    - Calls existing speak (TTS) for response.
    - Returns `{ text, audioUrl, sessionId }`.
  - Less flashy: one-shot per turn, no live partial transcripts. But works on the existing infra.

## Chosen for this implementation: <Path A | Path B>

## Notes
- Authentication: existing `requireToken` middleware applied.
- Session creation: if `sessionId === null` on first turn, mint via existing session repo.
- Acceptance test: orbit → voice → 1 turn → exit → orbit shows new node, full transcript visible if you tap into it.
```

- [ ] **Step 3: Commit the decision note**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add docs/superpowers/notes/2026-04-29-voice-spike.md && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "docs(voice): spike decision (realtime SSE vs record-and-send)"
```

> The remaining tasks 4.1–4.6 below assume **Path B (record-and-send)** because it's strictly buildable on the existing infra, and the realtime websocket relay is significant additional scope. If the spike chose Path A, swap the server endpoint code in 4.1 for an SSE-proxy implementation but keep the client API surface (`useVoiceSession`) identical so the screen code doesn't change.

---

### Task 4.1: Server `POST /api/voice/turn` (Path B)

Adds a single-turn endpoint that takes audio + sessionId, transcribes the user, runs the chat agent, returns text+audio, and persists both transcripts.

**Files:**
- Modify: `server/src/routes/voice.ts`
- Modify: `server/src/routes/voice.test.ts`

- [ ] **Step 1: Add failing test**

Append to `server/src/routes/voice.test.ts`:

```ts
import { appendMessage, listMessages } from "../state/messages.js";

describe("voiceRoutes /api/voice/turn", () => {
  it("400 if missing audio", async () => {
    const { app } = setup();
    await request(app).post("/api/voice/turn").expect(400);
  });

  it("persists user + assistant transcripts when audio provided", async () => {
    // fakeClients returns canned text + tts; spy on the fake.
    const { app, db, fakeClients } = setupWithFakes({
      transcribe: "where do i live",
      assistantReply: "you live in ireland.",
    });
    const s = createSession(db, { title: null });
    await request(app)
      .post(`/api/voice/turn?sessionId=${s.id}`)
      .attach("audio", Buffer.from([0,1,2]), { filename: "x.webm", contentType: "audio/webm" })
      .expect(200);
    const msgs = listMessages(db, s.id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs.map((m) => m.content)).toEqual(["where do i live", "you live in ireland."]);
  });
});

// In setupWithFakes (add near top of test file): same as setup() but injects a
// fake VoiceClients + fake agent runner so we can assert without hitting OpenAI.
```

(Implementation of `setupWithFakes` is part of step 3 below — define it alongside the existing `setup()`.)

- [ ] **Step 2: Run test to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/server && npm test -- routes/voice`
Expected: FAIL — endpoint missing, helper missing.

- [ ] **Step 3: Implement**

In `server/src/routes/voice.ts` add the handler (and a small `runAgentForVoice` helper that mirrors `chatRoutes`'s agent invocation):

```ts
// Append to voiceRoutes()
router.post("/voice/turn", deps.requireToken, upload.single("audio"), async (req, res) => {
  if (!deps.clients) {
    return res.status(503).json({ error: "OPENAI_API_KEY not configured" });
  }
  const file = req.file;
  if (!file) return res.status(400).json({ error: "missing audio file" });
  const sessionIdRaw = req.query.sessionId;
  let sessionId = typeof sessionIdRaw === "string" && sessionIdRaw ? sessionIdRaw : null;

  try {
    // 1) Transcribe
    const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });
    const f = await toFile(blob, file.originalname || "audio.webm", { type: file.mimetype });
    const tr = await deps.clients.openai.audio.transcriptions.create({
      file: f,
      model: "gpt-4o-transcribe",
    });
    const userText = tr.text.trim();
    if (!userText) return res.status(400).json({ error: "empty transcript" });

    // 2) Mint session if needed, append user msg
    if (!sessionId) {
      sessionId = deps.createSession({ title: null }).id;
    }
    deps.appendMessage({ sessionId, role: "user", content: userText });

    // 3) Run chat agent for one turn (no streaming) — uses same provider as /api/chat
    const replyText = await deps.runChatTurn({ sessionId, userText });
    deps.appendMessage({ sessionId, role: "assistant", content: replyText });

    // 4) TTS the reply
    const speech = await deps.clients.openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "nova",
      input: replyText,
    });
    const audioBuf = Buffer.from(await speech.arrayBuffer());

    return res.json({
      sessionId,
      userText,
      assistantText: replyText,
      audio: audioBuf.toString("base64"),
      audioMime: "audio/mpeg",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: `voice turn failed: ${msg}` });
  }
});
```

Update `voiceRoutes` deps signature to take the new dependencies:

```ts
export function voiceRoutes(deps: {
  clients: VoiceClients;
  requireToken: RequestHandler;
  createSession: (opts: { title: string | null }) => { id: string };
  appendMessage: (m: { sessionId: string; role: string; content: string }) => void;
  runChatTurn: (input: { sessionId: string; userText: string }) => Promise<string>;
}): ExpressRouter { ... }
```

In `server/src/index.ts`, pass the new deps through:

```ts
import { createSession } from "./state/sessions.js";
import { appendMessage } from "./state/messages.js";
import { runChatTurnForVoice } from "./agent/voice-turn.js";  // helper file you'll add

app.use("/api", voiceRoutes({
  clients: voiceClients,
  requireToken: requireToken(db),
  createSession: (opts) => createSession(db, opts),
  appendMessage: (m) => appendMessage(db, m),
  runChatTurn: ({ sessionId, userText }) => runChatTurnForVoice({ db, runs, agentDeps, anthropic, sessionId, userText }),
}));
```

Create `server/src/agent/voice-turn.ts` that wraps the same agent call `chatRoutes` makes for a synchronous (non-stream) single turn. Read `server/src/routes/chat.ts` to mirror the call pattern; expose only the final text. Implementation outline (the executing agent fills in the call signature based on the actual agent helper available in the codebase):

```ts
// server/src/agent/voice-turn.ts
import type { Db } from "../state/db.js";
// ...import same deps the chat route uses

export async function runChatTurnForVoice(args: {
  db: Db;
  runs: any;
  agentDeps: any;
  anthropic: any;
  sessionId: string;
  userText: string;
}): Promise<string> {
  // Reuse the agent runner from chatRoutes but consume only the final text.
  // If chatRoutes streams via SSE only, refactor the inner agent call into a
  // separate function (e.g., runAgentTurn) used by both. Implementation must
  // not duplicate the agent loop.
  throw new Error("implement by refactoring chat.ts agent loop into a shared helper");
}
```

> **Refactor note for the implementer:** if `server/src/routes/chat.ts` has its agent loop inlined, extract it into a function `runAgentTurn({ db, sessionId, userText, ... }): Promise<{ finalText: string }>` first, then call from both chat.ts (in its SSE handler) and voice-turn.ts. Do this as a small refactor commit before this task's main commit.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/server && npm test -- routes/voice`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add server/src/routes/voice.ts server/src/routes/voice.test.ts server/src/agent/voice-turn.ts server/src/index.ts && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(voice): POST /api/voice/turn — single-turn voice with persistence"
```

---

### Task 4.2: `useMicAmplitude` hook

Web Audio API → 0..1 amplitude. Used by `<Pulse state="listening" amplitude={...} />`.

**Files:**
- Create: `web/src/voice/useMicAmplitude.ts`
- Test: `web/src/voice/useMicAmplitude.smoke.test.ts`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/voice/useMicAmplitude.smoke.test.ts
import { describe, it, expect } from "vitest";
import { useMicAmplitude } from "./useMicAmplitude.js";
describe("useMicAmplitude module", () => {
  it("exports a function", () => {
    expect(typeof useMicAmplitude).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- useMicAmplitude`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// web/src/voice/useMicAmplitude.ts
import { useEffect, useState } from "react";

export function useMicAmplitude(active: boolean): number {
  const [amp, setAmp] = useState(0);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let stream: MediaStream | null = null;
    let stopped = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          if (stopped || !analyser) return;
          analyser.getByteTimeDomainData(data);
          // RMS, then map to 0..1
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i]! - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          setAmp(Math.min(1, rms * 3));
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // mic permission denied — caller should show an Alert
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
    };
  }, [active]);

  return amp;
}
```

- [ ] **Step 4: Run smoke test**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- useMicAmplitude`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/voice/useMicAmplitude.ts web/src/voice/useMicAmplitude.smoke.test.ts && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(voice): useMicAmplitude hook (Web Audio RMS → 0..1)"
```

---

### Task 4.3: `useVoiceSession` hook

Wraps the record-then-send turn flow. Recorder uses MediaRecorder; states: `idle | listening | thinking | responding`.

**Files:**
- Create: `web/src/voice/useVoiceSession.ts`
- Test: `web/src/voice/useVoiceSession.smoke.test.ts`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/voice/useVoiceSession.smoke.test.ts
import { describe, it, expect } from "vitest";
import { useVoiceSession } from "./useVoiceSession.js";
describe("useVoiceSession module", () => {
  it("exports a function", () => {
    expect(typeof useVoiceSession).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- useVoiceSession`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// web/src/voice/useVoiceSession.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "../auth/tokens.js";

export type VoiceState = "idle" | "listening" | "thinking" | "responding";

export interface VoiceCaption {
  who: "you" | "ava";
  text: string;
}

export function useVoiceSession({ initialSessionId }: { initialSessionId: string | null }) {
  const [state, setState] = useState<VoiceState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [caption, setCaption] = useState<VoiceCaption | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const startListening = useCallback(async () => {
    try {
      setErrorMsg(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await sendTurn(blob);
      };
      mediaRef.current = mr;
      mr.start();
      setState("listening");
    } catch (e) {
      setErrorMsg("Microphone permission denied");
      setState("idle");
    }
  }, []);

  const stopListening = useCallback(() => {
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
      setState("thinking");
    }
  }, []);

  const sendTurn = useCallback(async (blob: Blob) => {
    setState("thinking");
    const fd = new FormData();
    fd.append("audio", blob, "audio.webm");
    const token = getToken() ?? "";
    const url = `/api/voice/turn${sessionId ? `?sessionId=${sessionId}` : ""}`;
    let resp: Response;
    try {
      resp = await fetch(url, { method: "POST", body: fd, headers: { authorization: `Bearer ${token}` } });
    } catch {
      setErrorMsg("network error");
      setState("idle");
      return;
    }
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      setErrorMsg((body as { error?: string }).error ?? `HTTP ${resp.status}`);
      setState("idle");
      return;
    }
    const j = await resp.json() as {
      sessionId: string;
      userText: string;
      assistantText: string;
      audio: string;
      audioMime: string;
    };
    setSessionId(j.sessionId);
    setCaption({ who: "you", text: j.userText });

    // Play audio + flip to responding
    const bin = atob(j.audio);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const audioBlob = new Blob([buf], { type: j.audioMime });
    const audioUrl = URL.createObjectURL(audioBlob);
    const el = new Audio(audioUrl);
    audioElRef.current = el;
    setState("responding");
    setCaption({ who: "ava", text: j.assistantText });
    el.onended = () => {
      URL.revokeObjectURL(audioUrl);
      setState("idle");
    };
    el.play().catch(() => {
      // playback failed — still show caption, drop back to idle
      setState("idle");
    });
  }, [sessionId]);

  const stopResponding = useCallback(() => {
    audioElRef.current?.pause();
    audioElRef.current = null;
    setState("idle");
  }, []);

  useEffect(() => () => {
    mediaRef.current?.stream?.getTracks().forEach((t) => t.stop());
    audioElRef.current?.pause();
  }, []);

  return { state, sessionId, caption, errorMsg, startListening, stopListening, stopResponding };
}
```

- [ ] **Step 4: Run smoke test**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- useVoiceSession`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/voice/useVoiceSession.ts web/src/voice/useVoiceSession.smoke.test.ts && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(voice): useVoiceSession hook (record → /voice/turn → playback)"
```

---

### Task 4.4: `<VoiceScreen />`

Full-screen voice mode with the 3 visible states + caption block + bottom controls.

**Files:**
- Create: `web/src/voice/VoiceScreen.tsx`
- Test: `web/src/voice/VoiceScreen.smoke.test.tsx`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/voice/VoiceScreen.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { VoiceScreen } from "./VoiceScreen.js";
describe("VoiceScreen module", () => {
  it("exports a function component", () => {
    expect(typeof VoiceScreen).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- VoiceScreen`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// web/src/voice/VoiceScreen.tsx
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Pulse } from "../components/ava/Pulse.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { useVoiceSession } from "./useVoiceSession.js";
import { useMicAmplitude } from "./useMicAmplitude.js";
import { Mic, Square, Keyboard, MicOff, Pause, X } from "lucide-react";

export interface VoiceScreenProps {
  initialSessionId: string | null;
  onExit: (sessionId: string | null) => void;
  onSwitchToKeyboard: (sessionId: string | null) => void;
}

export function VoiceScreen({ initialSessionId, onExit, onSwitchToKeyboard }: VoiceScreenProps) {
  const v = useVoiceSession({ initialSessionId });
  const amp = useMicAmplitude(v.state === "listening");
  const [muted, setMuted] = useState(false);
  const [secs, setSecs] = useState(0);

  // Auto-start listening when screen mounts.
  useEffect(() => { v.startListening(); }, []);

  // Status timer
  useEffect(() => {
    if (v.state !== "listening") return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [v.state]);
  useEffect(() => { if (v.state === "idle") setSecs(0); }, [v.state]);

  const tintClass =
    v.state === "responding" ? "from-[#0b1a2e]" :
    v.state === "thinking"   ? "from-[#1a1a1a]" :
                                "from-[#1a0b2e]";

  const stateLabel =
    v.state === "listening"  ? `LISTENING · ${formatTime(secs)}` :
    v.state === "thinking"   ? "THINKING…" :
    v.state === "responding" ? "AVA · SPEAKING" :
                                "READY";

  return (
    <div className={`relative w-full h-full overflow-hidden bg-gradient-radial bg-black`} style={{
      backgroundImage: `radial-gradient(circle at 50% 50%, ${
        v.state === "responding" ? "#0b1a2e" : v.state === "thinking" ? "#1a1a1a" : "#1a0b2e"
      } 0%, #000 70%)`,
    }}>
      {/* Top header */}
      <div className="absolute top-5 left-5 text-[9px] tracking-[0.2em] uppercase text-white/50">{stateLabel}</div>
      <button
        onClick={() => onExit(v.sessionId)}
        aria-label="exit"
        className="absolute top-5 right-5 w-8 h-8 rounded-full border border-white/15 bg-white/5 text-white/70 flex items-center justify-center"
      >
        <X size={14} />
      </button>

      {/* Expanding rings */}
      <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 w-[280px] h-[280px] rounded-full border border-white/10" />
      <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 w-[220px] h-[220px] rounded-full border border-white/15" />
      <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 w-[160px] h-[160px] rounded-full border border-white/25" />

      {/* Pulse */}
      <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2">
        <Pulse layoutId="ava-pulse" state={v.state === "idle" ? "idle" : v.state} size={120} amplitude={amp} />
      </div>

      {/* Caption */}
      {v.caption && (
        <motion.div
          key={v.caption.text}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute left-0 right-0 bottom-[170px] px-6 text-center"
        >
          <div className="text-[9px] uppercase tracking-[0.2em] text-white/40 mb-2">{v.caption.who === "you" ? "you" : "ava"}</div>
          <div className="text-sm text-white/90 leading-snug max-w-[280px] mx-auto">{v.caption.text}</div>
        </motion.div>
      )}

      {/* Error */}
      {v.errorMsg && (
        <div className="absolute left-1/2 -translate-x-1/2 top-20 w-72">
          <Alert variant="destructive" close onClose={() => onExit(v.sessionId)}>
            <AlertDescription>{v.errorMsg}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Bottom controls */}
      <div className="absolute left-0 right-0 bottom-8 flex items-center justify-center gap-5">
        <button
          aria-label={muted ? "unmute" : "mute"}
          onClick={() => setMuted((m) => !m)}
          className="w-12 h-12 rounded-full border border-white/15 bg-white/5 text-white flex items-center justify-center"
        >
          {muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        {v.state === "listening" && (
          <button
            aria-label="end turn"
            onClick={v.stopListening}
            className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-[0_0_24px_rgba(239,68,68,0.5)]"
          >
            <Square size={20} />
          </button>
        )}
        {v.state === "responding" && (
          <button
            aria-label="interrupt"
            onClick={v.stopResponding}
            className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center shadow-[0_0_24px_rgba(255,255,255,0.3)]"
          >
            <Pause size={20} />
          </button>
        )}
        {v.state !== "listening" && v.state !== "responding" && (
          <button
            aria-label="start listening"
            onClick={v.startListening}
            className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center"
          >
            <Mic size={20} />
          </button>
        )}
        <button
          aria-label="keyboard"
          onClick={() => onSwitchToKeyboard(v.sessionId)}
          className="w-12 h-12 rounded-full border border-white/15 bg-white/5 text-white flex items-center justify-center"
        >
          <Keyboard size={18} />
        </button>
      </div>
    </div>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run smoke test**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- VoiceScreen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/voice/VoiceScreen.tsx web/src/voice/VoiceScreen.smoke.test.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(voice): VoiceScreen (3 states + caption + bottom controls)"
```

---

### Task 4.5: layoutId morph + reduce-motion fallback

Wire VoiceScreen into App.tsx so the `layoutId="ava-pulse"` morph from orbit center / chat composer mic into the fullscreen orb works through `<AnimatePresence>`. Add a reduce-motion guard.

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Replace the voice case in App.tsx**

Replace the placeholder voice motion.div with:

```tsx
{view.name === "voice" && (
  <motion.div
    key="voice"
    className="absolute inset-0"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.2 }}
  >
    <VoiceScreen
      initialSessionId={view.sessionId}
      onExit={(sid) => {
        if (view.from === "chat") setView({ name: "chat", sessionId: sid });
        else setView({ name: "orbit" });
      }}
      onSwitchToKeyboard={(sid) => setView({ name: "chat", sessionId: sid })}
    />
  </motion.div>
)}
```

Add the import:

```ts
import { VoiceScreen } from "./voice/VoiceScreen.js";
```

- [ ] **Step 2: Manual smoke**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm run dev`

Test sequence:
- Long-press orbit center → Pulse morphs to fullscreen, listening starts.
- Speak, release → state goes to thinking → responding → idle.
- Tap ✕ → returns to orbit.
- From chat composer mic → enters voice with sessionId; ✕ returns to chat.
- Toggle System → Reduce Motion in OS settings; voice mode no longer morphs but still works (CSS in theme.css disables transitions).

- [ ] **Step 3: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/App.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(web): wire VoiceScreen with layoutId morph + reduce-motion fallback"
```

---

### Task 4.6: Voice controls polish (keyboard fallback, mute mic, end-call)

This is mostly already in place from Task 4.4. Final polish: ensure mute halts amplitude updates, end-call cleans up, keyboard fallback preserves session. Add a smoke test for `formatTime`.

**Files:**
- Modify: `web/src/voice/VoiceScreen.tsx`
- Test: `web/src/voice/VoiceScreen.test.tsx`

- [ ] **Step 1: Add behavioral test**

```tsx
// web/src/voice/VoiceScreen.test.tsx
import { describe, it, expect } from "vitest";
// expose formatTime by exporting it from VoiceScreen.tsx
import { formatTime } from "./VoiceScreen.js";

describe("formatTime", () => {
  it("formats 0", () => expect(formatTime(0)).toBe("0:00"));
  it("formats 65", () => expect(formatTime(65)).toBe("1:05"));
  it("formats 600", () => expect(formatTime(600)).toBe("10:00"));
});
```

- [ ] **Step 2: Run to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- VoiceScreen.test`
Expected: FAIL — `formatTime` not exported.

- [ ] **Step 3: Adjust VoiceScreen.tsx**

Change the `formatTime` declaration to be exported:

```ts
export function formatTime(s: number): string { ... }
```

Pass `muted` into `useMicAmplitude` so amplitude is forced 0 when muted:

```ts
const amp = useMicAmplitude(v.state === "listening" && !muted);
```

- [ ] **Step 4: Run to verify passes**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- VoiceScreen.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/voice/VoiceScreen.tsx web/src/voice/VoiceScreen.test.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(voice): mute halts amplitude + export formatTime + tests"
```

---

## Phase 5 — Memory + Rules + Pairing (~1 day)

### Task 5.1: `<MemoryScreen />`

Replaces `MemoryEditor.tsx`. Sections: Personality (collapsible) / Preferences / Observations (filterable category pills + hover-expand rows) / Projects (collapsible).

**Files:**
- Create: `web/src/memory/MemoryScreen.tsx`
- Delete: `web/src/memory/MemoryEditor.tsx`
- Modify: `web/src/memory/MemoryEditor.smoke.test.tsx` → rename to `MemoryScreen.smoke.test.tsx`
- Modify: `web/src/App.tsx` (swap import)

- [ ] **Step 1: Rename + write smoke test**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle mv web/src/memory/MemoryEditor.smoke.test.tsx web/src/memory/MemoryScreen.smoke.test.tsx
```

Replace the content of the renamed test:

```ts
// web/src/memory/MemoryScreen.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { MemoryScreen } from "./MemoryScreen.js";
describe("MemoryScreen module", () => {
  it("exports a function component", () => {
    expect(typeof MemoryScreen).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- MemoryScreen`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `MemoryScreen.tsx`**

```tsx
// web/src/memory/MemoryScreen.tsx
import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { fetchMemory, type MemoryView, patchMemoryLine, postMemoryLine } from "../api.js";

const CATEGORIES = ["all", "context", "people", "setup", "skills", "schedule", "preferences"] as const;

export function MemoryScreen({ onClose }: { onClose: () => void }) {
  const [m, setM] = useState<MemoryView | null>(null);
  const [cat, setCat] = useState<typeof CATEGORIES[number]>("all");
  const [showPersonality, setShowPersonality] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [newPref, setNewPref] = useState("");

  useEffect(() => { fetchMemory().then(setM).catch(() => {}); }, []);

  if (!m) return <div className="p-4 text-white/50">Loading memory…</div>;

  const obs = cat === "all" ? m.observations.lines : m.observations.lines.filter((l) => l.category === cat);

  return (
    <div className="relative h-full overflow-y-auto bg-black text-white">
      <header className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-white/8 bg-black/80 backdrop-blur-sm">
        <button onClick={onClose} aria-label="back" className="text-white/70"><ChevronLeft size={20} /></button>
        <div className="text-sm font-medium">Memory</div>
      </header>

      {/* Personality (collapsible) */}
      <Section
        title="Personality"
        right={<span className="text-white/40 text-[10px]">{showPersonality ? "hide" : "show"}</span>}
        onClickHeader={() => setShowPersonality((v) => !v)}
      >
        {showPersonality && (
          <pre className="text-xs text-white/75 whitespace-pre-wrap leading-relaxed">{m.personality}</pre>
        )}
      </Section>

      {/* Preferences */}
      <Section title="Preferences">
        <div className="space-y-1.5">
          {m.preferences.lines.map((line) => (
            <PreferenceRow key={line} line={line} onEdit={async (newLine) => {
              const r = await patchMemoryLine({ file: "preferences", oldLine: line, newLine });
              if (r.ok) setM(await fetchMemory());
            }} onDelete={async () => {
              await patchMemoryLine({ file: "preferences", oldLine: line }); // newLine omitted = delete
              setM(await fetchMemory());
            }} />
          ))}
          <div className="flex gap-2 pt-2">
            <input
              value={newPref}
              onChange={(e) => setNewPref(e.target.value)}
              placeholder="Add a preference…"
              className="flex-1 bg-transparent border border-white/10 rounded-md px-2 py-1.5 text-xs text-white placeholder:text-white/40"
            />
            <button
              onClick={async () => {
                if (!newPref.trim()) return;
                await postMemoryLine(newPref.trim());
                setNewPref("");
                setM(await fetchMemory());
              }}
              className="px-3 text-xs rounded-md bg-white text-black"
            >
              Add
            </button>
          </div>
        </div>
      </Section>

      {/* Observations */}
      <Section title={`Observations (${m.observations.lines.length})`}>
        <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1 mb-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={
                "shrink-0 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider " +
                (c === cat ? "border border-white/50 bg-white/10 text-white" : "border border-white/12 text-white/60")
              }
            >
              {c}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          {obs.map((l) => (
            <ObservationRow key={l.raw} line={l} />
          ))}
        </div>
      </Section>

      {/* Projects */}
      <Section
        title="Projects"
        right={<span className="text-white/40 text-[10px]">{showProjects ? "hide" : "show"}</span>}
        onClickHeader={() => setShowProjects((v) => !v)}
      >
        {showProjects && (
          <ul className="text-xs text-white/75 space-y-1">
            {m.projects.map((p) => <li key={p.slug}>{p.slug}</li>)}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, right, onClickHeader, children }: {
  title: string;
  right?: React.ReactNode;
  onClickHeader?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-white/5 px-4 py-3">
      <header
        className={"flex items-center justify-between text-white/85 text-xs uppercase tracking-wider mb-2 " + (onClickHeader ? "cursor-pointer" : "")}
        onClick={onClickHeader}
      >
        <span>{title}</span>
        {right}
      </header>
      {children}
    </section>
  );
}

function PreferenceRow({ line, onEdit, onDelete }: { line: string; onEdit: (s: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line);
  if (editing) {
    return (
      <div className="flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          className="flex-1 bg-transparent border border-white/15 rounded-md px-2 py-1.5 text-xs"/>
        <button onClick={() => { setEditing(false); onEdit(draft); }} className="text-xs px-2 rounded bg-white text-black">save</button>
        <button onClick={() => setEditing(false)} className="text-xs px-2 rounded text-white/60">cancel</button>
      </div>
    );
  }
  return (
    <div className="group relative border border-white/8 rounded-md px-3 py-2 text-xs text-white/85 hover:border-white/20">
      {line}
      <span className="absolute right-2 top-1.5 hidden group-hover:flex gap-2 text-[10px] text-white/60">
        <button onClick={() => setEditing(true)}>edit</button>
        <button onClick={onDelete} className="text-red-400">delete</button>
      </span>
    </div>
  );
}

function ObservationRow({ line }: { line: MemoryView["observations"]["lines"][number] }) {
  const color =
    line.confidence === "high" ? "var(--conf-high)" :
    line.confidence === "medium" ? "var(--conf-med)" :
                                   "var(--conf-low)";
  return (
    <div className="flex items-start gap-2 border border-white/8 rounded-md px-3 py-2 text-xs text-white/85 hover:border-white/20">
      <span className="inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: color }} />
      <div className="flex-1">{line.text}</div>
      <span className="text-[10px] text-white/35 shrink-0">{line.date}</span>
    </div>
  );
}
```

- [ ] **Step 4: Update App.tsx**

In `web/src/App.tsx`, replace `import { MemoryEditor }` with `import { MemoryScreen }` and the `<MemoryEditor onClose={...} />` JSX with `<MemoryScreen onClose={...} />`.

- [ ] **Step 5: Delete obsolete `MemoryEditor.tsx`**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle rm web/src/memory/MemoryEditor.tsx
```

- [ ] **Step 6: Run smoke test**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- MemoryScreen`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/memory/MemoryScreen.tsx web/src/memory/MemoryScreen.smoke.test.tsx web/src/App.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(memory): MemoryScreen (Personality / Preferences / Observations / Projects)"
```

---

### Task 5.2: `<RulesScreen />` consolidated

One screen with Reasoning + Pinned chips + Devices + Provider sections. Replaces existing RulesScreen.

**Files:**
- Modify: `web/src/rules/RulesScreen.tsx` (rewrite)
- Test: `web/src/rules/RulesScreen.smoke.test.tsx`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/rules/RulesScreen.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { RulesScreen } from "./RulesScreen.js";
describe("RulesScreen module", () => {
  it("exports a function component", () => {
    expect(typeof RulesScreen).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- RulesScreen`
Expected: FAIL or stale.

- [ ] **Step 3: Implement (replace existing file)**

```tsx
// web/src/rules/RulesScreen.tsx
import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import {
  fetchReasoning, putReasoning, type ReasoningPref,
  fetchPinnedChips, createPinnedChip, deletePinnedChip, type ChipOverrideRow,
} from "../api.js";
import { getToken } from "../auth/tokens.js";

interface Device { id: string; label: string; created_at: number; revoked_at: number | null; }

export function RulesScreen({ onClose }: { onClose: () => void }) {
  const [reasoning, setReasoning] = useState<ReasoningPref | null>(null);
  const [chips, setChips] = useState<ChipOverrideRow[]>([]);
  const [newChipLabel, setNewChipLabel] = useState("");
  const [newChipPrompt, setNewChipPrompt] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [provider, setProvider] = useState<{ name: string; model: string; reachable: boolean } | null>(null);

  useEffect(() => {
    fetchReasoning().then(setReasoning).catch(() => {});
    fetchPinnedChips().then(setChips).catch(() => {});
    fetchDevices().then(setDevices).catch(() => {});
    fetchProvider().then(setProvider).catch(() => {});
  }, []);

  async function setLevel(level: "fast" | "thorough") {
    if (!reasoning) return;
    setReasoning({ ...reasoning, level });
    await putReasoning(level);
  }

  async function addChip() {
    if (!newChipLabel.trim() || !newChipPrompt.trim()) return;
    const c = await createPinnedChip({ label: newChipLabel.trim(), prompt: newChipPrompt.trim() });
    setChips((prev) => [...prev, c]);
    setNewChipLabel("");
    setNewChipPrompt("");
  }

  async function removeChip(id: string) {
    await deletePinnedChip(id);
    setChips((prev) => prev.filter((c) => c.id !== id));
  }

  async function revokeDevice(id: string) {
    const token = getToken() ?? "";
    await fetch(`/api/auth/devices/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    setDevices((prev) => prev.filter((d) => d.id !== id));
  }

  return (
    <div className="relative h-full overflow-y-auto bg-black text-white">
      <header className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-white/8 bg-black/80 backdrop-blur-sm">
        <button onClick={onClose} aria-label="back" className="text-white/70"><ChevronLeft size={20} /></button>
        <div className="text-sm font-medium">Rules</div>
      </header>

      {/* Reasoning */}
      <section className="border-b border-white/5 px-4 py-3">
        <div className="text-xs uppercase tracking-wider text-white/85 mb-2">Reasoning</div>
        {reasoning ? (
          <div className="grid grid-cols-2 gap-2">
            {(["fast", "thorough"] as const).map((lvl) => {
              const active = reasoning.level === lvl;
              return (
                <button
                  key={lvl}
                  onClick={() => setLevel(lvl)}
                  className={
                    "rounded-md py-3 text-xs " +
                    (active ? "border border-white/50 bg-white/8 text-white" : "border border-white/12 text-white/70")
                  }
                >
                  <div className="font-medium">{lvl === "fast" ? "Fast" : "Thorough"}</div>
                  <div className="text-[10px] text-white/50 mt-1">{lvl === "fast" ? "minimal · low" : "low · medium"}</div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-white/40">Loading…</div>
        )}
      </section>

      {/* Pinned chips */}
      <section className="border-b border-white/5 px-4 py-3">
        <div className="text-xs uppercase tracking-wider text-white/85 mb-2">Pinned chips</div>
        <div className="space-y-1.5">
          {chips.map((c) => (
            <div key={c.id} className="border border-white/8 rounded-md px-3 py-2 text-xs flex items-center gap-3">
              <span className="font-medium">{c.label}</span>
              <span className="text-white/55 truncate flex-1">{c.prompt}</span>
              <button className="text-red-400" onClick={() => removeChip(c.id)}>delete</button>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 pt-2">
          <input value={newChipLabel} onChange={(e) => setNewChipLabel(e.target.value)} placeholder="Label"
            className="bg-transparent border border-white/10 rounded-md px-2 py-1.5 text-xs"/>
          <input value={newChipPrompt} onChange={(e) => setNewChipPrompt(e.target.value)} placeholder="Prompt"
            className="col-span-2 bg-transparent border border-white/10 rounded-md px-2 py-1.5 text-xs"/>
        </div>
        <button onClick={addChip} className="mt-2 px-3 py-1 text-xs rounded-md bg-white text-black">Add chip</button>
      </section>

      {/* Devices */}
      <section className="border-b border-white/5 px-4 py-3">
        <div className="text-xs uppercase tracking-wider text-white/85 mb-2">Devices</div>
        <div className="space-y-1.5">
          {devices.map((d) => (
            <div key={d.id} className="border border-white/8 rounded-md px-3 py-2 text-xs flex items-center gap-3">
              <span className="font-medium">{d.label}</span>
              <span className="text-white/45">{new Date(d.created_at).toLocaleDateString()}</span>
              <button className="ml-auto text-red-400" onClick={() => revokeDevice(d.id)}>revoke</button>
            </div>
          ))}
        </div>
      </section>

      {/* Provider */}
      <section className="px-4 py-3">
        <div className="text-xs uppercase tracking-wider text-white/85 mb-2">Provider</div>
        {provider ? (
          <div className="flex items-center gap-2 text-xs">
            <span className={"inline-block w-1.5 h-1.5 rounded-full " + (provider.reachable ? "bg-emerald-400" : "bg-red-500")} />
            <span>{provider.name} · {provider.model}</span>
          </div>
        ) : (
          <div className="text-xs text-white/40">Loading…</div>
        )}
      </section>
    </div>
  );
}

async function fetchDevices(): Promise<Device[]> {
  const token = getToken() ?? "";
  const r = await fetch("/api/auth/devices", { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return [];
  const j = await r.json() as { devices: Device[] };
  return j.devices;
}

async function fetchProvider(): Promise<{ name: string; model: string; reachable: boolean } | null> {
  const token = getToken() ?? "";
  const r = await fetch("/api/health/provider", { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return r.json();
}
```

> **Note:** if `/api/auth/devices` and `/api/health/provider` don't exist on the server yet, the implementer should either (a) add them as small read-only endpoints in this same task, or (b) gracefully render the section as "Not available" and add a follow-up TODO. The fetch helpers above already handle a non-OK response by leaving the section empty.

- [ ] **Step 4: Run smoke test**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- RulesScreen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/rules/RulesScreen.tsx web/src/rules/RulesScreen.smoke.test.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(rules): consolidated RulesScreen (Reasoning / Chips / Devices / Provider)"
```

---

### Task 5.3: `<PairingScreen />` reskin

Paths bg + 6-char input + Alert error.

**Files:**
- Modify: `web/src/auth/PairingScreen.tsx`
- Test: `web/src/auth/PairingScreen.smoke.test.tsx`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/auth/PairingScreen.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { PairingScreen } from "./PairingScreen.js";
describe("PairingScreen module", () => {
  it("exports a function component", () => {
    expect(typeof PairingScreen).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify fails or stale**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- PairingScreen`
Expected: PASS-but-old (the old PairingScreen still exports). We'll replace.

- [ ] **Step 3: Replace `PairingScreen.tsx`**

```tsx
// web/src/auth/PairingScreen.tsx
import { useState } from "react";
import { motion } from "motion/react";
import { api } from "../api.js";
import { setToken } from "./tokens.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { PathsBackground } from "../components/ava/PathsBackground.js";

const LEN = 6;

export function PairingScreen({ onPaired }: { onPaired: () => void }) {
  const [chars, setChars] = useState<string[]>(Array(LEN).fill(""));
  const [label, setLabel] = useState(navigator.userAgent.includes("iPhone") ? "iPhone" : "Phone");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setChar(i: number, ch: string) {
    const next = chars.slice();
    next[i] = ch.slice(-1).toUpperCase();
    setChars(next);
    if (ch && i < LEN - 1) (document.getElementById(`pair-${i + 1}`) as HTMLInputElement | null)?.focus();
  }

  async function submit() {
    const code = chars.join("");
    if (code.length !== LEN) { setError("invalid or expired code"); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.pair(code, label.trim() || "Phone");
      setToken(r.token);
      onPaired();
    } catch {
      setError("invalid or expired code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      <PathsBackground opacity={1} />
      <div className="relative z-10 flex flex-col items-center justify-center h-full p-6 text-white">
        <h1 className="text-5xl font-bold tracking-tighter mb-2 bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
          Ava
        </h1>
        <p className="text-white/55 text-xs mb-8 text-center max-w-[260px]">
          Pair this device. Get the code from the Ava systray icon on your PC.
        </p>
        <motion.div
          initial={error ? { x: -10 } : false}
          animate={error ? { x: [0, -10, 10, -8, 0] } : false}
          transition={{ duration: 0.25 }}
          className="flex gap-2 mb-4"
        >
          {chars.map((c, i) => (
            <input
              key={i}
              id={`pair-${i}`}
              value={c}
              onChange={(e) => setChar(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !c && i > 0) {
                  (document.getElementById(`pair-${i - 1}`) as HTMLInputElement | null)?.focus();
                }
              }}
              maxLength={1}
              inputMode="text"
              autoCapitalize="characters"
              className={
                "w-10 h-12 text-center text-lg font-mono bg-black/60 backdrop-blur-md rounded-md " +
                (error ? "border border-red-500" : "border border-white/15")
              }
            />
          ))}
        </motion.div>
        {error && (
          <div className="w-72 mb-3">
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
          </div>
        )}
        <input
          value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="Device label"
          className="w-72 bg-black/60 backdrop-blur-md border border-white/12 rounded-md px-3 py-2 text-sm mb-3 placeholder:text-white/35"
        />
        <button
          onClick={submit} disabled={busy}
          className="w-72 bg-white text-black rounded-md py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {busy ? "Pairing…" : "Submit"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run smoke test**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- PairingScreen`
Expected: PASS.

- [ ] **Step 5: Manual smoke**

Wipe localStorage, reload, see splash-styled paths bg + 6-char input. Wrong code shakes + shows red Alert. Right code → orbit.

- [ ] **Step 6: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/auth/PairingScreen.tsx web/src/auth/PairingScreen.smoke.test.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(auth): reskin PairingScreen (paths bg + 6-char input + Alert error + shake)"
```

---

## Phase 6 — Polish + splash (~half day)

### Task 6.1: `<Splash />` cold-boot animation

Letter-by-letter wordmark, paths bg full opacity, scales down + translates to orbit center over 600ms.

**Files:**
- Create: `web/src/splash/Splash.tsx`
- Test: `web/src/splash/Splash.smoke.test.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Write smoke test**

```ts
// web/src/splash/Splash.smoke.test.tsx
import { describe, it, expect } from "vitest";
import { Splash } from "./Splash.js";
describe("Splash module", () => {
  it("exports a function component", () => {
    expect(typeof Splash).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- Splash`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// web/src/splash/Splash.tsx
import { useEffect } from "react";
import { motion } from "motion/react";
import { PathsBackground } from "../components/ava/PathsBackground.js";

export function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, 1500);
    return () => clearTimeout(id);
  }, [onDone]);

  const letters = "Ava".split("");

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      <motion.div
        initial={{ opacity: 1 }}
        animate={{ opacity: 0.15 }}
        transition={{ delay: 1.2, duration: 0.4 }}
        className="absolute inset-0"
      >
        <PathsBackground opacity={1} />
      </motion.div>
      <motion.div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        initial={{ scale: 1 }}
        animate={{ scale: 0.4 }}
        transition={{ delay: 1.2, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1 className="text-7xl font-bold tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
          {letters.map((ch, i) => (
            <motion.span
              key={i}
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: i * 0.03, type: "spring", stiffness: 150, damping: 25 }}
              className="inline-block"
            >
              {ch}
            </motion.span>
          ))}
        </h1>
      </motion.div>
    </div>
  );
}
```

- [ ] **Step 4: Wire splash into App.tsx**

Add a `splash` view as the initial state for cold-boot when paired:

```tsx
type View = { name: "splash" } | { name: "orbit" } | ...;

const [view, setView] = useState<View>({ name: "splash" });
```

Add the splash case before the orbit case:

```tsx
{view.name === "splash" && (
  <motion.div key="splash" className="absolute inset-0" exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
    <Splash onDone={() => setView({ name: "orbit" })} />
  </motion.div>
)}
```

Add the import: `import { Splash } from "./splash/Splash.js";`

Skip splash when not paired (PairingScreen still shown directly).

- [ ] **Step 5: Run smoke test**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test -- Splash`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/splash/ web/src/App.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(web): cold-boot Splash (letter-by-letter wordmark → orbit zoom-out)"
```

---

### Task 6.2: `prefers-reduced-motion` audit pass

`theme.css` already collapses transitions globally for reduce-motion, but the auto-rotation interval still runs and the listening pulse still scales with amplitude. Audit and gate these explicitly.

**Files:**
- Create: `web/src/lib/useReducedMotion.ts`
- Modify: `web/src/orbit/useOrbitRotation.ts`
- Modify: `web/src/components/ava/Pulse.tsx`
- Test: `web/src/lib/useReducedMotion.smoke.test.ts`

- [ ] **Step 1: Add hook**

```ts
// web/src/lib/useReducedMotion.ts
import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}
```

```ts
// web/src/lib/useReducedMotion.smoke.test.ts
import { describe, it, expect } from "vitest";
import { useReducedMotion } from "./useReducedMotion.js";
describe("useReducedMotion module", () => {
  it("exports a function", () => {
    expect(typeof useReducedMotion).toBe("function");
  });
});
```

- [ ] **Step 2: Gate auto-rotation**

In `useOrbitRotation.ts`, change `useEffect` to also skip when reduce-motion is active:

```ts
import { useReducedMotion } from "../lib/useReducedMotion.js";

export function useOrbitRotation({ paused }: { paused: boolean }) {
  const [angle, setAngle] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (paused || reduced) return;
    const id = setInterval(() => setAngle((a) => (a + DEG_PER_TICK) % 360), TICK_MS);
    return () => clearInterval(id);
  }, [paused, reduced]);
  return { angle };
}
```

- [ ] **Step 3: Gate Pulse animations**

In `Pulse.tsx`, when `useReducedMotion()` returns true, return a static circle per state with no motion props:

```tsx
import { useReducedMotion } from "../../lib/useReducedMotion.js";

export function Pulse({ state, size, amplitude = 0, layoutId, className }: PulseProps) {
  const reduced = useReducedMotion();
  // ...existing code...
  if (reduced) {
    const bg =
      state === "responding" ? COLORS_RESPONDING :
      state === "thinking"   ? "rgba(255,255,255,0.15)" :
                                COLORS_IDLE;
    return <div className={className} style={{ width: size, height: size, borderRadius: "50%", backgroundImage: bg }} />;
  }
  // ...existing animated branches...
}
```

- [ ] **Step 4: Run all web tests**

Run: `cd C:/ai/chemiapebi/yovlisshemdzle/web && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle add web/src/lib/ web/src/orbit/useOrbitRotation.ts web/src/components/ava/Pulse.tsx && git -C C:/ai/chemiapebi/yovlisshemdzle commit -m "feat(web): respect prefers-reduced-motion in orbit rotation + Pulse"
```

---

### Task 6.3: Real-device gesture tuning + final smoke pass

Manual checklist on a real iPhone PWA.

- [ ] **Step 1: Build for production**

Run:
```bash
cd C:/ai/chemiapebi/yovlisshemdzle/web && npm run build
cd C:/ai/chemiapebi/yovlisshemdzle/server && npm run build && npm start
```

- [ ] **Step 2: Real-device walkthrough**

Open the PWA on an iPhone (LAN IP : server port). Walk through:

- Cold-boot splash plays, transitions to orbit (no flash, no layout shift).
- Orbit auto-rotates outer ring; pause-on-touch verified.
- Long-press chat node: ring goes white → red over 500ms; ✕ confirms; undo toast appears 5s.
- Tap `+` → chat opens; type message; thinking pulse + caption appear; tool-call chip expands; final message renders.
- Composer mic → voice morphs in (or fades, on reduced motion); listening rings; speak; rec ends; thinking; responding plays audio; ✕ exits.
- Voice exit → orbit shows the new chat node (verifying transcript persistence).
- Memory → Personality collapses; Preferences add/edit/delete; Observations category pills filter.
- Rules → Reasoning toggle; pinned chip add/delete; device revoke (will sign you out — only test on a spare device).
- Reduce-motion ON → no rotations, no morphs, but every screen still navigates correctly.

- [ ] **Step 3: Capture issues, fix in spot commits**

For each issue caught, write a 1-line commit. No batch commits.

- [ ] **Step 4: Final commit (release notes)**

```bash
git -C C:/ai/chemiapebi/yovlisshemdzle commit --allow-empty -m "chore(web): finish Ava frontend remodel — orbital + voice + delete shipped"
```

---

## Acceptance criteria (mirrors spec §12)

- Every screen renders correctly on a real iPhone PWA at 390×844.
- `<Pulse />` morphs between orbit center, composer mic, and voice fullscreen with no flicker (or graceful fallback).
- Long-press → delete flow works on iOS Safari without text selection issues.
- Voice round-trip persists both user + Ava transcripts; new session shows on orbit.
- `prefers-reduced-motion: reduce` disables non-opacity transitions and auto-rotation.
- No light-theme styles; all colors come through `theme.css` tokens.
- Existing tests still pass; new smoke tests cover Pulse, OrbitNode, useLongPress, useOrbitRotation.

## Execution Handoff

After saving this plan, the user can choose how to execute it:

**1. Subagent-Driven (recommended)** — One fresh subagent per task, two-stage review (spec compliance, then code quality) between tasks. Uses skill `superpowers:subagent-driven-development`.

**2. Inline Execution** — Batch execution with checkpoints. Uses skill `superpowers:executing-plans`.

Each phase produces a working, shippable app — phases can be merged independently.
