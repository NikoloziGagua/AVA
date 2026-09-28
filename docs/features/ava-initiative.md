# AVA-initiated conversations

## Implemented foundation (T-A)

This is the session/inbox foundation of the agreed awake-PC initiative pilot,
not an enabled proactive assistant. It adds no scheduler, generation call,
notification, settings endpoint, or live publication. The dependent T-B increment
must implement those before an actual invitation can be produced. No existing
conversation is relabelled as assistant-originated.

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
accepted-human ingress, never inference from a stored user-role message. T-B
must integrate message acceptance/publication transactions and test both voice
providers and memory auto-capture before claiming end-to-end completion.

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
