import { useState } from "react";
import { getToken } from "./auth/tokens.js";
import { PairingScreen } from "./auth/PairingScreen.js";
import { ChatScreen } from "./chat/ChatScreen.js";

export function App() {
  const [paired, setPaired] = useState<boolean>(!!getToken());
  if (!paired) return <PairingScreen onPaired={() => setPaired(true)} />;
  return <ChatScreen />;
}
