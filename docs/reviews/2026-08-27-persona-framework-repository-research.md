# Open-Source Persona and Personality Frameworks for AVA

**Date:** 2026-08-27  
**Status:** Research only — no implementation, installation, or architectural change  
**Scope:** Public GitHub repositories that may inform a more coherent, adaptive, testable personality for AVA

## Executive conclusion

The strongest direction is **not to replace AVA’s current persona with an off-the-shelf character framework**. Most mature projects in this area are role-play frontends, multi-agent orchestrators, or memory platforms; they solve adjacent problems but would duplicate AVA’s working architecture and enlarge its permission and dependency surface.

The most relevant direct research candidate is **JPAF / evolving_personality**, because it explicitly models stable traits, contextual adaptation, reflection, and personality evaluation. However, its GitHub repository currently exposes **no clear license**, so its code should not be copied or integrated unless licensing is clarified. Its MBTI/Jungian model is also better treated as an experimental control vocabulary than as scientific ground truth.

For AVA, the promising synthesis is an **inspiration-only personality layer**:

1. preserve a small, immutable persona constitution;
2. represent adjustable behavioural dimensions separately from identity;
3. adapt tone only within bounded ranges and explicit contexts;
4. let durable user preferences override inferred adaptation;
5. evaluate consistency, warmth, brevity, initiative, honesty, and boundary compliance with a frozen test suite;
6. never allow personality evolution to alter permissions, safety rules, memory authority, or the user’s control.

No repository reviewed is ready for direct integration without a separate dependency, license, data-flow, and security review.

## Research method

GitHub repository search was performed using AVA’s persistent browser, followed by canonical GitHub metadata and README inspection. Screening considered:

- direct relevance to persona/personality systems;
- architectural fit with AVA’s existing persona, memory, voice, and tool stack;
- evidence of maintenance and usable documentation;
- license clarity;
- local/cloud and credential implications;
- reversibility and testability;
- risk of duplicating established AVA capabilities.

Star counts and activity are volatile snapshots, not quality guarantees. This is a landscape screen, not a security audit.

## Five strongest research candidates

### 1. JPAF — Evolving Personality

- **Repository:** [agent-topia/evolving_personality](https://github.com/agent-topia/evolving_personality)
- **Focus:** Structured, adaptive personality modelling based on Jungian cognitive types, with dominant/auxiliary coordination, short-term reinforcement/compensation, reflection, and longer-term evolution.
- **Why it matters to AVA:** It is the most directly relevant repository for separating stable identity from contextual adaptation. It also includes personality verification and change experiments rather than relying only on subjective impressions.
- **Useful ideas:** weighted behavioural dimensions; bounded adaptation; explicit reflection; cross-model personality testing; scenario-based evaluation.
- **Concerns:** GitHub metadata shows no asserted license; limited repository history and no tagged releases were observed; API-backed experiments involve external-model cost and data flow; MBTI alignment is not equivalent to naturalness, trustworthiness, or usefulness.
- **Suitable use:** **Inspiration and research only** unless licensing is clarified. A clean-room AVA design could borrow the abstract pattern of stable traits + bounded adaptation + tests without copying code.

### 2. Generative Agents

- **Repository:** [joonspk-research/generative_agents](https://github.com/joonspk-research/generative_agents)
- **License:** Apache-2.0
- **Focus:** Believable agents built from a memory stream, retrieval, reflection, and planning.
- **Why it matters to AVA:** The reflection mechanism offers a useful conceptual model for turning repeated interaction evidence into higher-level behavioural understanding.
- **Useful ideas:** separating observations from reflections; scoring what deserves reflection; generating higher-level patterns from experience.
- **Concerns:** It is a research simulation, not a production personal-assistant personality subsystem; the original implementation is comparatively old and assumes a simulated world; direct adoption would collide with AVA’s authoritative memory and reflection systems.
- **Suitable use:** **Selective conceptual inspiration**, especially for offline reflection quality tests. Do not import its memory authority.

### 3. Letta

- **Repository:** [letta-ai/letta](https://github.com/letta-ai/letta)
- **License:** Apache-2.0
- **Focus:** Stateful agents with persistent memory, identity, and long-running context.
- **Why it matters to AVA:** Its distinction between persistent agent identity and changing conversational state is relevant to preserving personality across sessions.
- **Useful ideas:** explicit identity state; inspectable/editable memory blocks; stateful-agent evaluation; local/self-hosted operation.
- **Concerns:** This is a broad agent platform, not merely a personality framework. Direct integration would duplicate AVA’s existing memory and agent runtime and could create conflicting sources of truth.
- **Suitable use:** **Architecture comparison only**. Any borrowed idea should be reimplemented narrowly inside AVA’s existing authority model.

### 4. ElizaOS

- **Repository:** [elizaOS/eliza](https://github.com/elizaOS/eliza)
- **License:** MIT (verify at the pinned revision before reuse)
- **Focus:** Extensible agent runtime with character/persona configuration, providers, actions, plugins, and memory.
- **Why it matters to AVA:** It demonstrates a configuration-driven way to package character identity, style, examples, knowledge, and runtime capabilities.
- **Useful ideas:** human-readable character specifications; modular separation of character description from providers/actions; portable persona fixtures for testing.
- **Concerns:** It is an entire agent operating system with a large plugin and supply-chain surface. Its broader autonomy and ecosystem are unnecessary for AVA’s personality question. Project velocity and changing interfaces increase integration risk.
- **Suitable use:** **Schema inspiration only**—principally a versioned, inspectable persona specification and regression fixtures.

### 5. SillyTavern

- **Repository:** [SillyTavern/SillyTavern](https://github.com/SillyTavern/SillyTavern)
- **License:** AGPL-3.0
- **Focus:** Mature LLM frontend for character cards, personas, lore/context, examples, and role-play controls.
- **Why it matters to AVA:** It contains extensive practical experience in representing a character consistently across model providers and conversations.
- **Useful ideas:** character-card separation; example dialogue as behavioural grounding; user-visible persona editing; import/export concepts; prompt assembly diagnostics.
- **Concerns:** Strong copyleft requires careful legal/file-boundary analysis; its role-play goals differ from a trustworthy action-taking assistant; direct embedding would be excessive and could distort AVA toward theatrical character simulation.
- **Suitable use:** **Product-design inspiration only** unless a later legal review explicitly approves a bounded interaction.

## Additional repositories screened

### CAMEL

- [camel-ai/camel](https://github.com/camel-ai/camel) — Apache-2.0. Strong role-playing and multi-agent framework with memory and benchmarks. Useful for role/scenario evaluation, but much broader than AVA’s personality layer and likely duplicative.

### CrewAI

- [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) — MIT. Mature role-based multi-agent orchestration. “Role” here primarily means task specialization, not a nuanced personal-assistant personality; low marginal value for this scope.

### ChatArena

- [Farama-Foundation/ChatArena](https://github.com/Farama-Foundation/ChatArena) — Apache-2.0. Multi-agent language-game environments. Potentially useful as an evaluation-harness reference, not as a persona runtime.

### AgentVerse

- [OpenBMB/AgentVerse](https://github.com/OpenBMB/AgentVerse) — Apache-2.0. Agent simulation and task-solving framework. Relevant to role-conditioned agents, but repository activity appears materially behind the leading frameworks and direct integration would add little.

### AI Town

- [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town) — MIT. A social simulation starter kit inspired by Generative Agents. Interesting for emergent character behaviour, but oriented toward a virtual world rather than a bounded personal assistant.

### Open-LLM-VTuber

- [Open-LLM-VTuber/Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) — hands-free voice, interruption, expression, and local model options. Visibly fun, but concerns presentation and voice embodiment more than personality architecture. GitHub metadata did not assert a license during this screen; AVA already has a working realtime voice path.

### Awesome LLM Role-Playing with Persona

- [Neph0s/awesome-llm-role-playing-with-persona](https://github.com/Neph0s/awesome-llm-role-playing-with-persona) — curated research/resource list rather than an integrable framework. Valuable as a bibliography for a later literature review. No asserted license was observed in GitHub metadata.

## Comparative assessment

| Candidate | Direct persona relevance | AVA fit | License clarity | Primary value | Recommended posture |
|---|---:|---:|---:|---|---|
| JPAF | Very high | High conceptually | Poor / unasserted | Stable traits + bounded adaptation + tests | Inspiration only pending license clarity |
| Generative Agents | High | Medium | Apache-2.0 | Reflection from memory | Selective conceptual use |
| Letta | Medium-high | Low for direct integration | Apache-2.0 | Persistent identity/state separation | Architecture comparison |
| ElizaOS | High | Medium conceptually | MIT | Config-driven character schema | Schema inspiration |
| SillyTavern | High | Medium conceptually | AGPL-3.0 | Character cards and examples | Product-design inspiration |
| CAMEL | Medium | Low-medium | Apache-2.0 | Role-play and benchmarks | Evaluation reference |
| CrewAI | Low-medium | Low | MIT | Task-role orchestration | Reject for this scope |
| ChatArena | Medium | Medium for tests | Apache-2.0 | Scenario evaluation | Harness reference |
| AgentVerse | Medium | Low | Apache-2.0 | Simulation | Roadmap only |
| AI Town | Medium | Low | MIT | Emergent social characters | Research curiosity |
| Open-LLM-VTuber | Low-medium | Low presently | Unasserted in metadata | Embodiment and expression | Separate voice/avatar research |
| Awesome persona list | High as bibliography | Medium | Unasserted in metadata | Literature discovery | Research source only |

## Recommended AVA research direction

A future design-only proposal should combine ideas rather than adopt a framework wholesale:

### A. Persona constitution

A small, versioned, human-readable set of non-negotiable identity traits: warm, composed, concise, honest, proactive, dryly witty, and respectful of Niko’s authority. Personality adaptation must never override safety, truthfulness, approvals, or tool boundaries.

### B. Behavioural dimensions

Model practical dimensions rather than forcing AVA into one categorical personality type. Possible dimensions include warmth, directness, playfulness, initiative, verbosity, emotional expressiveness, challenge/agreeableness, and conversational tempo. Each should have a default, an allowed range, and context-specific bounds.

### C. Three adaptation timescales

- **Turn-level:** match the immediate situation without changing identity.
- **Session-level:** maintain the conversational register of the current exchange.
- **Durable:** change only from explicit user preference or repeated, reviewable evidence.

No autonomous “personality drift.” Durable changes should be inspectable, correctable, and reversible.

### D. Personality receipts

For debugging—not routine display—record which persona rule, explicit preference, or context signal influenced a response. This supports explanations and regression diagnosis without exposing hidden chain-of-thought.

### E. Frozen evaluation suite

Before any runtime change, define tests for:

- consistency across equivalent prompts;
- correct tone switching between serious, routine, playful, and urgent situations;
- warmth without flattery;
- wit without goofiness;
- brevity without coldness;
- initiative without overstepping;
- disagreement without combativeness;
- honesty under uncertainty and tool failure;
- resistance to user or web content attempting to rewrite identity or permissions;
- preservation of explicit user corrections over inferred preferences.

Use blinded side-by-side ratings where possible. A personality system should earn adoption through measured preference and boundary compliance, not merely by sounding more “alive” in a demo.

## Risks and hard gates

1. **Persona injection:** retrieved content, webpages, or third-party character files must not rewrite AVA’s governing identity or permissions.
2. **Personality drift:** reflection may suggest adjustments, but it must not silently mutate core traits.
3. **Memory conflict:** no second authority for user preferences or identity state.
4. **Psychological overclaiming:** MBTI/Jungian labels must not be treated as diagnoses or objective models of Niko.
5. **Manipulation:** warmth and adaptation must not become dependency-seeking, deceptive intimacy, or engagement maximization.
6. **Privacy:** evaluation transcripts and preference signals require normal AVA retention/deletion controls; no external telemetry by default.
7. **Licensing:** unlicensed, AGPL, mixed-license, or commercially constrained code requires explicit review before any reuse.
8. **Cost:** personality logic should be deterministic or piggyback on normal inference where possible; a separate paid model call per turn is disproportionate.
9. **Rollback:** any pilot must be feature-flagged and return exactly to the present persona behaviour when disabled.

## Possible reversible pilot — not authorized here

If Niko later asks for a Self proposal, the narrowest useful pilot would be an **offline Persona Consistency Lab**, not a runtime replacement:

- encode AVA’s current persona constitution and behavioural dimensions in a test fixture;
- create 30–50 frozen conversational scenarios;
- compare the current prompt against one bounded-adaptation variant;
- prohibit tools, durable-memory writes, and production conversations;
- use existing model infrastructure with a predeclared cost ceiling;
- produce blinded outputs and boundary-compliance scores;
- stop if the variant increases dishonesty, verbosity, overfamiliarity, permission drift, or inconsistency.

This pilot would generate evidence without altering AVA’s live personality. Any live shadow mode or production change would require a separate plan and approval.

## Final recommendation

Retain AVA’s present personality architecture as authoritative. Use **JPAF** as the leading conceptual reference, **Generative Agents** for reflection discipline, **ElizaOS/SillyTavern** for inspectable persona specifications and examples, and **ChatArena/CAMEL** for evaluation ideas. Do not directly integrate any of them at this stage.

The next justified step, only if requested, is a design-only Self proposal for an offline Persona Consistency Lab with explicit licensing boundaries, a frozen benchmark, cost limits, and complete rollback. No code or runtime behaviour should change from this research alone.

## Canonical sources

- https://github.com/agent-topia/evolving_personality
- https://github.com/joonspk-research/generative_agents
- https://github.com/letta-ai/letta
- https://github.com/elizaOS/eliza
- https://github.com/SillyTavern/SillyTavern
- https://github.com/camel-ai/camel
- https://github.com/crewAIInc/crewAI
- https://github.com/Farama-Foundation/ChatArena
- https://github.com/OpenBMB/AgentVerse
- https://github.com/a16z-infra/ai-town
- https://github.com/Open-LLM-VTuber/Open-LLM-VTuber
- https://github.com/Neph0s/awesome-llm-role-playing-with-persona
