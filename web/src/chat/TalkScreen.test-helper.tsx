import { useState, type ComponentProps } from "react";
import { BottomBar, type BarConversation } from "../design/BottomBar.js";
import { ChatScreen } from "./ChatScreen.js";

/**
 * Talk as the app shows it: ChatScreen plus the bottom bar it lends its
 * conversation to, wired the way App.tsx wires them. A send with nothing lent
 * (an automated run) starts a new conversation instead.
 */
export function TalkScreen({ onNewConversation, ...props }: ComponentProps<typeof ChatScreen> & {
  onNewConversation?: (text: string) => void;
}) {
  const [bar, setBar] = useState<BarConversation | null>(null);
  const [draft, setDraft] = useState("");
  const [focus, setFocus] = useState(0);
  return (
    <>
      <ChatScreen
        {...props}
        onComposer={setBar}
        onDraft={(text) => { setDraft(text); setFocus((request) => request + 1); }}
      />
      <BottomBar
        destinations={[]}
        current="talk"
        onNavigate={() => {}}
        draft={draft}
        onDraftChange={setDraft}
        onSend={(text) => {
          if (bar) bar.onSend(text);
          else onNewConversation?.(text);
          setDraft("");
        }}
        onTalk={bar?.onVoice}
        busy={bar?.busy ?? false}
        onStop={bar?.onStop}
        focusRequest={focus}
        placeholder={bar ? "Message AVA…" : undefined}
      />
    </>
  );
}
