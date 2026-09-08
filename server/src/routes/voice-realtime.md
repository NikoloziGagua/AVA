# Realtime voice providers

The realtime voice proxy (`/api/voice/realtime`, `voice-realtime.ts`) can speak one
of two upstreams, selected at boot by `AVA_VOICE_PROVIDER`:

| Provider | Value | Notes |
| --- | --- | --- |
| OpenAI | `openai` (default) | `gpt-realtime-2.1`. The primary path and fallback. |
| Hume EVI | `hume` | Hume Empathic Voice Interface. Used only when fully configured. |

Selection reads **only** `process.env` (it never opens or parses a `.env` file) and
never logs a secret value — only the non-secret shape of the choice
(`describeVoiceProvider`).

## What it does

`AVA_VOICE_PROVIDER=hume` makes the proxy connect to Hume EVI, configure the session
(system prompt + chosen voice), and translate Hume's events into the same
OpenAI-shaped frames the web client already understands, so the front-end stays
provider-agnostic. Mic audio is translated the other way (`input_audio_buffer.append`
→ Hume `audio_input`).

## Why it exists

To let Ava speak with a Hume EVI voice (e.g. "Alice Bennett") without disturbing the
working OpenAI realtime path, and without ever risking a leaked API key.

## How to configure (user)

Set these in `server/.env`:

```ini
AVA_VOICE_PROVIDER=hume
HUME_API_KEY=<your Hume API key>      # REQUIRED — without it, falls back to OpenAI
HUME_CONFIG_ID=<your EVI config id>   # optional
HUME_VOICE_NAME=Alice Bennett         # optional; this is the default
# If Hume needs an exact voice identifier for Alice Bennett, pin it:
HUME_VOICE_ID=<Alice Bennett voice id>  # optional; preferred over the name
```

- `HUME_VOICE_NAME` defaults to **Alice Bennett** when unset.
- `HUME_VOICE_ID`, when present, pins the voice by exact id (more reliable than name).
- `HUME_CONFIG_ID` is passed to Hume when present; omit it to use Hume defaults.

## Edge cases / fallback

- **Hume requested but `HUME_API_KEY` missing** → selection falls back to OpenAI at
  boot (logged as a non-secret reason).
- **Hume socket fails to establish** (errors/closes before opening) → the proxy
  transparently falls back to the OpenAI realtime path for that connection. No client
  handlers are attached until Hume actually opens, so the fallback connection is clean.
- **Secrets** are never logged. Any upstream error message is run through
  `redactSecrets` (API key / config id / voice id) before it reaches a log or the
  client.

## Decisions log

- **Translate to OpenAI-shaped frames rather than teach the client a second
  protocol.** The web client (`classifyRealtimeEvent`) already speaks the OpenAI
  event union; mapping Hume → that union keeps the front-end untouched.
- **API key in the ws query string** (`api_key=…`) per Hume EVI's browser/ws auth.
  Because the URL carries the secret, the URL is never logged; diagnostics use
  `describeVoiceProvider` (presence booleans + public voice name only).
- **OpenAI stays the default and the fallback** so a misconfigured or failing Hume
  setup can never take voice down.
