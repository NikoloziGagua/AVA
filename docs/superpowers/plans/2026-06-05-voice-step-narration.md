# Voice step narration (Phase 1, Option 1 — "one voice per task")

**Goal (Sir's "do A"):** In hybrid voice mode, Ava narrates each task step aloud
("Opening google.com… Clicking… ") and then speaks the result — all in the TTS
voice, one seamless voice per task. The realtime model stays SILENT during a
task. Chit-chat outside tasks is unchanged (realtime model still speaks).

**Why Option 1:** fastest (no per-step round-trip to the realtime model), most
controllable (exact narration text via `humanizeTool`, no rewording), and one
voice within a task. Chosen over "result in realtime voice" (voice switch
mid-task) and "realtime narrates all" (slow + unpredictable).

## Data contract (new Ava control frames, server → client)

- `{ type: "ava.step", tool, args }` — one per agent tool call.
- `{ type: "ava.result", text }` — the final result; client speaks it via TTS.
- The model's tool call is satisfied with a SILENT `function_call_output`
  (NO `response.create`) so the realtime model does not speak.

Source of step data: `/api/chat` SSE already emits `event: tool_call` /
`data: {tool,args}` per step. `runVoiceAction` taps that stream.

## Files & exact changes

### server/src/index.ts — `runVoiceAction`
- Add 3rd param `onStep?: (tool: string, args: unknown) => void`.
- In the SSE loop, on `curEvent === "tool_call"`: parse `{tool,args}`, call
  `onStep?.(tool, args)`. (Leave final/error/killed handling as-is.)

### server/src/routes/voice-realtime.ts
- New exported frame builders next to `actionStartedFrame`:
  - `stepFrame(tool, args)` → `{type:"ava.step", tool, args}`
  - `actionResultFrame(text)` → `{type:"ava.result", text}`
  - `silentToolResultFrame(callId, output)` → only the `function_call_output`
    item (NO `response.create`).
- `RealtimeProxyDeps.runAction` type gains the optional `onStep` param.
- `do_on_computer` handler: pass `onStep = (tool,args) => client.send(stepFrame(...))`;
  on success send `client.send(actionResultFrame(formatSpeechText(text)))` then
  `upstream.send(silentToolResultFrame(callId, text))`; same for the error path.
  (Keep `actionStartedFrame(task)` at the start; drop the old `toolResultFrames`
  call that triggered the model to speak.)
- Session instruction (~L457): change "CALL do_on_computer … then speak the
  result it returns" → "CALL do_on_computer with a clear task and do NOT speak
  the steps or the result yourself — the system narrates each step and speaks the
  result aloud. After the tool returns, stay silent unless asked a follow-up."

### web/src/voice/realtime-events.ts
- `RealtimeAction` += `{kind:"action_step"; tool; args}` and `{kind:"action_result"; text}`.
- `classifyRealtimeEvent`: `case "ava.step"` (ignore if no tool) and `case "ava.result"`.

### web/src/voice/voiceInputMode.ts (pure, TDD first)
```ts
export function reopenAfterSpeak(opts: {
  state: string; actionPending: boolean; resultReceived: boolean;
}): "reopen" | "stay" {
  if (opts.state !== "responding") return "stay";
  if (!opts.actionPending) return "reopen";   // normal chitchat TTS
  if (opts.resultReceived) return "reopen";    // task fully narrated
  return "stay";                               // between task steps
}
```

### web/src/voice/useRealtimeVoice.ts
- `HybridEffect` += `{kind:"step"; tool; args}` and `{kind:"result"; text}`;
  `realtimeActionToHybridEffect`: map `action_step`→step, `action_result`→result.
- New ref `actionResultReceivedRef = useRef(false)`. INVARIANT: anywhere
  `actionPendingRef.current` is set false (cleanup, `caption_user`, `play_audio`,
  stop), also set `actionResultReceivedRef.current = false`.
- `speakWorker` drain (the `if (stateRef.current === "responding") setState("listening")`
  line): replace with `reopenAfterSpeak({state, actionPending, resultReceived})`;
  on "reopen", if actionPending clear BOTH refs, then `setState("listening")`.
- `handleHybridAction` new cases:
  - `step`: `actionPendingRef.current = true`; `phrase = humanizeTool(tool,args)`;
    `setCaption({who:"ava", text:phrase})`; `enqueueSpeak(phrase)`.
  - `result`: `actionResultReceivedRef.current = true`;
    `setCaption({who:"ava", text})`; `enqueueSpeak(text)`.
- Import `humanizeTool` from `../chat/humanize.js`.
- Do NOT touch the transcribe path (`runAgentTurn`) or PTT/VAD logic.

## Tests (TDD — write first, watch fail, then implement)
- `voiceInputMode.test.ts`: `reopenAfterSpeak` — stay when not responding;
  reopen on chitchat; stay between steps; reopen after result.
- `realtime-events.test.ts`: `ava.step`→action_step (+ ignore when no tool);
  `ava.result`→action_result.
- `useRealtimeVoice.intent.test.ts` (or the mapper's test file):
  action_step→step, action_result→result.

## Safety gates (the burned-trust contract)
1. Commit at the end of the implementer task (isolate from any self-dev swap).
2. **Regression-guard agent** before anything goes live: verify hands-free (VAD),
   push-to-talk (Enter start/commit, ≥4800-byte guard), BOTH entry points (chat
   mic + dashboard orb), no mid-reply cutoff, AND the new rule (mic stays closed
   across steps, reopens only after the result TTS drains). Plus `npm test`,
   web build, server build.
3. **`web/dist` stays UNBUILT until the regression-guard is green** — nothing Sir
   experiences changes until verified.

## Out of scope (Phase 2, next)
Voice approvals — Ava asks "shall I proceed?" aloud mid-task; spoken yes/no
resolves it (15s auto-approve as fallback). Separate pass, separate guard.
