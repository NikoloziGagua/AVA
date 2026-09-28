# AVA · One conversation (28 Sep 2026)

A discussion preview for Niko's room message 1530: "maybe we should get rid of chats and just have one… I don't know how AVA will remember what we talked about". Codex and Claude agreed on it in room messages 1531, 1540 and 1544.

**It is a proposal, not a feature.** Every new interaction is labelled "proposed". All conversation text, names and times are invented. The only real inputs are three aggregate counts, taken from a read-only copy of AVA's database:
- the voice share of Niko's turns since 24 Sep;
- how many conversations he touches per day;
- the roughly 22K input tokens per model call, measured in the typed chats of 27–28 Sep (voice calls not measured yet).

No message content was read into this page. Nothing imports AVA code, calls AVA or a provider, or changes live AVA.

## Open it

From the AVA repository root:

```powershell
node docs/design/previews/ava-one-conversation-2026-09-28/serve.mjs 5181
```

Then open http://127.0.0.1:5181/. Opening `index.html` from disk also works, but without the Geist fonts.

## What it shows

- **One Talk screen.** Tapping the face always resumes the same conversation. Typing goes to the same place.
- **Chapters.** A new chapter is shown after a long time away or when Niko says "new topic". Chapters are today's conversations; nothing is deleted, merged or lost. Grouping them on screen is display-only. Starting sessions automatically changes voice resume, so it would need a shared contract first.
- **Three memory layers:**
  1. recent exact turns (a bounded window; the whole chapter stays stored);
  2. chapter summaries, used to find the right past messages; answers come from those original messages;
  3. a correctable "what I'm carrying forward" list of decisions, promises and preferences. Each item says whether Niko said it or AVA guessed, and links to its source. Guesses can be confirmed. "Stop carrying" stops AVA using an item without deleting any messages.
- **An explicit project switch.** Saying "switch to the tutoring app" starts a chapter that uses only that project.
- **Open decisions for Niko,** each with a proposed default.

## Boundaries

- Static HTML and CSS plus one inline script. It reuses the Future hub's `shared.css` and `shared.js`.
- No network requests, storage or recording. The talk button is decorative.
- Reduced motion is respected.
- `serve.mjs` serves only this folder, the hub's shared files and AVA's bundled fonts, on 127.0.0.1, read-only.
