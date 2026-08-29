# Chat composer dictation

AVA's chat composer has two intentionally separate microphone experiences:

- **Dictate message** records one bounded clip, sends it to AVA's authenticated
  `/api/transcribe` endpoint, and inserts the returned words into the current
  editable draft. Existing draft text is preserved. Dictation never sends the
  message and never enters Voice Mode.
- **Voice mode** opens the existing realtime conversation experience and keeps
  its canonical chat-session binding.

## Interaction states

The dictation control exposes requesting permission, listening, transcribing,
idle, and actionable error states. While listening, Sir can stop and transcribe
or cancel without upload. Recordings stop automatically after 90 seconds. The
browser audio track is stopped on completion, cancellation, error, and unmount.
An in-flight transcription can be aborted locally.

The composer accepts the browser's supported WebM/Opus, Ogg/Opus, or MP4
recording format, normalizes codec-bearing MIME strings to the server allowlist,
and relies on the existing `gpt-4o-transcribe` route. Audio is processed for the
request and is not added to chat history, Notes, memory, receipts, or Mission
Control by this feature.

## Honest boundaries

- Browser microphone permission is required.
- A configured OpenAI transcription client is required on the AVA server.
- Transcribed text can still be wrong. It remains an editable draft and must be
  sent explicitly by Sir.
- Dictation is not a fallback for Voice Mode and does not share a live realtime
  microphone session with it.
