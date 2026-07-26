# Forge frontend review and remodel

Date: 2026-07-25  
Reviewed target: `C:\Users\nikug\ai\forge`  
Inspiration reviewed: `C:\Users\nikug\ai\AVA\Stuff\forge`  
Staged source: `C:\Users\nikug\ai\AVA\forge-remodel-work`

## Outcome

This pass turns the Forge cockpit from a queue-oriented dashboard into an
inspectable control floor while preserving Forge's existing black-glass,
restrained-red visual contract.

The remodel is deliberately data-backed:

- The Board's execution mesh reads the real Board, Change Detail, and Roster
  projections.
- Sequential and parallel relationships come from recorded station groups.
- Stage state, run IDs, spend, token counts, handoffs, and events come from the
  journal projections.
- `READY` means a dispatcher implementation and enforceable roster definition
  both exist.
- `NOT BUILT` remains explicit. The UI does not turn a documented station into
  a working one.
- Cost visuals describe observed spend and tokens among visible changes. They
  do not invent quotas, forecasts, or budgets.

The live Forge repository was already dirty and is outside AVA's writable
workspace. The reviewed changes are therefore staged and shipped through a
hash-guarded installer rather than copied blindly over Claude's work.

## Product and architecture review

### What was already strong

- The React shell is small and understandable.
- Hash routing makes deep links and browser Back reliable without adding a
  router dependency.
- The control plane is journal-backed, which gives the UI a much better source
  of truth than transient client state.
- Board, detail, roster, spend, and live status already have clean API
  boundaries.
- The existing design contract correctly distinguishes blocked, failed,
  waiting, and attention states.
- The lane model already describes both ordered stages and parallel station
  groups.

### What limited the previous frontend

- The Board showed queues but not the actual factory route through Forge.
- The Agents page listed definitions without making lane sequence or
  parallelism immediately visible.
- The Cost page exposed totals but did not show which changes generated them.
- Several documented stations looked more operational than they really were.
- Manual advance could offer `test-engineer` even though no dispatcher
  implementation existed.
- At intermediate widths, the topology and inspector competed for too little
  horizontal space.
- A visually hidden mobile drawer remained keyboard-focusable.
- A roster failure could strand the execution mesh without a retry.

### Capability reality found during review

Forge models 11 stations. Five currently have registered implementations:

1. specification
2. repository-analyst
3. architect
4. backend-engineer
5. frontend-engineer

Six are present in the pipeline model but are not yet dispatchable:

1. test-engineer
2. code-reviewer
3. safety-reviewer
4. ui-verifier
5. documentation-writer
6. integrator

That distinction is now visible throughout the redesigned topology and is also
enforced by the manual-advance backend path.

## Inspiration assessment

The three Agent Mesh references are useful as structural inspiration,
especially the third version's combination of graph, inspector, and event
stream. Their source was not reused because the references:

- contain fixed demonstration data rather than Forge projections;
- assume a fixed 1680×1000 canvas;
- use unsupported or missing assets;
- do not meet the cockpit's responsive and accessibility requirements; and
- do not match Forge's existing visual language.

The remodel adopts the useful idea—a topology connected to an inspector and
evidence—while implementing it with Forge's real API data and design system.

## Implemented changes

### Board: Control floor

- Added a real-data `Factory floor` execution mesh.
- Active changes are selectable without leaving the Board.
- The route shows sequential steps and parallel stations.
- Every station shows an explicit state word, latest run context, tokens, and
  spend.
- The inspector exposes purpose, upstream/downstream groups, write authority,
  requirements, handoff, and recent journal events.
- The mesh connection heading reports `LIVE`, `CONNECTING`, or
  `OFFLINE · LAST PROJECTION`; it does not pulse while offline.
- Detail and roster failures are surfaced with a shared retry path.
- The full trace remains one action away.

### Agents: Workforce topology

- Added Express, Standard, and Deep lane topology selectors.
- Parallel groups and sequential stages are visually distinct.
- Selecting a station updates a detailed authority and placement inspector.
- Added full-registry search and readiness filters.
- `READY` and `NOT BUILT` describe availability, not current execution state.

### Cost: Observed distribution

- Added accessible spend and token share meters.
- Preserved exact values and the existing per-change ledger.
- Added an explicit “Observed, not estimated” boundary.
- Avoided invented budgets, forecasts, or quota language.

### Shell and responsive behavior

- Strengthened the control-plane identity and drafting-grid treatment.
- Improved panel hierarchy, spacing, typography, and information density.
- Stacks the station inspector below the graph at 1160px and below.
- Keeps deliberate graph scrolling inside a labelled, keyboard-focusable
  region.
- Makes the closed mobile drawer inert and hidden from assistive technology.
- Preserves reduced-motion behavior.

### Dispatch truthfulness

The control plane now filters manual-advance candidates through the registered
station implementations. An unavailable station:

- is never returned as runnable;
- makes `mayStart` return `false`;
- is reported as a truthful stuck reason; and
- appears disabled as `NOT BUILT` in the detail UI.

This closes the observed case where Forge claimed `test-engineer` could be
started even though no implementation existed.

## Files in the install payload

Modified:

- `ui/DESIGN.md`
- `ui/src/Agents.tsx`
- `ui/src/Board.tsx`
- `ui/src/ChangeDetail.tsx`
- `ui/src/Cost.tsx`
- `ui/src/Sidebar.tsx`
- `ui/src/board.css`
- `ui/src/detail.css`
- `ui/src/pages.css`
- `ui/src/shell.css`
- `ui/src/theme.css`
- `control-plane/src/pipeline/advance.ts`
- `control-plane/src/pipeline/advance.test.ts`

Added:

- `ui/src/CommandDeck.tsx`
- `ui/src/command-deck.css`
- `ui/src/StationTopology.tsx`
- `ui/src/station-topology.css`

## Verification completed

| Check | Result |
| --- | --- |
| Staged UI TypeScript check | Passed |
| Staged control-plane TypeScript check | Passed |
| In-memory journal/manual-advance scenario | Passed |
| Undefined `test-engineer` start attempt | Correctly rejected |
| Real-data Board render | Passed |
| Change selector changes projected route | Passed |
| Station selection changes inspector | Passed |
| Open full trace and return to Board | Passed |
| Selected change survives trace return and reload | Passed |
| Agent lane switching | Passed |
| Registry search and readiness filter | Passed |
| Cost meters and observed-data disclosure | Passed |
| Roster failure disclosure and retry | Passed |
| Mobile drawer open, Escape, and hidden focus exclusion | Passed |
| Viewport overflow at 1440, 1024, and 390 CSS px | 0 px |
| Console/page/HTTP faults in normal browser route pass | 0 |
| Installer clean success path | Passed |
| Installer idempotent preflight | Passed |
| Forced build-failure source rollback | Passed |
| Forced build-failure `ui/dist` rollback | Passed |

The managed execution sandbox blocks Vite/Vitest's `esbuild` child process with
Windows `EPERM` before project assertions run. For that reason, the production
installer runs the repository's real typecheck, full control-plane test suite,
and Vite build on the target machine. Any failure rolls back the exact source
files written and restores the previous `ui/dist`.

## Applying the remodel

Run:

```text
C:\Users\nikug\ai\AVA\APPLY-FORGE-FRONTEND-REMODEL.cmd
```

The installer:

1. Verifies every staged payload hash.
2. Verifies every current Forge source hash before making any change.
3. Refuses the entire install if Claude or another process changed a reviewed
   file.
4. Backs up every target source plus `ui/dist`.
5. Copies files atomically and verifies their installed hashes.
6. Runs TypeScript checks, the full control-plane test suite, and the production
   UI build.
7. Restores sources and `ui/dist` automatically if verification fails.

Backups are retained under:

```text
C:\Users\nikug\ai\AVA\forge-backups\frontend-remodel-<timestamp>
```

The production build is visible from disk immediately. Restart the Forge
control-plane process after any active task finishes so the backend dispatch
guard is loaded; the installer intentionally does not terminate an in-flight
Forge task.

## Highest-value next improvements

1. Implement the six missing stations. The remodel now makes their absence
   impossible to overlook; completing those implementations provides more
   value than adding decorative dashboard features.
2. Add a dedicated historical run-comparison view: same station across two
   attempts, with duration, cost, corrections, and evidence deltas.
3. Add journal-backed reliability summaries per station once enough completed
   runs exist. Avoid percentages until sample sizes are displayed.
4. Add an explicit “why this lane” panel on the Board, using the recorded
   architect decision and escalation evidence already present in Change Detail.
5. Add end-to-end accessibility checks to CI, including keyboard traversal,
   reduced motion, contrast, and narrow viewport coverage.
