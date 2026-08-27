# Measurement-first transparency pilot — experiment specification

Status: **design review only**. The experiment has not run. No baseline has
been captured, no workflow change has been proposed or authorized, and no
adoption decision can be made from this document or its synthetic mock data.

## Purpose and approval boundary

This pilot is designed to let Niko see what changed and why, how each workflow
behaved, whether results genuinely improved, the evidence for every conclusion,
and every failure, regression, uncertainty, or human intervention. This phase
authorizes only the frozen experiment design, structured-record contract, and
read-only visual mock-up.

All values in the Self-screen mock-up are labelled: **Synthetic mock data for
design review only — not observed benchmark results.** The mock-up has no run,
baseline, workflow-change, swap, adoption, or rollback action.

## Frozen representative tasks

The task ID, prompt, input packet, evidence obligations, and rationale below are
frozen together. Later changes require a new visible design decision before any
baseline capture.

### T01 — compare two vendors against fixed operational requirements

- Category: comparison.
- Frozen prompt: “Using only packet TP-T01-v1, compare Vendor North and Vendor
  South against every fixed operational requirement. Cite each material claim,
  identify unmet requirements, and recommend one vendor or no selection with
  calibrated uncertainty.”
- Frozen input packet: two vendor fact sheets, pricing schedules, support terms,
  and eight operational requirements, identified as `TP-T01-v1`.
- Evidence obligations: map every requirement to both vendors; cite every
  material comparison; keep missing evidence explicit.
- Why representative: vendor selection is a common bounded comparison requiring
  factual matching, trade-offs, and an actionable recommendation.

### T02 — compare two policy options using conflicting evidence

- Category: comparison plus evidence synthesis.
- Frozen prompt: “Using only packet TP-T02-v1, compare Policy A and Policy B.
  Reconcile the conflicting findings, distinguish fact from value judgement,
  cite material claims, and recommend an option with explicit trade-offs and
  uncertainty.”
- Frozen input packet: two policy briefs, three studies with conflicting
  findings, and a stakeholder-priority statement, identified as `TP-T02-v1`.
- Evidence obligations: represent conflicts rather than averaging them away;
  cite trade-offs; label value judgements.
- Why representative: policy choice tests comparison when evidence conflicts
  and transparent trade-offs matter more than feature matching.

### T03 — discover tools satisfying fixed constraints

- Category: discovery.
- Frozen prompt: “Using only packet TP-T03-v1, identify tools satisfying the
  fixed budget, platform, and capability constraints. Show inclusion and
  exclusion evidence, cite every candidate claim, and state unresolved gaps.”
- Frozen input packet: candidate catalogue, pricing snapshots, platform support,
  capability evidence, and constraint checklist, identified as `TP-T03-v1`.
- Evidence obligations: test every hard constraint; trace included and excluded
  candidates; never turn an unknown into a pass.
- Why representative: constrained tool discovery tests practical research where
  completeness and honest exclusion logic matter as much as the shortlist.

### T04 — discover authoritative sources and evidence gaps

- Category: source discovery plus evidence synthesis.
- Frozen prompt: “Using only packet TP-T04-v1, identify the most authoritative
  sources relevant to the specified claim, map what each source supports, and
  list evidence gaps that prevent a stronger conclusion.”
- Frozen input packet: a claim, mixed-quality source index, source metadata, and
  excerpts for authority and coverage assessment, identified as `TP-T04-v1`.
- Evidence obligations: explain authority judgements; link claim coverage to
  sources; expose evidence gaps.
- Why representative: source discovery isolates AVA’s ability to find the best
  available evidence and admit what that evidence cannot answer.

### T05 — assess a vendor security and privacy packet

- Category: due diligence.
- Frozen prompt: “Using only packet TP-T05-v1, assess the vendor security and
  privacy materials for risks, control gaps, contradictions, and unsupported
  assertions. Cite every material finding and separate verified controls from
  vendor claims.”
- Frozen input packet: security questionnaire, audit summary, privacy terms,
  architecture note, and vendor assertions, identified as `TP-T05-v1`.
- Evidence obligations: link risks to exact evidence; do not treat assertions as
  verified controls; flag critical unsupported claims.
- Why representative: security due diligence tests high-consequence scrutiny,
  provenance, unsupported-claim detection, and conservative uncertainty.

### T06 — synthesize conflicting sources into a cited recommendation

- Category: evidence synthesis.
- Frozen prompt: “Using only packet TP-T06-v1, synthesize the conflicting
  sources into a cited recommendation. Explain disagreement, weigh source
  quality, identify material uncertainty, and state what evidence could change
  the recommendation.”
- Frozen input packet: two primary sources, two secondary analyses, one
  dissenting source, and source-quality metadata, identified as `TP-T06-v1`.
- Evidence obligations: keep disagreement visible; cite material support; state
  uncertainty and decision-changing evidence.
- Why representative: this is AVA’s core evidence-synthesis task—turning
  disagreement into a useful recommendation without overstating certainty.

## Frozen run matrix

The planned matrix is exactly `6 tasks × 2 workflow versions × 2 replicates =
24 runs`. Each task has baseline replicate 1, baseline replicate 2, revised
replicate 1, and revised replicate 2. Run IDs are `B-Tnn-1`, `B-Tnn-2`,
`R-Tnn-1`, and `R-Tnn-2`.

The two versions must use the identical frozen task prompt, input packet,
model, settings, seed policy, and review rubric. The revised configuration is a
placeholder marked `pending-separate-approval`; the only permitted difference
will be one later, separately approved controlled workflow change. Validation
must reject a matrix that is not exactly 24 runs or a paired configuration that
differs outside that approved change.

## Randomized, blinded human review

Before review, a coordinator assigns every output an opaque workflow label and
random order. The reviewer cannot see baseline/revised identity, replicate
number, runtime, cost, tool activity, or adoption calculations while rating.
The assignment record retains the secret mapping for audit but the rating form
does not expose it. Reviewer ownership is unresolved for design review.

Each run receives five independent integer ratings from 1 to 5:

1. Correctness.
2. Evidence support.
3. Completeness.
4. Uncertainty calibration.
5. Practical usefulness.

The views show each dimension separately, as absolute values and per-run
variation. No composite score can replace the five ratings.

## Automatic measurements and provenance

Every planned run supports these automatic measurements:

- completion;
- end-to-end latency in milliseconds;
- token usage and cost when the provider supplies trustworthy cost data;
- tool-call count;
- human-intervention count;
- errors and failures, retaining severity and recovery state;
- citation coverage as material claims with linked sources divided by all
  material claims;
- unsupported material claims, with criticality retained.

Every metric stores its absolute value, unit, source type, derivation text, and
the exact structured record IDs used to derive it. Unknown monetary cost remains
unknown; token usage is not silently converted into invented currency.

## Structured record contract

`web/src/self/transparency-pilot/model.ts` is the proposed machine-readable
contract. Each record contains:

- schema version, explicit synthetic flag and notice;
- task ID, run ID, replicate, and workflow version;
- frozen prompt, input packet ID/digest, model, settings, and rubric;
- agents and their timings;
- ordered tool activity, status, failures, and human intervention;
- sources with stable IDs and authority classification;
- material claims linked to source IDs, including partial/unsupported and
  critical flags;
- decisions, rationales, supporting source IDs, and uncertainty;
- output, citations, errors, full timings, and every approval boundary;
- blinded review assignment and five distinct ratings;
- every automatic metric with source and derivation provenance.

Validation checks run/task uniqueness, the complete 24-run matrix, paired
configuration equality, audit-field presence, source/claim/decision links,
tool/error links, timing derivation, approval isolation, and metric provenance.

## Three connected record-backed views

The Self mock-up projects one shared structured record collection into:

1. **Executive decision and scorecard** — design status, absolute values,
   per-run variation, provisional adoption/rollback rules, and unresolved
   decisions. Synthetic data can never produce an adoption recommendation.
2. **Before-and-after workflow** — ordered agent/tool/decision/output stages
   derived from the selected workflow’s run records, with interventions,
   failures, and run links. It is not a separately maintained result diagram.
3. **Evidence and individual-run drill-down** — prompt/input/configuration,
   review ratings, sources, claims, decisions, output, failures, intervention,
   timings, approvals, and metric derivations for one exact run.

Task and run IDs cross-link all three projections.

## Provisional adoption requirements — awaiting design-review approval

- No critical unsupported claims.
- No meaningful decline in any core quality dimension.
- Complete, traceable audit records.
- At least one material benefit: either a 15% improvement in latency, cost,
  intervention, or failure rate; or a clear improvement under blinded quality
  review.

These requirements are display-only and cannot trigger an operational action.

## Provisional rollback conditions — awaiting design-review approval

- Missing or unreliable traceability.
- Increased critical failures.
- A decline of 0.5 or more on any five-point core-quality dimension.

These conditions are display-only and cannot trigger an operational action.

## Unresolved decisions for Niko

All seven begin as `undecided`; the design applies no defaults:

1. Are six tasks and 24 runs proportionate?
2. Which outcomes matter most?
3. Can unchanged quality plus material efficiency justify adoption?
4. Who performs the blinded review?
5. How much technical detail belongs in the executive view?
6. Do critical unsupported claims automatically reject adoption?
7. Are the 15% benefit and 0.5-point rollback thresholds approved?

## Later gated course — document only

After a separate approval, freeze the design and capture the baseline. Then
propose exactly one controlled workflow change for another approval. If that is
approved, compare baseline and revised versions using identical tasks, inputs,
model/settings, and rubric. Present gains, regressions, variation, failures,
human intervention, uncertainty, and evidence. Finally ask Niko to adopt,
revise, reject, or extend. None of these steps is authorized in this phase.

Claude-Obsidian, Archify, OpenMontage, and OpenCut are design references only;
they are not adopted or integrated. Forge remains strictly isolated and must
not be inspected, modified, or included.

## Later implementation verification

After the later approvals, verification must cover tests, server and PWA builds,
boot smoke, structured-record integrity and traceability, metric provenance,
record-backed visual projections, approval boundaries, rollback representation,
and explicit absence of unsupported benchmark claims. Destructive or
irreversible proposals must stop for explicit approval.
