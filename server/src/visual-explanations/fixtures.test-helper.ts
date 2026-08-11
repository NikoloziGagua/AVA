import type { CreateVisualExplanationInput } from "./model.js";

export const repositoryMapFixture: CreateVisualExplanationInput = {
  title: "AVA repository map",
  summary: "A progressive map from the desktop interface through the server and durable state.",
  mermaid: `flowchart LR
ui["React PWA"]
api["Express API"]
agent["AVA agent"]
tools["Tool registry"]
state["SQLite state"]
browser["Persistent browser"]
ui --> api
api --> agent
agent --> tools
tools --> state
tools --> browser`,
  storyboard: {
    schemaVersion: "1.0",
    startSceneId: "entry",
    scenes: [
      { id: "entry", title: "Enter through AVA", caption: "The installed React PWA talks only to AVA's authenticated API.", nodeIds: ["ui", "api"], highlightNodeIds: ["ui"], transition: "fade", interactionCue: "Move next to follow the request." },
      { id: "orchestrate", title: "AVA routes the work", caption: "The API gives the request to AVA's agent and explicit tool registry.", nodeIds: ["api", "agent", "tools"], highlightNodeIds: ["agent"], transition: "slide" },
      { id: "effects", title: "Tools reach state and browser", caption: "Tools use local durable state or the dedicated persistent browser.", nodeIds: ["tools", "state", "browser"], highlightNodeIds: ["state", "browser"], transition: "fade" },
    ],
  },
};

export const requestPathFixture: CreateVisualExplanationInput = {
  title: "Request path walkthrough",
  summary: "How a request becomes a verified AVA result.",
  mermaid: `flowchart TD
request(["Niko asks AVA"])
interpret["Interpret objective"]
select["Select capability"]
execute["Execute tool"]
verify{"Evidence available?"}
report(["Report honest outcome"])
request --> interpret
interpret --> select
select --> execute
execute --> verify
verify -->|Yes or no| report`,
  storyboard: {
    schemaVersion: "1.0",
    startSceneId: "understand",
    scenes: [
      { id: "understand", title: "Understand", caption: "AVA captures the objective before choosing a capability.", nodeIds: ["request", "interpret", "select"], highlightNodeIds: ["interpret"], transition: "fade" },
      { id: "act", title: "Act and verify", caption: "Execution and verification stay separate so attempts are not presented as proof.", nodeIds: ["select", "execute", "verify", "report"], highlightNodeIds: ["verify"], transition: "slide", interactionCue: "Compare the execution and evidence boundaries." },
    ],
  },
};

export const branchingProcessFixture: CreateVisualExplanationInput = {
  title: "Approval branch",
  summary: "A branching process that proceeds safely according to impact and evidence.",
  mermaid: `flowchart TD
start(["Task proposed"])
risk{"High impact?"}
approve["Request approval"]
proceed["Proceed within scope"]
check{"Verified?"}
done(["Completed"])
blocked(["Blocked or unverified"])
start --> risk
risk -->|Yes| approve
risk -->|No| proceed
approve --> proceed
proceed --> check
check -->|Yes| done
check -->|No| blocked`,
  storyboard: {
    schemaVersion: "1.0",
    startSceneId: "gate",
    scenes: [
      { id: "gate", title: "Choose the safe branch", caption: "High-impact work waits for approval; routine work proceeds within scope.", nodeIds: ["start", "risk", "approve", "proceed"], highlightNodeIds: ["risk"], transition: "fade" },
      { id: "outcome", title: "Report the evidence", caption: "Only verified work reaches completed; uncertainty remains visible.", nodeIds: ["proceed", "check", "done", "blocked"], highlightNodeIds: ["check"], transition: "slide" },
    ],
  },
};

