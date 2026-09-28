# AVA-initiated conversations

## Awake-PC pilot (T-A foundation and T-B engine)

This default-off pilot lets AVA offer one grounded conversation about saved
Notes or a planned calendar occurrence. Enable it explicitly in initiative
Settings. It runs only while the AVA backend is awake; there is no cloud
scheduler, web research, external action or missed-day backfill. No existing
conversation is relabelled as assistant-originated. Source implementation and
tests do not mean the running application has been promoted or that a real
invitation has been judged useful.

### Engine and settings

`server/src/initiative/` separates settings, Dublin time, authoritative source
reads, ledger/publication transactions and the engine. The existing `prompt.ts`
owns tool-free generation and copy. `index.ts` starts an immediate tick only
after acquiring the listening port, then every minute. Shutdown stops new work
and discards late generation results; the provider interface does not support
aborting the upstream completion, so no upstream cancellation is claimed.

Defaults: disabled, delivery **11:00 Europe/Dublin**, quiet **22:30–08:30**, no
active folders. Settings live in SQLite with positive version guards; unknown
fields, invalid times, duplicate/nonexistent folders or more than 32 folders
are rejected. A read of untouched settings writes nothing. Equal quiet start
and end mean all-day quiet, not no quiet.

An occurrence is `daily:YYYY-MM-DD` in Dublin, never host-local time. Its window
starts at the configured wall-clock time and ends three elapsed hours later,
clipped to that local day and the first uninterrupted non-quiet segment. A DST
gap advances to the first valid minute; overlap uses the first instance. A
late boot does not backfill. Enabled, quiet hours, window and the one-published-
per-local-day budget are checked before claiming and inside publication.

Each generation attempt is durable before one provider `complete` call: random
token, increasing revision, 120-second lease, maximum two attempts total. An
error, stale source or duplicate can use the remaining attempt. State changes
require the matching token/revision/state and a live lease. Expired work is
recovered by a new claim; late responses cannot alter it. Provider errors and
raw output are not stored in the ledger or shown as conversations. Bounded
lifecycle reason codes go through the existing server logger.

### Evidence and boundaries

- Gather at most 200 eligible Notes IDs ordered by updated time and ID, then
  exact full reads. Eligible means edited in the last 72 hours or in an
  explicitly active folder subtree. This is a bounded candidate set, not a
  comprehensive scan of everything Niko knows.
- Pick one scope: the newest eligible note's folder (or its nearest active
  ancestor), otherwise an existing active folder. Without either, suppress
  `no_eligible_scope` before calling the model. General requires a recent General
  capture; unlinked calendar occurrences cannot make it eligible. An active
  descendant is excluded from its parent's scope. Recent edits alone do not
  make a project active. General contains only unfiled/built-in General notes
  and calendar events without a linked Notes folder.
- At most four notes plus upcoming/in-progress calendar occurrences from a
  seven-day window, eight sources total. Calendar uses its own exact occurrence
  projection; a cancelled/archived event is not evidence. Oversized calendar
  expansion fails rather than being silently paginated as complete.
- Note references preserve version and SHA-256 of the authoritative content,
  status, tags and folder path. Calendar references preserve occurrence key,
  event version and exception version. Re-read every citation inside the
  publication transaction. Changed, missing, moved or out-of-scope evidence
  cannot publish; active-folder changes also force regeneration.
- Source text and display fields are secret-scrubbed again at their output
  boundaries. Prompt limits remain 4,000 characters per note, 16,000 total note
  characters, 800 output tokens; returned text above 16,000 characters is
  rejected. No tool access, hidden reasoning, provider payload archive or
  memory-derived citations are introduced.
- Same-scope titles or exact source-ID sets published in the last 14 days are
  duplicates (source versions do not make a repeated idea novel). Only 20 recent
  titles enter the prompt. Grounding checks validate identity and freshness,
  **not semantic entailment**: an accepted suggestion is not a verified fact
  about Niko's progress, attendance, health or activity.

### Authenticated API

All routes under `/api/initiatives` reuse the existing token/session authority:

| Method/path | Contract |
|---|---|
| GET `settings` | `{enabled, deliveryLocalTime, quietStart, quietEnd, activeProjectFolderIds, version}` |
| PATCH `settings` | Partial settings plus current `version`; 400 `bad_request`, 409 `stale_version` |
| GET `inbox-summary` | `{pending, unopened, newest: {initiativeId, sessionId, title, publishedAt} \| null}` |
| GET `:id` | Exact published view below; 404 `initiative_unavailable` for missing/mismatched/inaccessible identity |
| POST `:id/opened` | Idempotent seen marker, 204; no engagement or push |
| POST `:id/disposition` | `{state: "later" \| "not_useful", expectedVersion}`; success `{disposition}`; 409 `{error: "stale_version", disposition: {state,version}}` |

The published view contains `id, sessionId, title, reasonNow, scope,
publishedAt, expiresAt, openedAt, disposition:{state,version,updatedAt},
notification:{state}, sources`. Scope is `{kind:"general"}` or
`{kind:"project",folderId,name}`. Sources keep their exact original references
and add `status: current|changed|unavailable`, `title`, and for calendar sources
`startsAt/endsAt`. Changed sources show their current title but do not rewrite
the invitation. Unavailable sources expose null display fields, never another
project's current label or contents. Attempt tokens, prompts and transport
details are not returned. Operational route failure returns bounded 503
`initiative_unavailable` rather than raw errors.

### Scoped feedback (contract v3)

`not_useful` persists the versioned disposition on this ledger. For 30 days
from that decision, the title joins the bounded recent-title prompt and an
identical source-ID set is a duplicate, within the same scope only. Recent
rejections are ordered by decision time; normal novelty still covers 14 days
from publication. At most 200 receipts are checked, and 20 titles enter the
prompt. A stale write or exact replay cannot extend the rejection window.
Later does not teach rejection; reversing the decision removes its 30-day
effect. Source references and the original invitation remain unchanged.

There is no write to global observations, persona or a manufactured memory
thread. Memory-index feedback awaits a scoped source adapter; these decisions
are not facts about Niko's progress or global preferences.

### Notification receipts

Publication commits before notification. A compare-and-set from `none` to
`sending` assigns a random send token; only its winner calls the existing
bounded push transport. Payload is `{title,body,tag,data}`, with body at most
90 characters, tag `initiative-<id>`, and
`data:{kind:"initiative",initiativeId,sessionId,deepLink}`. The deep link is
`/?session=<encoded session ID>&initiative=<encoded initiative ID>`.

The reminder transport's 10-second default / 20-second maximum timeout, TTL,
sanitized outcome counters and dead-subscription pruning are reused unchanged.
Receipts distinguish `accepted`, `rejected`, `unknown`, `no_subscription`;
acceptance never means displayed or read on a phone. Missing VAPID transport
with an existing subscription is rejected, not reported as no subscription.
An interrupted `sending` receipt becomes `unknown` after 25 seconds and is
never resent, even if its old promise later reports success. Unclaimed `none`
receipts can recover after restart while unexpired and still unopened/open;
quiet hours and disabling prevent new sends. Later and opening never repush.
An unclaimed `none` receipt can therefore send later (for example the next
morning) while still within the original 72-hour expiry; it is not a new idea.
This is at-most-one transport attempt, not exactly-once phone delivery.

The canonical conversation remains `sessions` plus `messages` in SQLite.
`initiatives` is a bounded occurrence/publication receipt pointing at them,
not a second transcript. Internal normalized columns represent the contract's
scope, sources, attempt lease, notification and disposition fields. Occurrence,
session and message identities are unique. Purging conversation history nulls
the references but retains the occurrence receipt; it cannot reset the budget.

```text
Published assistant invitation → Inbox (no human recency)
    ├─ open, pin, Later        → still Inbox, no human recency
    ├─ expire / Not useful    → exact history / All, not Inbox
    └─ accepted human reply   → engaged + normal recent conversation
```

### Reads and navigation

- Authenticated `GET /api/sessions?scope=inbox` uses existing bounded pagination:
  default 20, maximum 100, strict opaque cursor (maximum 2,048 characters).
- Inbox requires an undeleted, non-archived assistant session with no human
  activity, a published exact ledger/message reference, open/later disposition,
  publication timestamp and future expiry. Missing/mismatched publication
  evidence does not produce a navigable invitation.
- Order is publication time descending then session ID descending, independent
  of pins, opening, maintenance or title edits. Inbox cursor version 1 has
  `order: "published"` and `pinned: 0`; cross-scope or incompatible cursors return
  the existing 400 `bad_request`. As with other keyset lists, this is a live
  listing, not a frozen multi-page snapshot; expired rows disappear on re-read.
- Exact and list session reads expose `initiativeId` from the unique retained
  published session/message reference. Ordinary sessions, or assistant rows with
  missing/malformed references, return null. No prose-based identity inference.
- `scope=human` includes assistant sessions only after accepted human activity,
  even when pinned. Existing human/legacy pin rules and automation scope remain
  unchanged. Dismissed/expired invitations remain available through exact and All
  history until the conversation itself is deleted.
- Explicit resume (including delegated voice actions) can bind the invitation.
  Continue ignores it until a human turn is accepted. Reading, binding, pinning
  and publication do not change the current conversation pointer.

`markHumanActivity` atomically advances monotonic human recency and sets the
published invitation's disposition to engaged once, incrementing disposition and
ledger versions. A failure rolls both back. Subsequent replies advance recency
without rewriting the initial engagement receipt. This function is for trusted
accepted-human ingress, never inference from a stored user-role message. Chat,
OpenAI and Hume accepted-message writes include engagement in the same SQLite
transaction. Delegated `persist:false` turns do not engage the invitation.
Publication never calls automatic memory capture and stores no user turn, so an
AVA-authored invitation cannot become a new personal fact through that path.

### Upgrade and compatibility

Fresh databases accept session origin `assistant`; old origins keep their exact
values. Existing three-origin CHECK constraints require SQLite's
[table-rebuild procedure](https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes).
The migration takes an immediate transaction, rechecks the current schema,
copies all ordinary columns and rowids, restores indexes/triggers and preserves
dependent rows and views. Foreign-key verification precedes commit. Connection
pragmas are restored and failed upgrades close their connection. Unknown legacy
constraints or a conflicting temporary table fail rather than overwrite data.
No writable-schema editing or historical provenance inference is used.

Tests cover an old database with extra columns, a view and INSTEAD OF trigger,
child foreign keys, history, pins, rowids and summaries; repeated/concurrent
openers; failed migration rollback; inbox eligibility, ordering and pagination;
read-only discovery; promotion and engagement rollback; exact reconnect/restart
binding; authentication and malformed API queries. They use isolated fixture
databases, never the live database or paid providers.

Concurrent migration coverage uses AVA's existing WAL format. Simultaneously
opening a foreign non-WAL database for its first journal-mode conversion can
still encounter SQLite's `SQLITE_BUSY`; general first-open contention recovery
is not changed by this increment.
