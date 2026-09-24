# Persistent sidebar navigation

AVA's primary navigation is a persistent left rail that expands into a
conversation-aware workspace. It replaced the top `TubelightNav`, which nothing
renders any more.

## Conversation continuity

`ChatScreen` reports its canonical server session through `onSessionChange`
when an existing conversation loads or when the first message turns a blank
draft into a durable session. `App.tsx` stores only that opaque session ID under
`ava:last-chat-session` and keeps it in app state.

The rail's **Talk** destination opens that session directly from any AVA
workspace; with nothing remembered it opens "Your conversations". The ID
survives a browser reload. It is never cleared just because a recents page does
not include it. An exact lookup decides availability when the conversation is
opened, and only a conversation that is actually unavailable is forgotten (I1).

The expanded sidebar fetches `/api/sessions?scope=human&limit=8` and shows Sir's
recent conversations, keeping the current one first. Automation runs and
unclassified history never appear there. **All conversations** opens the full
existing Chats workspace; session deletion and pinning remain there, so the
shell does not create a second management surface.

## Destinations

Primary: **New chat**, then **Today**, **Talk**, **Schedule**, **Notes** and
**Ideas**. A collapsed **System** group at the bottom holds Activity (Mission
Control in its own window), Explore AVA, Watches, Memory, Strategy Room, Visual
explanations, Settings & rules and Self development. It opens by itself when
one of those is active. See
[Life-assistant navigation](life-assistant-navigation.md).

## Layout and accessibility

- The 68px rail (58px at 520px and below) expands to at most 284px.
- Below 1024px the expanded drawer overlays the page behind a dismiss scrim, and
  choosing any destination or conversation closes it. From 1024px up there is no
  scrim and the drawer stays open after a choice.
- Collapsed, the rail's grids shrink to the rail and hidden labels take no
  space, so focus never scrolls the rail sideways.
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
restoration, a new chat becoming canonical, current-first recents, API failure
fallback, the System inventory, closing after a choice at 390/800px but not at
1024px, collapse/expand, Escape and accessible controls. The I3a browser harness
also checks rail containment at 1440 and 390px.
