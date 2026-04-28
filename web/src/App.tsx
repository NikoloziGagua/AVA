import { useState } from "react";
import { getToken } from "./auth/tokens.js";
import { PairingScreen } from "./auth/PairingScreen.js";
import { ChatScreen } from "./chat/ChatScreen.js";
import { SessionsScreen } from "./sessions/SessionsScreen.js";
import { RulesScreen } from "./rules/RulesScreen.js";

type View =
  | { name: "chat"; sessionId: string | null }
  | { name: "sessions" }
  | { name: "rules" };

export function App() {
  const [paired, setPaired] = useState<boolean>(!!getToken());
  const [view, setView] = useState<View>({ name: "chat", sessionId: null });

  if (!paired) return <PairingScreen onPaired={() => setPaired(true)} />;

  if (view.name === "sessions") {
    return (
      <SessionsScreen
        onOpen={(id) => setView({ name: "chat", sessionId: id })}
        onNew={() => setView({ name: "chat", sessionId: null })}
        onClose={() => setView({ name: "chat", sessionId: null })}
      />
    );
  }

  if (view.name === "rules") {
    return <RulesScreen onClose={() => setView({ name: "chat", sessionId: null })} />;
  }

  return (
    <ChatScreen
      sessionId={view.sessionId}
      onOpenSessions={() => setView({ name: "sessions" })}
      onOpenRules={() => setView({ name: "rules" })}
    />
  );
}
