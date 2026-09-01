# Persistent sidebar navigation

AVA's primary navigation is a persistent left rail that expands into a
conversation-aware workspace. It replaces the top `TubelightNav` as the app
shell's active navigation surface; the old component remains in the repository
for historical/isolated uses but `App.tsx` no longer renders it.

## Conversation continuity

`ChatScreen` reports its canonical server session through `onSessionChange`
when an existing conversation loads or when the first message turns a blank
draft into a durable session. `App.tsx` stores only that opaque session ID under
`ava:last-chat-session` and keeps it in app state.

The sidebar's **Current chat** action opens that session directly from any AVA
workspace. This fixes the old two-step route: open Chats, find the row, open it.
The ID survives a browser reload. When the authenticated session list no longer
contains the ID, the shortcut is cleared instead of repeatedly opening a dead
conversation.

The expanded sidebar fetches the existing `/api/sessions` list and shows up to
eight recent conversations, keeping the current conversation first. **All
conversations** opens the full existing Chats workspace; session deletion and
pinning remain there, so the shell does not create a second management surface.

## Layout and accessibility

- Desktop: the 64px rail expands to 304px and moves the application stage so it
  does not cover working content.
- Narrow screens: the 56px rail expands as an overlay with a dismiss scrim,
  leaving the underlying stage at its usable width.
- Expand/collapse, every destination, recent chats and the all-chats fallback
  are native buttons. Active destinations use `aria-current`.
- Escape collapses an expanded sidebar and the preference is restored on reload.
- Reduced-motion clients receive effectively instant width/opacity transitions.
- Splash and Voice remain immersive: the shell is present but inert and hidden.

## Failure behavior

Recent-chat loading is supplemental. If it fails, the sidebar exposes an honest
`Chats unavailable · open history` route rather than rendering an empty list or
forgetting the current session. Conversation rendering and agent execution do
not depend on the sidebar request.

The shell stores no message content, token or title in browser persistence—only
the non-secret session ID and expanded/collapsed preference. Titles remain
fetched through AVA's authenticated sessions endpoint.

## Verification

Focused tests cover direct return after visiting another workspace, reload
restoration, a new chat becoming canonical, current-first recents, stale session
cleanup, API failure fallback, collapse/expand, Escape and accessible controls.
