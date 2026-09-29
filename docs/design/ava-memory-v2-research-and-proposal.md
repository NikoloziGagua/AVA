# AVA memory v2: research and proposal (Claude, 2026-09-29, revised after self-review)

Status: Niko answered the four decisions on 29 Sep (all yes, see the end). ChatGPT reviewed the proposal the
same day; its five points are adopted below as requirements with acceptance tests. Phase 1's quick win is
built and measured (not yet live). The phase 0 evaluation set is built and waiting for Niko to confirm the
answers. Numbers about AVA come from read-only queries on the live database and from AVA's source code. With
Niko's approval, the evaluation set was built by reading his conversations; it stays local (gitignored)
because it contains personal facts, and none of that text is in this document. Numbers about other systems
are labelled with who reported them, because most published figures are self-reported and several are
disputed.

## Self-review: what the first draft got wrong

The first draft (same day) was checked against the code, the data and the original sources. Corrections:

1. **Wrong: "AVA has no notion of dates or 'this replaced that'."** The always-loaded observations already
   carry a date, a confidence (low/medium/high), a category and a `superseded <date>` marker, and the memory
   index has `memory_index_supersede`, `_conflict`, `_correct` and `_pin` tools. The real problem is that
   none of this is used: 0 observations have ever been superseded, and the governance log has no events.
2. **Wrong: "nothing captures facts about Niko."** The conversational model can call `memory_remember`. It
   did so rarely: 9 structured observations in two months (4 setup, 3 people, 1 preference, 1 context).
3. **Misleading: "only 8 of 6,583 messages became memory."** Entries summarize ranges of messages, so that
   ratio compares different things. Accurate: 18 personal entries (ideas, research, remembered) were ever
   created; 8 are active and 10 were forgotten. 1,488 sessions include test bursts.
4. **Misleading: "recall fails 83% of the time."** A "no match" is correct when a turn needs no memory. The
   real finding is worse and more specific: of the 165 items memory injected since 1 Sep, **147 were AVA's
   own development log (`improvement`), 11 were build artifacts and 7 were Niko's ideas**. On voice it is
   92 of 94. Memory is almost entirely injecting AVA's changelog.
5. **Misattributed: "remote embedding adds 50 to 300 ms."** I credited Supermemory, whose page contains no
   measurements. AVA's own code documents measured values instead: the OpenAI embedding call took
   **200 to 950 ms (1.8 s cold)** on real voice turns, and a keyword-only lookup took about 75 ms and chose
   the same memories 12 times out of 13 (`server/src/routes/voice-memory-budget.ts`).
6. **Missed: memory costs every voice reply time.** In hybrid voice, `response.create` is only sent after
   the lookup finishes or its budget expires: up to **400 ms** per turn, **1.5 s** for "remember…" turns. In
   76% of voice lookups that used memory, the embedding missed its 250 ms budget and fell back to keywords.
   That wait mostly fetched the changelog.
7. **Overclaim: "a deterministic supersession rule."** The cited paper works on structured facts. Personal
   facts need a model to recognise that "top priority" and "main project" are the same relation. Corrected
   design below: the model proposes, a deterministic reconciler applies.
8. **Design flaw: extracting after every turn.** Costly and it competes with voice. Corrected to batched
   extraction on idle or a size threshold, as Mastra and ChatGPT do.
9. **Missed: Notes and Calendar are already Niko's authoritative memory** for ideas and schedule. Memory
   should link to them, not copy them.
10. **Missed: backfill order matters.** Old conversations must be processed oldest-first, or "replaced by"
    links come out backwards.

Verified against originals: Mem0's pipeline (paper), OpenAI's prompt-caching rules (OpenAI docs), the
LoCoMo audit numbers (independent `dial481/locomo-audit`), LongMemEval's design findings (ICLR 2025 paper).
OpenAI's "Dreaming" post blocks automated fetching; its figures come from consistent reporting of that post.

## 1. What AVA's memory is today, measured

- **Always in the prompt:** `personality.md` 8.2 KB (AVA's persona, not facts about Niko); `preferences.md`
  1.4 KB; `observations.md` 1.7 KB with 9 dated observations from 25 Jul to 25 Sep; `MEMORY.md` 43 bytes
  (one bullet). The code allows far more (soft caps: 500, 1,000 and 2,000 tokens), so space is not the
  limit. Nothing fills it.
- **Search index (`memory_index`):** 663 entries: 621 development-log records, 24 artifacts, 18 personal
  (8 active). Search embeds the query with OpenAI over the network, then scores every entry in JavaScript
  (cheap at this size) and combines it with a keyword score. At most 2 entries are injected.
- **Writing:** automatic capture only for research requests and developing ideas (regex signals plus a
  side-model editor). Everything else depends on the conversational model calling a memory tool.
- **Time:** the format supports dates and supersession; the process never uses it. Niko saw the result: an
  old priority was recalled as current.
- **Worth keeping:** source verification, governance tools, per-turn receipts, the observation format, the
  voice latency budget, the observability trail.

**Found while building the evaluation set (29 Sep).** Each of these is a real case from the last month:

1. **One fact in two stores; forget removed only one copy.** On 28 Sep Niko said the old top-two
   priority was no longer relevant, and AVA replied that it had forgotten it. `memory_forget` removed the
   copy in `observations.md`. The indexed copy of the same fact is still active, and AVA had quoted that
   copy a minute earlier. AVA reported the change as done.
2. **A joke became a fact, with the wrong date.** A joking remark about a friend, said in another language and
   ending "remember it", is stored as a durable observation about that friend. It is dated 25 Sep, the day
   the session started, but was said on 27 Sep.
3. **A narrowed rule stayed at full strength.** During a study session AVA saved the preference "studying
   should not proceed without preserving those notes". Fourteen minutes later Niko narrowed it ("you don't
   need to save everything, just what I tell you"). Only the first version is in `preferences.md`.
4. **The wrong store answered.** "Do you know what I'm interested in?" was answered from the update log.
   On the same day, "what did we put in the ideas" was answered twice with older ideas instead of the two
   saved hours earlier in the same conversation.
5. **A learned procedure fires on unrelated requests.** A test playbook learned on 29 Aug ("search Google
   for a test phrase, then open a contact's Instagram chat") ran 29 times between 1 and 28 Sep, triggered
   by requests like "what functionalities do you have", "so", and a request about the ideas folder. This is
   why AVA kept opening that chat unasked. The trigger matcher counts repeated common words ("and",
   "for"), so any long input scores above its 0.6 threshold. Voice action objectives are long because they
   include earlier results. The misfire also feeds itself: once the playbook runs, its own result report
   lands in the next objective. This is procedural memory rather than the fact memory designed here, but
   the rule is the same: recall only on evidence that the current request asks for it.
6. **"Done" without a read-back.** Eight weekly classes Niko dictated on 27 Sep never reached the calendar.
   For one of them, AVA said it had added it. This is not memory, but finding 1 has the same root cause:
   AVA says a write is done without reading it back.

## 2. What the research says

**Leaderboards can't choose for us.** Zep claimed 84% on LoCoMo, Mem0 re-ran it at 58.44%, Zep answered
75.14% ([Zep](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/),
[thread](https://github.com/getzep/zep-papers/issues/5)). An independent audit found 6.4% of LoCoMo's answer
key wrong (99 of 1,540) and its judge accepting 62.8% of deliberately wrong answers
([audit summary](https://penfieldlabs.substack.com/p/proposal-a-new-benchmark-for-long)); the common harness
also drops the abstention questions ([dev.to](https://dev.to/gde03/the-ai-memory-benchmark-everyone-quotes-forbids-saying-i-dont-know-o1n)).
Letta showed a plain filesystem agent at 74% on LoCoMo, above Mem0's reported graph variant
([Letta](https://www.letta.com/blog/benchmarking-ai-agent-memory/)). The academic LongMemEval found
commercial assistants and long-context models drop about 30% on sustained memory, and that three design
choices help: store at fact granularity, index chunks under the facts extracted from them, and expand
time-related queries into date ranges ([LongMemEval, ICLR 2025](https://arxiv.org/abs/2410.10813)).
Lesson: design from principles, then measure on Niko's own conversations.

**The fast systems pre-compute; they don't search on every turn.**
- OpenAI "Dreaming" (June 2026): a background process reads past conversations and rewrites what ChatGPT
  remembers, keeps a readable summary the user can edit, and updates time-sensitive facts ("going to
  Singapore in July" becomes "went in July 2026"). OpenAI reports internal factual recall from 41.5% (2024)
  to 82.8%, preference adherence 71.3%, time-sensitive accuracy 75.1%
  ([report](https://letsdatascience.com/news/openai-upgrades-chatgpt-memory-architecture-for-fresher-pers-b26b51d5),
  [OpenAI post](https://openai.com/index/chatgpt-memory-dreaming/)). Critics say the summary is incomplete
  and deletion unclear ([XDA](https://www.xda-developers.com/chatgpt-quietly-rewrites-its-memories-of-you-not-sure-i-like-it/)).
- The earlier ChatGPT design, per third-party reverse engineering: about 33 facts plus about 15 conversation
  summaries in every prompt, no per-turn vector search ([llmrefs](https://llmrefs.com/blog/reverse-engineering-chatgpt-memory)).
- Mastra observational memory: a background Observer turns messages into dated, priority-tagged notes, a
  Reflector condenses them, and there is no retrieval at all. The prompt stays append-only so caching works.
  Self-reported 84 to 95% on LongMemEval depending on the model ([Mastra](https://mastra.ai/research/observational-memory)).
- Letta: a background "sleep-time" agent edits memory blocks so the conversational agent stays fast
  ([Letta](https://www.letta.com/blog/sleep-time-compute/)).
- AVA's own data points the same way: the conversational model almost never writes memory (9 times in two
  months). Writing in the background works; writing in the conversation does not.

**How the good pipelines update memory.** Mem0 (paper): extraction sees a running summary plus the last 10
messages; for each new fact it retrieves the 10 most similar memories and a model picks ADD, UPDATE, DELETE or
NOOP. Search p50 0.148 s; p95 end-to-end 1.44 s versus 17.1 s for full context, about 7K versus 26K tokens
([Mem0 paper](https://arxiv.org/abs/2504.19413)). Mem0 deletes contradicted facts; Zep keeps them with a
validity interval ([Zep](https://arxiv.org/abs/2501.13956)). For a personal assistant, keeping history is
right: "until September: notes and calendar were the priority."

**Stale facts need an explicit rule.** One paper reports plain retrieval serves superseded values 15 to 40%
of the time and a supersession ledger brings that near 0% ([MemStrata](https://arxiv.org/abs/2606.26511),
own benchmarks, structured facts, 7B model; indicative only).

**One layer does not last.** A longitudinal study: a small curated map reaches 96% recall at 3 weeks but 72%
at 9 weeks as old facts are evicted; a provenance-typed graph reaches 90%; layered is best
([tenure crossover](https://arxiv.org/abs/2607.21962), authors' own library).

**Ranking without heavy machinery.** The classic Generative Agents score combines recency (exponential
decay), importance (rated at write time) and relevance ([Park et al. 2023](https://arxiv.org/abs/2304.03442)).
Typed records let one query suffice (Memanto reports 13 types, under 90 ms; [Memanto](https://arxiv.org/abs/2604.22085)).

**Voice.** Real-time conversation allows 100 to 200 ms for memory. Approaches: a background thinker
prefetches likely topics into a cache ([VoiceAgentRAG](https://arxiv.org/abs/2603.02206)); VoiceMem reports
134 ms ([VoiceMem](https://arxiv.org/abs/2608.26005)). AVA currently waits up to 400 ms and uses a
200 to 950 ms network embedding.

**Commitments are their own problem.** The hard part is acting on a stored intention at the right time,
not recalling it ([PM-Bench](https://arxiv.org/abs/2607.12385)). AVA already has reminders and the
initiative engine for that.

**Memory can be poisoned.** Injected text can become persistent memory; defences are write gating,
provenance and audit logs ([MINJA](https://arxiv.org/abs/2503.03704),
[defences](https://blog.getzep.com/defending-agent-memory-poisoning/)). AVA reads web pages, WhatsApp and
Instagram.

**Caching rules (OpenAI docs).** GPT-5.6 and later: caching from 1,024 tokens, cached reads at 0.1x, the
cache lives 30 minutes after last use, and tools, instructions, reasoning effort and message prefix must all
match ([OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching)). A stable Brief is cheap;
one that changes each turn is not. Across hours of silence the cache expires anyway.

## 3. Requirements adopted from ChatGPT's review (29 Sep)

Niko had ChatGPT review this proposal. Its five points are right and are now requirements. Each has an
acceptance test in the evaluation set (item ids in brackets).

1. **Say who said it, and what kind of statement it was.** Niko stating a fact, Niko deciding, AVA
   suggesting, Niko pasting someone else's text, a joke, and another voice in the room are different
   things. Only the first two become "you said" records. A suggestion becomes "we discussed". Pasted text
   is kept only as a linked source, never as Niko's words or as an instruction. Background speech and jokes
   become nothing, or go on the "check this" list. Tests: reviewing a proposal is not deciding it (Y08,
   DECIDED items); a deadline passing is not completion (Y07); pasted text is not Niko's (PASTED items,
   Y06); background audio stores nothing (NOISE items, Y09); a joke is not a fact (S01).
2. **Explicit requests apply immediately.** "Remember", "correct that", "cancel" and "forget" do not wait for
   the background writer. They are written at once, confirmed only after every affected store has
   changed, and pushed into a live voice session without reconnecting. Tests: Y04, Y05.
3. **Correct, stop carrying and forget are three different operations.** *Correct* makes a new version and
   keeps the old one as dated history. *Stop carrying* removes an item from the Brief but leaves it
   searchable as history ("was the priority until 27 Sep"). *Forget* erases the content and leaves a
   tombstone (a fingerprint, no text). Extraction and backfill check tombstones, so a forgotten fact can't
   come back from old conversations. The 10 entries Niko has already forgotten get tombstones before any
   backfill runs. Tests: Y01, Y02, Y03, U03, C02 ("forget about that for now" means drop the topic, not
   erase memory).
4. **Deep recall is basic.** "What did we decide about X last month?" must work from the start, with the
   source messages opened. It moves from phase 4 to phase 2. "At most 3 records" is the default for
   automatic recall only. List questions ("what are all my ideas", "what's due this week") use typed
   queries with no such limit. Tests: MULTI and TIME items.
5. **Judge correctness, not retrieval.** The evaluation scores answers against answers Niko confirmed. It
   must separate "What did I decide about AVA?" (personal memory) from "What changed in AVA's code?" (the
   update log). Tests: ROUTE items, M02.

ChatGPT also recommended building one complete loop before any breadth: capture, use, show the source,
correct, and verify that the correction sticks. Phase 2 below is that loop.

## 4. Proposal (revised)

**Principle: nothing slow on the hot path.** Memory is written in the background and read from a small
pre-built Brief. Search runs only when a question clearly needs the past.

**Layer 0, the Brief (about 1,000 to 1,500 tokens, always loaded).** Replaces the MEMORY.md, preferences and
observations slots, which already exist and already allow this size. Sections:
- who Niko is;
- current focus, with "as of" dates, linking to Notes projects instead of copying them;
- open commitments and what is coming up, linking to Calendar and reminders;
- decisions with their reasons;
- preferences and rules for AVA;
- people who matter.
Every line carries a date, a source and "you said" or "AVA inferred". Past priorities appear as history.
It is regenerated when something important changes, at most a few times a day, so the cache holds. For
voice it goes into the realtime session instructions at connect time.

**Layer 1, the Recent digest (about 400 to 600 tokens).** Dated, priority-tagged notes on the last few days,
condensed as they age. This also compresses the current conversation's older turns, which is what makes one
endless conversation workable. It connects to Niko's "only one chat?" question: with this layer, "New topic"
can become optional.

**Layer 2, the Archive (existing SQLite tables, extended).** Typed records: fact, decision (with reason),
commitment (with due time), preference, person, project state, event. Each has `valid_from`, `valid_to`,
`superseded_by`, source message ids, confidence and status. Search:
- SQLite FTS5 with BM25 first (built into AVA's SQLite, no new dependency);
- ranked with recency and importance, with time filters for "last month" questions;
- at most 3 records;
- never blocking a voice reply.
Local embeddings are added only if measurements show a need. The development log gets its own namespace and
is searched only for "what changed in AVA" questions.

**Writing: batched, in the background.**
- **When:** after a conversation goes quiet for a few minutes, or when enough new text has built up.
- **How:** the cheap side model proposes records and, for each one, is shown the most similar existing
  records so it can reuse them, update one, mark one "replaced by" or skip. Relative dates ("next Friday")
  are resolved to absolute Dublin dates from the message time.
- **Reconciler:** a deterministic reconciler applies the result with version guards. It never deletes
  content except through *forget*, and it refuses to recreate anything that matches a tombstone.
- **Uncertain items:** anything uncertain goes into a "check this" list.
- **What counts as Niko's words:** only Niko's own accepted turns create "you said" records, and each
  record carries its kind of statement (requirement 1). Web pages, other people's messages, pasted text,
  tool output and notes are sources to link, never memory writes. Voice can pick up other voices in the
  room, so a surprising claim heard by voice is asked about before it becomes a high-impact fact.
- **Dates come from the message**, not the session: a session can span days (finding 2).
- **Explicit requests skip the queue** (requirement 2). One write path serves every store, so a correction
  or forget can't leave a stale copy behind (finding 1).

**Dreaming (idle time).** Merge duplicates, apply decay, rebuild the Brief, and flag stale items ("last
mentioned six weeks ago; still true?"). Commitments become follow-ups through the existing reminder and
initiative seams.

**Deep recall (from phase 2).** "What did we decide about X last month?" searches the archive and opens the
source messages. On voice this is a delegated action, so the fast path never waits.

**Visibility.** A "What AVA knows about you" screen with a "just learned" feed and confirm, correct, stop
carrying and forget, built on the governance tools that exist but have never been used. A mockup comes
first, for Niko to approve.

## 5. What I am confident about, and what I am not

**Confident (measured on AVA or consistent across independent sources):**
- memory currently injects AVA's changelog, not Niko;
- the conversational model rarely writes memory;
- voice waits for a slow lookup;
- background writing plus a pre-built Brief is the direction every strong system has taken.

**Not confident:**
- Whether FTS5 without embeddings is enough. It is likely at Niko's scale (thousands of records), since
  keyword-only picked the same memories 12 of 13 times, but that sample is small.
- How well a cheap model extracts facts from messy voice transcripts. Unknown until tested on real
  conversations.
- The right Brief size. It is 4 to 16% of today's fixed request size (25 KB chat, 102 KB actions) and must
  be measured for latency.
- Every external performance number. Each is the reporting team's claim.

**Not reviewed in depth:** research graph systems (A-MEM, HippoRAG, MemoryOS, Memory-R1). Their advantages
appear on multi-hop questions over large corpora; for one person's memory at this scale, the cost of graph
upkeep is unlikely to pay off. That is my judgement, not a measurement.

## 6. Phases, each with a measurement gate

0. **Evaluation set: built, waiting for Niko's answers.** 64 questions from 58 real conversations (25 Jul to
   29 Sep) in 13 categories: facts, preferences, updates, time, multi-conversation, discussed vs decided,
   pasted text, routing, conflicts, "I don't know", background audio, sensitive topics, and one-off vs
   standing instructions. Every expected answer cites message ids. Ten scripted tests with made-up data cover
   correct, forget, stop carrying, voice immediacy, "done" only after the write, pasted instructions,
   deadlines, proposals, background audio and speed. Niko has 14 items that need his judgement, not
   just a check. Six items record a failure already seen in real use. Next: a harness that asks each question through
   AVA's real memory path and scores it, giving a baseline before anything changes.
1. **Quick win: built and measured (commit `2d31f10`), live after the next restart.** The development log
   stays out of automatic retrieval unless the question is about what changed in AVA, and the network
   embedding runs only when a turn points at the past. On 300 real turns replayed against a copy of the
   database: 7% of turns would call the embedding; keyword lookup takes 25 ms at the median and 36 ms at
   p95; development-log injections fall to 0 (they were 147 of the 165 items injected since 1 Sep).
   Whether the personal memories it now picks are the right ones is what the evaluation set will judge.
2. **The one complete loop.** Typed archive with validity and tombstones; the immediate path for explicit
   requests, including a live voice session; the batched background writer with kinds of statement;
   FTS5; deep recall with sources; the first Brief; the "What AVA knows" screen after its mockup is
   approved. Gate: the evaluation score goes up, no category gets worse, and the voice and recall latency
   budgets hold.
3. Recent digest and compression of the long conversation, dreaming, stale checks said out loud,
   commitments into follow-ups.
4. Only if the evaluation shows a need: local embeddings and prefetch.

## Decisions (Niko, 29 Sep)

1. **Automatic memory with a visible "just learned" feed: yes.** Sensitive topics are stored only when Niko
   says so.
2. **Check stale facts out loud: yes.**
3. **Paid side-model reading of past conversations: yes.** Niko: "whatever needs to be done to make AVA
   better". No spending cap is set; cost stays visible in Mission Control anyway.
4. **Evaluation set from his real conversations: yes.** He confirms the answers.
