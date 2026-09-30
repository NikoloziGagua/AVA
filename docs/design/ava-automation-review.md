# Review: Activepieces, Microsoft UFO and learned playbooks (Claude, 2026-09-30)

Niko asked whether these three systems need improving. Short answers:

- **Learned playbooks: keep, but clean up.** They are the only one of the three with real use: opening a
  contact's Instagram chat was recalled 33 times, 15 of them verified. Two matching bugs made them fire on
  unrelated voice requests; both are fixed. Most of what they learned came from automated Codex improvement
  cycles rather than Niko's own requests.
- **Activepieces: not earning its keep.** It is a separate local server (not running on 30 Sep) that formats
  two reports and signs off learned shortcuts. For shortcuts it only writes a plan that repeats the steps,
  which AVA then runs itself, so it adds up to 20 seconds, timeouts, and a way to fail. Keep it only if Niko
  wants its app integrations (Gmail, Sheets, and so on), and then use it for exactly those.
- **Microsoft UFO: parked, as Niko decided on 28 Aug.** It has never completed a run and can only type a
  fixed line into a throwaway Notepad. Its four tools are still offered to the agent on every action request.
  Hide them behind a switch.

Nothing here was removed. The changes already made are bug fixes; the rest are proposals for Niko to decide.

## Evidence

Read-only queries on the live database and files on 30 Sep 2026.

| | Use | Result |
|---|---|---|
| Activepieces `ava.system-report` | 18 runs, 28 Aug to 23 Sep | 16 completed, 2 unavailable |
| Activepieces `ava.operations-brief` | 8 runs, 29 Aug to 23 Sep | 8 completed |
| Activepieces `ava.approved-action-plan` | 41 runs, 29 Aug to 28 Sep | 34 completed, 6 timed out, 1 failed. About 30 were the misfiring test shortcut below |
| Activepieces server | health check at `127.0.0.1:8080` | not reachable |
| Microsoft UFO (pinned v3.0.8) | 2 requests, both the Notepad proof | both cancelled; no completed run |
| Agent tool calls recorded | 327 in total | `automation_run_playbook` 30, `automation_status` 5, system report 3, operations brief 3; UFO tools 0 |
| Learned playbooks | 49 files | 26 demoted by AVA's own rules (three or more failures, never verified); 23 still offered, of which only 3 were used more than 6 times |

The three that matter are opening a contact's Instagram chat (33 uses, 15 verified), opening a social media
direct message (9) and opening a browser window (15). About a third of all playbooks are Codex development
procedures, such as "plan next bounded observability improvement" (20 uses) and "monitor completion of an AI
brainstorming session" (13).

## Bugs found and fixed

1. **A test shortcut ran 29 times on unrelated requests** (commit `979948b`). A learned shortcut ("search
   Google for a test phrase, then open a contact's Instagram chat") matched almost any long input, because
   the matcher counted repeated common words ("and", "for"). Short typed requests like "open instagram" also
   matched it, as a substring of a trigger. And voice jobs were matched on the earlier results they carry.
   This is why AVA kept opening that chat unasked.
2. **File playbooks had the same voice weakness** (commit `d6a99e7`). After one Instagram result in a voice
   call, requests such as "so" or "what's in my notes" were steered by the Instagram direct-message
   playbook. Both matchers now read only Niko's current words.

## Proposals, in order of value

1. **Learn procedures only from Niko's own requests.** Skip automated Codex and watcher cycles, so their
   procedures stop filling the store. Small change in `playbooks/capture.ts`: the session origin and the
   automation-prompt check already exist in the memory work.
2. **One procedural system, not two.** Keep the file playbooks as hints. Run approved learned sequences
   directly with AVA's own executor (it already does the work) and drop the Activepieces sign-off hop. That
   removes the 20-second timeouts and the failure when Activepieces is down.
3. **Prune and show.** Archive playbooks that have been demoted for 30 days. List the rest on the planned
   "What AVA knows" screen, where Niko can keep or delete a learned procedure the same way as a memory.
4. **Hide the UFO tools** unless a `UFO_EXPERIMENT_ENABLED` switch is on. The code and runtime stay for a
   future evaluation. Niko's real need (15 Aug: "see the screen when I'm stuck") is already covered by
   `look_at_screen` and `computer_use`. What's missing is using them automatically after a tool fails, which
   is an orchestrator change, not UFO.
5. **Activepieces: decide what it is for.** If the answer is app integrations, add those workflows and
   expose them as tools, and move the two reports into AVA itself: the data is already AVA's own snapshot,
   and Activepieces only formats it. If there is no integration plan, stop the server and remove its tools
   from the default list.
6. **Retire the test shortcut** so it can't be offered again. With fix 1 it can only match its own exact
   wording, so this is housekeeping.

Proposals 1, 3 and 6 are small and safe. Proposals 2, 4 and 5 remove or hide things Codex built and Niko
approved at the time, so they wait for his decision.
