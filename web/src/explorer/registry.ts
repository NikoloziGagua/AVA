import type {
  CapabilityRuntimeBinding,
  CapabilitySafety,
  CapabilityVerification,
  EvidenceKind,
  ExplorerCapability,
  ExplorerCapabilityId,
  ExplorerDomain,
  ExplorerDomainId,
  ExplorerRegistry,
  ExplorerWorkflow,
  ExplorerWorkflowNode,
  ReadinessDimension,
  ReadinessRequirement,
  WorkflowEdgeKind,
} from "./types.js";

const source = (
  path: string,
  symbol: string,
  kind: "implementation" | "test" | "documentation" | "route" = "implementation",
) => ({ path, symbol, kind }) as const;

const readiness = (
  dimensions: readonly ReadinessDimension[],
  options: { authentication?: boolean; recentSuccess?: boolean } = {},
): readonly ReadinessRequirement[] => {
  const required = new Set(dimensions);
  const evidenceByDimension: Record<ReadinessDimension, readonly EvidenceKind[]> = {
    defined: ["source", "unit-test"],
    configured: ["health-check", "api-response"],
    authenticated: ["health-check", "tool-result", "dom-confirmation"],
    available: ["health-check", "tool-result", "api-response"],
    healthy: ["health-check", "tool-result"],
    tested: ["unit-test", "task-event"],
    "recently-successful": ["task-event", "tool-result"],
  };
  const descriptionByDimension: Record<ReadinessDimension, string> = {
    defined: "Implementation is present in the current source tree.",
    configured: "Required local configuration is present without exposing its values.",
    authenticated: "The relevant account or session is authenticated now.",
    available: "Required process, provider, application, or service is reachable now.",
    healthy: "A current health check or non-destructive probe succeeds.",
    tested: "Automated tests or an equivalent repeatable check have passed.",
    "recently-successful": "A recent real task completed with direct success evidence.",
  };
  const order: ReadinessDimension[] = [
    "defined",
    "configured",
    ...(options.authentication ? (["authenticated"] as const) : []),
    "available",
    "healthy",
    "tested",
    ...(options.recentSuccess ? (["recently-successful"] as const) : []),
  ];
  return order.map((dimension) => ({
    dimension,
    required: required.has(dimension),
    description: descriptionByDimension[dimension],
    acceptableEvidence: evidenceByDimension[dimension],
  }));
};

const verification = (
  successCriteria: readonly string[],
  evidenceKinds: readonly EvidenceKind[],
  limitations: readonly string[] = [],
  mandatory = true,
): CapabilityVerification => ({
  mandatory,
  successCriteria,
  evidenceKinds,
  limitations,
});

const safety = (
  risk: CapabilitySafety["risk"],
  approval: CapabilitySafety["approval"],
  sideEffects: readonly string[],
  options: Partial<Pick<CapabilitySafety, "sensitiveData" | "redactions" | "stopConditions">> = {},
): CapabilitySafety => ({
  risk,
  approval,
  sideEffects,
  sensitiveData: options.sensitiveData ?? [],
  redactions: options.redactions ?? [
    "Passwords, API keys, tokens, cookies, authentication headers and one-time codes.",
  ],
  stopConditions: options.stopConditions ?? ["Stop when the requested target cannot be verified."],
});

const runtime = (
  toolNames: readonly string[],
  snapshot: NonNullable<CapabilityRuntimeBinding["snapshot"]> = [],
  apiRoutes: readonly string[] = [],
): CapabilityRuntimeBinding => ({ toolNames, snapshot, apiRoutes });

type WorkflowStepSpec = Omit<
  ExplorerWorkflowNode,
  "id" | "capabilityId" | "parentNodeId"
> & {
  key: string;
  capabilityId?: ExplorerCapabilityId;
  parent?: string;
};

type WorkflowLinkSpec = {
  from: string;
  to: string;
  kind?: WorkflowEdgeKind;
  label?: string;
};

/**
 * Registry authoring helper. Keys are local and become globally unique IDs;
 * `parent` expresses tree containment while links express actual execution.
 */
const defineWorkflow = (
  capabilityId: ExplorerCapabilityId,
  name: string,
  description: string,
  steps: readonly [WorkflowStepSpec, ...WorkflowStepSpec[]],
  links?: readonly WorkflowLinkSpec[],
): ExplorerWorkflow => {
  const qualify = (key: string) => `${capabilityId}.${key}`;
  const actualLinks: readonly WorkflowLinkSpec[] =
    links ?? steps.slice(1).map((step, index): WorkflowLinkSpec => ({
      from: steps[index]!.key,
      to: step.key,
      kind: "next",
    }));
  return {
    id: `${capabilityId}.workflow`,
    name,
    description,
    entryNodeId: qualify(steps[0]!.key),
    nodes: steps.map(({ key, capabilityId: nodeCapabilityId, parent, ...step }) => ({
      ...step,
      id: qualify(key),
      capabilityId: nodeCapabilityId ?? capabilityId,
      ...(parent ? { parentNodeId: qualify(parent) } : {}),
    })),
    edges: actualLinks.map((link, index) => ({
      id: `${capabilityId}.edge-${index + 1}`,
      from: qualify(link.from),
      to: qualify(link.to),
      kind: link.kind ?? "next",
      ...(link.label ? { label: link.label } : {}),
    })),
  };
};

export const EXPLORER_DOMAINS = [
  {
    id: "conversation",
    name: "Conversation and text interaction",
    shortName: "Conversation",
    description: "Text turns, streaming responses, session continuity and interruption.",
    order: 10,
  },
  {
    id: "voice",
    name: "Voice and transcription",
    shortName: "Voice",
    description: "Realtime speech, transcription, playback and voice-to-action handoff.",
    order: 20,
  },
  {
    id: "interpretation",
    name: "Request interpretation",
    shortName: "Interpretation",
    description: "Turning a request into an objective and choosing conversational or action behaviour.",
    order: 30,
  },
  {
    id: "orchestration",
    name: "Planning and tool selection",
    shortName: "Orchestration",
    description: "The agent loop, model provider, tool rubric, retries and task stopping.",
    order: 40,
  },
  {
    id: "browser",
    name: "Browser automation",
    shortName: "Browser",
    description: "AVA's dedicated persistent browser and deterministic page controls.",
    order: 50,
  },
  {
    id: "desktop",
    name: "Native desktop and application control",
    shortName: "Desktop",
    description: "Launching and controlling Windows applications outside the browser.",
    order: 60,
  },
  {
    id: "shell-files",
    name: "Shell and file operations",
    shortName: "Shell & files",
    description: "PowerShell execution and allowlisted filesystem operations.",
    order: 70,
  },
  {
    id: "coding",
    name: "Coding and project work",
    shortName: "Coding",
    description: "Repository inspection, implementation, testing and delegated coding work.",
    order: 80,
  },
  {
    id: "instagram",
    name: "Instagram",
    shortName: "Instagram",
    description: "Connection, profiles, chats, identity-safe messaging and send verification.",
    order: 90,
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    shortName: "WhatsApp",
    description: "Linked-session checks, verified chat selection, reading and messaging.",
    order: 100,
  },
  {
    id: "people",
    name: "People and identity resolution",
    shortName: "People",
    description: "Mapping names and aliases to verified identities on communication platforms.",
    order: 110,
  },
  {
    id: "memory",
    name: "Memory",
    shortName: "Memory",
    description: "Durable preferences, observations, project context and intentional forgetting.",
    order: 120,
  },
  {
    id: "playbooks",
    name: "Procedural playbooks",
    shortName: "Playbooks",
    description: "Learning, recalling and measuring reusable procedures from completed work.",
    order: 130,
  },
  {
    id: "automation",
    name: "Scheduled reminders and monitoring",
    shortName: "Automation",
    description: "Standing watches and scheduled agent checks.",
    order: 140,
  },
  {
    id: "notifications",
    name: "Notifications and approvals",
    shortName: "Notifications",
    description: "Push notifications, approval decisions and autonomy rules.",
    order: 150,
  },
  {
    id: "vision",
    name: "Screenshots and visual inspection",
    shortName: "Vision",
    description: "Capturing the desktop and honestly analysing or verifying what is visible.",
    order: 160,
  },
  {
    id: "services",
    name: "Connected services",
    shortName: "Services",
    description: "Optional direct integrations such as Google Places and Shopify.",
    order: 170,
  },
  {
    id: "self-improvement",
    name: "Self-improvement",
    shortName: "Self",
    description: "Isolated implementation, verification, hot-swap and rollback of AVA changes.",
    order: 180,
  },
  {
    id: "developer-collaboration",
    name: "Developer collaboration",
    shortName: "Developers",
    description: "Reading development notes and conferring with external coding agents.",
    order: 190,
  },
  {
    id: "security",
    name: "Security, permissions and redaction",
    shortName: "Security",
    description: "Risk classification, approvals, path boundaries and secret scrubbing.",
    order: 200,
  },
  {
    id: "verification",
    name: "Verification and failure recovery",
    shortName: "Verification",
    description: "Evidence-based completion, retries, fallbacks and honest failure reporting.",
    order: 210,
  },
  {
    id: "interface",
    name: "Interface and remote access",
    shortName: "Interface",
    description: "The phone-first PWA, pairing, sessions and private remote reach over Tailscale.",
    order: 220,
  },
] as const satisfies readonly ExplorerDomain[];

const conversationWorkflow: ExplorerWorkflow = {
  id: "conversation.text-turn.workflow",
  name: "Stream a text turn",
  description: "The current text-chat request and response path.",
  entryNodeId: "conversation.text-turn.receive",
  nodes: [
    {
      id: "conversation.text-turn.receive",
      capabilityId: "conversation.text-turn",
      name: "Receive request",
      description: "Accept an authenticated chat request and preserve its session reference.",
      kind: "request",
      producesEvidence: ["api-response"],
    },
    {
      id: "conversation.text-turn.run",
      capabilityId: "orchestration.agent-loop",
      name: "Run agent turn",
      description: "Build context, invoke the model and execute permitted tool calls.",
      kind: "operation",
    },
    {
      id: "conversation.text-turn.stream",
      capabilityId: "conversation.text-turn",
      name: "Stream events",
      description: "Send thought, tool, approval and final events to the active client.",
      kind: "operation",
      producesEvidence: ["task-event"],
    },
    {
      id: "conversation.text-turn.complete",
      capabilityId: "conversation.text-turn",
      name: "Persist completion",
      description: "Store the assistant response and final session state.",
      kind: "result",
      producesEvidence: ["task-event"],
    },
  ],
  edges: [
    { id: "conversation.text-turn.e1", from: "conversation.text-turn.receive", to: "conversation.text-turn.run", kind: "next" },
    { id: "conversation.text-turn.e2", from: "conversation.text-turn.run", to: "conversation.text-turn.stream", kind: "next" },
    { id: "conversation.text-turn.e3", from: "conversation.text-turn.stream", to: "conversation.text-turn.complete", kind: "next" },
  ],
};

const browserWorkflow: ExplorerWorkflow = {
  id: "browser.persistent-control.workflow",
  name: "Operate AVA Chrome",
  description: "Open the persistent profile, inspect the page, act and verify the result.",
  entryNodeId: "browser.persistent-control.open",
  nodes: [
    {
      id: "browser.persistent-control.open",
      capabilityId: "browser.persistent-control",
      name: "Open or attach",
      description: "Open and foreground AVA's dedicated persistent browser.",
      kind: "operation",
      toolName: "chrome_open",
      producesEvidence: ["tool-result"],
    },
    {
      id: "browser.persistent-control.inspect",
      capabilityId: "browser.persistent-control",
      parentNodeId: "browser.persistent-control.open",
      name: "Inspect page structure",
      description: "Read visible text or accessibility references before selecting a target.",
      kind: "operation",
      toolName: "chrome_snapshot",
      producesEvidence: ["tool-result"],
    },
    {
      id: "browser.persistent-control.target",
      capabilityId: "browser.persistent-control",
      parentNodeId: "browser.persistent-control.inspect",
      name: "Choose deterministic target",
      description: "Prefer an exact accessibility reference or scoped selector; do not guess among duplicate controls.",
      kind: "decision",
    },
    {
      id: "browser.persistent-control.act",
      capabilityId: "browser.persistent-control",
      parentNodeId: "browser.persistent-control.target",
      name: "Perform interaction",
      description: "Navigate, click, type or press a key against the selected target.",
      kind: "external-action",
      toolName: "chrome_click",
    },
    {
      id: "browser.persistent-control.visual-fallback",
      capabilityId: "browser.persistent-control",
      parentNodeId: "browser.persistent-control.target",
      name: "Use visual fallback",
      description: "Use computer_use only when deterministic page controls cannot reach the requested target.",
      kind: "operation",
      toolName: "computer_use",
    },
    {
      id: "browser.persistent-control.verify",
      capabilityId: "browser.persistent-control",
      parentNodeId: "browser.persistent-control.target",
      name: "Verify page state",
      description: "Re-read the page, inspect the DOM or capture a selective screenshot.",
      kind: "verification",
      toolName: "chrome_read_page",
      producesEvidence: ["dom-confirmation", "tool-result"],
    },
    {
      id: "browser.persistent-control.report",
      capabilityId: "verification.outcome-evidence",
      parentNodeId: "browser.persistent-control.open",
      name: "Report evidenced outcome",
      description: "Distinguish a confirmed result from a partial or failed action.",
      kind: "result",
      producesEvidence: ["task-event"],
    },
    {
      id: "browser.persistent-control.stop",
      capabilityId: "browser.persistent-control",
      parentNodeId: "browser.persistent-control.open",
      name: "Stop on unavailable or ambiguous state",
      description: "Do not claim the browser is visible or a page changed when attachment, targeting or verification failed.",
      kind: "stop",
      producesEvidence: ["tool-result"],
    },
  ],
  edges: [
    { id: "browser.persistent-control.e1", from: "browser.persistent-control.open", to: "browser.persistent-control.inspect", kind: "next" },
    { id: "browser.persistent-control.e2", from: "browser.persistent-control.open", to: "browser.persistent-control.stop", kind: "stop", label: "attachment failed" },
    { id: "browser.persistent-control.e3", from: "browser.persistent-control.inspect", to: "browser.persistent-control.target", kind: "next" },
    { id: "browser.persistent-control.e4", from: "browser.persistent-control.target", to: "browser.persistent-control.act", kind: "branch", label: "exact target" },
    { id: "browser.persistent-control.e5", from: "browser.persistent-control.target", to: "browser.persistent-control.visual-fallback", kind: "fallback", label: "no deterministic target" },
    { id: "browser.persistent-control.e6", from: "browser.persistent-control.act", to: "browser.persistent-control.verify", kind: "verification" },
    { id: "browser.persistent-control.e7", from: "browser.persistent-control.visual-fallback", to: "browser.persistent-control.verify", kind: "verification" },
    { id: "browser.persistent-control.e8", from: "browser.persistent-control.verify", to: "browser.persistent-control.act", kind: "retry", label: "Target did not change as expected" },
    { id: "browser.persistent-control.e9", from: "browser.persistent-control.verify", to: "browser.persistent-control.report", kind: "next", label: "Evidence is sufficient" },
    { id: "browser.persistent-control.e10", from: "browser.persistent-control.verify", to: "browser.persistent-control.stop", kind: "stop", label: "verification failed" },
  ],
};

const instagramSendWorkflow: ExplorerWorkflow = {
  id: "instagram.send-dm.workflow",
  name: "Send a verified Instagram DM",
  description: "Resolve the intended person, enter the correct thread, submit exact text and verify it.",
  entryNodeId: "instagram.send-dm.session",
  nodes: [
    {
      id: "instagram.send-dm.resolve",
      capabilityId: "people.identity-resolution",
      parentNodeId: "instagram.send-dm.session",
      name: "Resolve recipient",
      description: "Resolve a known alias or require an explicit username rather than guessing.",
      kind: "decision",
      toolName: "person_list",
    },
    {
      id: "instagram.send-dm.session",
      capabilityId: "instagram.connection",
      name: "Check Instagram session",
      description: "Confirm the persistent browser is logged in or identify login/2FA setup.",
      kind: "verification",
      toolName: "instagram_status",
      producesEvidence: ["tool-result", "dom-confirmation"],
    },
    {
      id: "instagram.send-dm.route",
      capabilityId: "instagram.send-dm",
      parentNodeId: "instagram.send-dm.resolve",
      name: "Choose thread route",
      description: "Use a learned thread ID when valid; otherwise discover the exact username through the compose dialog.",
      kind: "decision",
    },
    {
      id: "instagram.send-dm.fast-path",
      capabilityId: "instagram.send-dm",
      parentNodeId: "instagram.send-dm.route",
      name: "Navigate learned thread",
      description: "Open the stored /direct/t/<id>/ URL and wait for the same thread ID after hydration.",
      kind: "operation",
      toolName: "instagram_open_chat",
      producesEvidence: ["dom-confirmation", "tool-result"],
    },
    {
      id: "instagram.send-dm.discover",
      capabilityId: "instagram.send-dm",
      parentNodeId: "instagram.send-dm.route",
      name: "Discover exact thread",
      description: "Search the compose dialog by accessibility reference, exact username token and Chat/Next control.",
      kind: "operation",
      toolName: "instagram_open_chat",
      producesEvidence: ["dom-confirmation", "tool-result"],
    },
    {
      id: "instagram.send-dm.open",
      capabilityId: "instagram.messaging",
      parentNodeId: "instagram.send-dm.route",
      name: "Confirm and learn thread",
      description: "Require a real thread URL and persist a new thread ID only after successful discovery.",
      kind: "verification",
      toolName: "instagram_open_chat",
      producesEvidence: ["dom-confirmation", "tool-result"],
    },
    {
      id: "instagram.send-dm.submit",
      capabilityId: "instagram.send-dm",
      parentNodeId: "instagram.send-dm.open",
      name: "Submit exact message",
      description: "Send the requested text verbatim to the resolved person.",
      kind: "external-action",
      toolName: "instagram_send_dm",
    },
    {
      id: "instagram.send-dm.verify",
      capabilityId: "instagram.send-dm",
      parentNodeId: "instagram.send-dm.open",
      name: "Verify appearance",
      description: "Require the sent message to appear in the active conversation.",
      kind: "verification",
      toolName: "instagram_send_dm",
      producesEvidence: ["dom-confirmation", "tool-result"],
    },
    {
      id: "instagram.send-dm.stop",
      capabilityId: "instagram.send-dm",
      parentNodeId: "instagram.send-dm.session",
      name: "Stop for missing identity or login",
      description: "Do not send when recipient identity or authentication cannot be established.",
      kind: "stop",
    },
  ],
  edges: [
    { id: "instagram.send-dm.e1", from: "instagram.send-dm.session", to: "instagram.send-dm.resolve", kind: "next", label: "Authenticated" },
    { id: "instagram.send-dm.e2", from: "instagram.send-dm.resolve", to: "instagram.send-dm.stop", kind: "stop", label: "Identity missing" },
    { id: "instagram.send-dm.e3", from: "instagram.send-dm.resolve", to: "instagram.send-dm.route", kind: "next", label: "Recipient resolved" },
    { id: "instagram.send-dm.e4", from: "instagram.send-dm.session", to: "instagram.send-dm.stop", kind: "stop", label: "Login or 2FA required" },
    { id: "instagram.send-dm.e5", from: "instagram.send-dm.route", to: "instagram.send-dm.fast-path", kind: "branch", label: "Learned thread ID" },
    { id: "instagram.send-dm.e6", from: "instagram.send-dm.route", to: "instagram.send-dm.discover", kind: "fallback", label: "Missing or dead thread" },
    { id: "instagram.send-dm.e7", from: "instagram.send-dm.fast-path", to: "instagram.send-dm.open", kind: "verification" },
    { id: "instagram.send-dm.e8", from: "instagram.send-dm.discover", to: "instagram.send-dm.open", kind: "verification" },
    { id: "instagram.send-dm.e9", from: "instagram.send-dm.open", to: "instagram.send-dm.submit", kind: "next" },
    { id: "instagram.send-dm.e10", from: "instagram.send-dm.submit", to: "instagram.send-dm.verify", kind: "verification" },
  ],
};

const whatsappSendWorkflow: ExplorerWorkflow = {
  id: "whatsapp.send-message.workflow",
  name: "Send a verified WhatsApp message",
  description: "Resolve the contact, verify the chat header, submit exact text and confirm appearance.",
  entryNodeId: "whatsapp.send-message.session",
  nodes: [
    {
      id: "whatsapp.send-message.resolve",
      capabilityId: "people.identity-resolution",
      parentNodeId: "whatsapp.send-message.session",
      name: "Resolve recipient",
      description: "Resolve a known person, display name or phone number.",
      kind: "decision",
      toolName: "person_list",
    },
    {
      id: "whatsapp.send-message.session",
      capabilityId: "whatsapp.connection",
      name: "Check linked session",
      description: "Confirm WhatsApp Web is linked or report that QR scanning is required.",
      kind: "verification",
      toolName: "whatsapp_status",
      producesEvidence: ["tool-result", "dom-confirmation"],
    },
    {
      id: "whatsapp.send-message.search",
      capabilityId: "whatsapp.send-message",
      parentNodeId: "whatsapp.send-message.resolve",
      name: "Search chat list",
      description: "Use the resolved display name or phone in the scoped chat-list search control.",
      kind: "operation",
      toolName: "whatsapp_open_chat",
    },
    {
      id: "whatsapp.send-message.select",
      capabilityId: "whatsapp.send-message",
      parentNodeId: "whatsapp.send-message.resolve",
      name: "Select exact result row",
      description: "Choose an exact quoted accessibility-tree name, never a substring match or similarly named group.",
      kind: "operation",
      toolName: "whatsapp_open_chat",
    },
    {
      id: "whatsapp.send-message.open",
      capabilityId: "whatsapp.messaging",
      parentNodeId: "whatsapp.send-message.resolve",
      name: "Open and verify chat",
      description: "Search for the contact and verify the conversation header before typing.",
      kind: "operation",
      toolName: "whatsapp_open_chat",
      producesEvidence: ["dom-confirmation"],
    },
    {
      id: "whatsapp.send-message.submit",
      capabilityId: "whatsapp.send-message",
      parentNodeId: "whatsapp.send-message.open",
      name: "Submit exact message",
      description: "Send the requested text only in the verified conversation.",
      kind: "external-action",
      toolName: "whatsapp_send_message",
    },
    {
      id: "whatsapp.send-message.verify",
      capabilityId: "whatsapp.send-message",
      parentNodeId: "whatsapp.send-message.open",
      name: "Verify appearance",
      description: "Require the sent message to appear in the conversation before claiming success.",
      kind: "verification",
      toolName: "whatsapp_send_message",
      producesEvidence: ["dom-confirmation", "tool-result"],
    },
    {
      id: "whatsapp.send-message.stop",
      capabilityId: "whatsapp.send-message",
      parentNodeId: "whatsapp.send-message.session",
      name: "Stop for missing identity or QR",
      description: "Do not send when the recipient or linked session cannot be verified.",
      kind: "stop",
    },
  ],
  edges: [
    { id: "whatsapp.send-message.e1", from: "whatsapp.send-message.session", to: "whatsapp.send-message.resolve", kind: "next", label: "Session linked" },
    { id: "whatsapp.send-message.e2", from: "whatsapp.send-message.resolve", to: "whatsapp.send-message.stop", kind: "stop", label: "Identity missing" },
    { id: "whatsapp.send-message.e3", from: "whatsapp.send-message.resolve", to: "whatsapp.send-message.search", kind: "next", label: "Recipient resolved" },
    { id: "whatsapp.send-message.e4", from: "whatsapp.send-message.session", to: "whatsapp.send-message.stop", kind: "stop", label: "QR required" },
    { id: "whatsapp.send-message.e5", from: "whatsapp.send-message.search", to: "whatsapp.send-message.select", kind: "next" },
    { id: "whatsapp.send-message.e6", from: "whatsapp.send-message.select", to: "whatsapp.send-message.open", kind: "verification" },
    { id: "whatsapp.send-message.e7", from: "whatsapp.send-message.open", to: "whatsapp.send-message.submit", kind: "next" },
    { id: "whatsapp.send-message.e8", from: "whatsapp.send-message.submit", to: "whatsapp.send-message.verify", kind: "verification" },
  ],
};

const capabilities: ExplorerCapability[] = [
  {
    id: "conversation.text-turn",
    domainId: "conversation",
    name: "Streaming text conversation",
    shortName: "Text chat",
    description: "Authenticated, session-based text turns whose progress and final answer stream to the client.",
    purpose: "Let Sir converse with AVA while retaining task progress, tool activity and durable session history.",
    stability: "core",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/routes/chat.ts", "chatRoutes", "route"),
        source("web/src/chat/useChatStream.ts", "useChatStream"),
        source("server/src/routes/chat-persist.test.ts", "chat persistence", "test"),
      ],
    },
    examples: ["Explain this simply.", "Plan my day.", "Research this and report what you verified."],
    inputs: [
      { name: "text", description: "The user's request.", required: true, sensitive: true },
      { name: "sessionId", description: "An existing conversation to continue.", required: false, sensitive: true },
    ],
    outputs: [
      { name: "stream events", description: "Incremental agent, tool, approval and final events." },
      { name: "session messages", description: "Persisted user and assistant messages.", persistent: true },
    ],
    dependencies: [
      { targetType: "capability", targetId: "orchestration.agent-loop", relationship: "uses", required: true, description: "Runs each actionable turn through the agent loop." },
      { targetType: "data-store", targetId: "sqlite.sessions", relationship: "writes-to", required: true, description: "Persists sessions and messages." },
    ],
    readiness: readiness(["defined", "configured", "available", "healthy", "tested"], { recentSuccess: true }),
    verification: verification(
      ["The authenticated request creates or continues exactly one session.", "A final or explicit terminal event is streamed and persisted."],
      ["api-response", "task-event"],
      ["A final model response alone does not verify any external actions described inside it."],
    ),
    safety: safety("mixed", "policy-dependent", ["Creates persistent chat and task history."], {
      sensitiveData: ["Conversation content", "Referenced people, files and projects"],
      stopConditions: ["Stop immediately on user cancellation.", "Do not report external success without operation-specific evidence."],
    }),
    runtime: runtime(
      [],
      [{ path: "core.brain.ready", dimension: "configured", interpretation: "boolean" }],
      ["/api/chat", "/api/sessions"],
    ),
    workflow: conversationWorkflow,
  },
  {
    id: "voice.realtime",
    domainId: "voice",
    name: "Realtime voice conversation",
    shortName: "Realtime voice",
    description: "A continuous speech session with transcription, server voice events, interruption and action handoff.",
    purpose: "Provide low-latency spoken conversation while preserving access to AVA's full action agent.",
    stability: "beta",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/routes/voice-realtime.ts", "buildRealtimeProxy", "route"),
        source("web/src/voice/useRealtimeVoice.ts", "useRealtimeVoice"),
        source("web/src/voice/useRealtimeVoice.barge-in.test.ts", "barge-in", "test"),
        source("docs/architecture/06-voice-pipeline.md", "Voice pipeline", "documentation"),
      ],
    },
    examples: ["Talk through this idea with me.", "Open the browser while I explain what I need.", "Stop speaking."],
    inputs: [
      { name: "microphone audio", description: "Live audio from the selected microphone.", required: true, sensitive: true },
      { name: "input mode", description: "Voice activity detection or push-to-talk.", required: false },
    ],
    outputs: [
      { name: "assistant audio", description: "Realtime model audio played by the client." },
      { name: "captions", description: "User and assistant transcript captions." },
      { name: "delegated action result", description: "The full agent's result returned to the voice session." },
    ],
    dependencies: [
      { targetType: "model", targetId: "openai.realtime", relationship: "depends-on", required: true, description: "Provides the continuous realtime conversation." },
      { targetType: "capability", targetId: "conversation.text-turn", relationship: "uses", required: true, description: "Delegates computer actions to the full agent route." },
      { targetType: "permission", targetId: "browser.microphone", relationship: "requires", required: true, description: "The browser must allow microphone access." },
    ],
    readiness: readiness(["defined", "configured", "available", "healthy", "tested"], { recentSuccess: true }),
    verification: verification(
      ["The realtime connection reaches an active state.", "Audio output is tied to the current uncancelled response.", "A barge-in stops queued playback and cancels the active response."],
      ["api-response", "task-event", "unit-test"],
      ["Client playback success cannot prove that the user heard or understood the audio."],
    ),
    safety: safety("mixed", "policy-dependent", ["Captures microphone audio.", "May delegate an action to the full tool agent."], {
      sensitiveData: ["Microphone audio", "Voice transcripts", "Conversation context"],
      stopConditions: ["Cancel response and playback on a valid user interruption.", "Stop action handoff when the user cancels the task."],
    }),
    runtime: runtime(
      ["do_on_computer"],
      [
        { path: "core.voice.ready", dimension: "configured", interpretation: "boolean" },
        { path: "core.voice.model", dimension: "available", interpretation: "non-null" },
      ],
      ["/api/transcribe", "/api/speak"],
    ),
  },
  {
    id: "interpretation.request-mode",
    domainId: "interpretation",
    name: "Request and mode interpretation",
    shortName: "Request mode",
    description: "Builds turn context and distinguishes direct conversation from work that needs AVA's action loop.",
    purpose: "Translate natural language into a grounded objective without pretending that a separate deterministic intent classifier exists.",
    stability: "core",
    definition: {
      implementation: "partial",
      sourceReferences: [
        source("server/src/orchestrator/system-prompt.ts", "buildSystemPrompt"),
        source("server/src/orchestrator/tool-rubric.ts", "TOOL_RUBRIC"),
        source("server/src/routes/chat.ts", "chatRoutes", "route"),
      ],
    },
    examples: ["Talk this through without changing anything.", "Open Chrome.", "Remember this preference."],
    inputs: [{ name: "request", description: "Natural-language user input plus current conversation context.", required: true, sensitive: true }],
    outputs: [{ name: "model-directed objective", description: "The objective and operational mode represented in the agent turn." }],
    dependencies: [
      { targetType: "model", targetId: "configured.chat-provider", relationship: "depends-on", required: true, description: "Interpretation is model-guided rather than a standalone parser." },
      { targetType: "capability", targetId: "memory.durable", relationship: "reads-from", required: false, description: "Relevant preferences and project context inform interpretation." },
    ],
    readiness: readiness(["defined", "configured", "available", "tested"]),
    verification: verification(
      ["The interpreted objective remains traceable to the original request.", "Instruction changes are represented as later events rather than rewriting the request."],
      ["task-event", "unit-test"],
      ["There is not yet a persisted, first-class parsed-objective record for every task."],
      false,
    ),
    safety: safety("low", "never", [], {
      sensitiveData: ["User request and conversation context"],
      stopConditions: ["Ask for clarification when ambiguity would materially change an external action."],
    }),
    runtime: runtime([], [{ path: "core.brain.ready", dimension: "configured", interpretation: "boolean" }]),
  },
  {
    id: "orchestration.agent-loop",
    domainId: "orchestration",
    name: "Agent loop and tool selection",
    shortName: "Agent loop",
    description: "Repeatedly invokes the configured model, dispatches valid tool calls and stops on completion, cancellation or failure.",
    purpose: "Compose AVA's individual tools into multi-step work with timeouts, no-progress protection and user interruption.",
    stability: "core",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/orchestrator/agent.ts", "runAgent"),
        source("server/src/orchestrator/tool-registry.ts", "buildToolRegistry"),
        source("server/src/orchestrator/timeout.ts", "tool timeout budgets"),
        source("server/src/orchestrator/agent-v2.test.ts", "runAgent", "test"),
      ],
    },
    examples: ["Research three options and compare them.", "Fix this project and run its tests.", "Open the correct chat and send this message."],
    inputs: [
      { name: "messages", description: "System, memory, playbook and conversation messages.", required: true, sensitive: true },
      { name: "tool registry", description: "The tools made available for this turn.", required: true },
    ],
    outputs: [
      { name: "tool calls and results", description: "Ordered operational activity for the turn." },
      { name: "final response", description: "A terminal model response or explicit failure." },
    ],
    dependencies: [
      { targetType: "model", targetId: "configured.chat-provider", relationship: "depends-on", required: true, description: "A configured OpenAI or Anthropic provider is required." },
      { targetType: "capability", targetId: "security.risk-policy", relationship: "uses", required: true, description: "Every consequential tool dispatch passes through policy." },
      { targetType: "capability", targetId: "verification.outcome-evidence", relationship: "uses", required: true, description: "Final claims should reflect tool evidence." },
    ],
    readiness: readiness(["defined", "configured", "available", "healthy", "tested"], { recentSuccess: true }),
    verification: verification(
      ["Malformed tool arguments never reach a tool.", "User cancellation reaches running operations.", "The run terminates with a recorded final or failure state."],
      ["unit-test", "task-event", "tool-result"],
      ["The current runtime does not yet emit every Explorer event type proposed in the product vision."],
    ),
    safety: safety("mixed", "policy-dependent", ["May invoke any tool registered for the current mode."], {
      sensitiveData: ["Conversation context", "Tool inputs and outputs"],
      stopConditions: ["Stop on explicit cancellation.", "Stop or change approach after no measurable progress.", "Never dispatch malformed tool arguments."],
    }),
    runtime: runtime([], [{ path: "core.brain.ready", dimension: "configured", interpretation: "boolean" }], ["/api/chat"]),
  },
  {
    id: "browser.persistent-control",
    domainId: "browser",
    name: "Persistent AVA Chrome control",
    shortName: "AVA Chrome",
    description: "Opens and drives AVA's separate, visible Chromium profile with durable logins.",
    purpose: "Perform deterministic browser work in the browser profile Sir has prepared for AVA.",
    stability: "core",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/tools/chrome.ts", "buildChrome"),
        source("server/src/tools/chrome-mcp.ts", "buildChromeTools"),
        source("server/src/tools/chrome-mcp.test.ts", "buildChromeTools", "test"),
        source("scripts/start-ava-browser.ps1", "AVA browser launcher"),
      ],
    },
    examples: ["Open AVA Chrome.", "Read this page.", "Fill in this form and verify the result."],
    inputs: [
      { name: "URL", description: "Optional page to navigate to.", required: false, sensitive: true },
      { name: "selector or accessibility reference", description: "A target element for interaction.", required: false },
      { name: "text", description: "Text to enter into the selected page field.", required: false, sensitive: true },
    ],
    outputs: [
      { name: "page state", description: "Titles, visible text, accessibility snapshot or tab list." },
      { name: "browser artifacts", description: "Selective page screenshots.", persistent: true },
    ],
    dependencies: [
      { targetType: "application", targetId: "ava.chromium", relationship: "depends-on", required: true, description: "A visible browser process using AVA's persistent profile." },
      { targetType: "process", targetId: "chrome.devtools-endpoint", relationship: "depends-on", required: true, description: "The runtime attaches to the dedicated browser context." },
      { targetType: "capability", targetId: "security.risk-policy", relationship: "uses", required: true, description: "Submit and purchase-like clicks can require approval." },
    ],
    readiness: readiness(["defined", "configured", "available", "healthy", "tested"], { authentication: true, recentSuccess: true }),
    verification: verification(
      ["The dedicated AVA browser is visible and responsive.", "A page action is followed by a DOM, title, text or screenshot check appropriate to the task."],
      ["tool-result", "dom-confirmation", "visual-confirmation"],
      ["Browser attachment does not prove that any particular website account is logged in."],
    ),
    safety: safety("mixed", "policy-dependent", ["Navigates pages.", "May submit forms or change remote website state.", "Creates page screenshots."], {
      sensitiveData: ["Persistent browser cookies", "Page content", "Typed form values"],
      stopConditions: ["Stop before a consequential submit when approval is required.", "Stop when the browser target cannot be identified unambiguously."],
    }),
    runtime: runtime(
      ["chrome_open", "chrome_navigate", "chrome_click", "chrome_type", "chrome_press_key", "chrome_snapshot", "chrome_read_page", "chrome_screenshot", "chrome_tabs", "computer_use"],
      [
        { path: "core.browser.ready", dimension: "available", interpretation: "boolean" },
        { path: "core.browser.mode", dimension: "healthy", interpretation: "attached" },
      ],
      ["/api/capabilities"],
    ),
    workflow: browserWorkflow,
  },
  {
    id: "desktop.native-control",
    domainId: "desktop",
    name: "Native application control",
    shortName: "App control",
    description: "Launches and drives Windows applications with PowerShell, UI Automation and keystrokes.",
    purpose: "Operate native applications when a dedicated API or browser workflow is unavailable.",
    stability: "beta",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/tools/control-app-mcp.ts", "buildControlAppTool"),
        source("server/src/tools/control-app-mcp.test.ts", "buildControlAppTool", "test"),
        source("server/src/tools/shell-tool.ts", "buildShellTool"),
      ],
    },
    examples: ["Open Spotify.", "Focus WhatsApp.", "Use the search box in this Windows app."],
    inputs: [{ name: "PowerShell UI Automation script", description: "A bounded local application-control sequence.", required: true, sensitive: true }],
    outputs: [{ name: "process output", description: "Sanitised stdout, stderr and success state." }],
    dependencies: [
      { targetType: "application", targetId: "windows.desktop", relationship: "depends-on", required: true, description: "Requires the interactive Windows desktop session." },
      { targetType: "capability", targetId: "vision.screen-inspection", relationship: "verifies-with", required: false, description: "Visual inspection can verify the resulting UI state." },
      { targetType: "capability", targetId: "security.risk-policy", relationship: "uses", required: true, description: "Scripts pass through the command safety gate." },
    ],
    readiness: readiness(["defined", "available", "healthy", "tested"], { recentSuccess: true }),
    verification: verification(
      ["The target application or window is identified.", "A return value or visual inspection confirms the requested state."],
      ["exit-code", "visual-confirmation", "tool-result"],
      ["Keystroke delivery alone is not proof that the intended control received the input."],
    ),
    safety: safety("mixed", "policy-dependent", ["Launches applications.", "Can type into and modify state inside native applications."], {
      sensitiveData: ["Window titles", "Typed content", "Visible application content"],
      stopConditions: ["Stop when the active target window cannot be verified.", "Stop before an irreversible in-app action without required approval."],
    }),
    runtime: runtime(["control_app", "shell"]),
  },
  {
    id: "shell-files.shell",
    domainId: "shell-files",
    name: "PowerShell execution",
    shortName: "Shell",
    description: "Runs bounded commands and launches local processes through PowerShell.",
    purpose: "Inspect, build and operate the local computer using native command-line tools.",
    stability: "core",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/tools/shell-tool.ts", "buildShellTool"),
        source("server/src/tools/shell.ts", "runShell"),
        source("server/src/tools/shell.test.ts", "shell", "test"),
      ],
    },
    examples: ["Run the test suite.", "Show the Git status.", "Launch this application."],
    inputs: [{ name: "command", description: "A PowerShell command within the runtime safety policy.", required: true, sensitive: true }],
    outputs: [{ name: "command result", description: "Sanitised stdout, stderr, exit status and timeout state." }],
    dependencies: [
      { targetType: "application", targetId: "windows.powershell", relationship: "depends-on", required: true, description: "Commands execute through Windows PowerShell." },
      { targetType: "capability", targetId: "security.risk-policy", relationship: "uses", required: true, description: "Commands are classified and may be denied or approved." },
    ],
    readiness: readiness(["defined", "available", "healthy", "tested"], { recentSuccess: true }),
    verification: verification(
      ["The process exits or is explicitly terminated.", "Exit code and sanitised output are recorded."],
      ["exit-code", "tool-result"],
      ["Exit code zero does not by itself prove a GUI or remote side effect occurred."],
    ),
    safety: safety("mixed", "policy-dependent", ["Runs local processes and may modify computer state."], {
      sensitiveData: ["Command arguments", "Process output", "Local paths"],
      stopConditions: ["Block environment-secret access.", "Stop and request approval for policy-classified consequential commands."],
    }),
    runtime: runtime(["shell"]),
  },
  {
    id: "shell-files.filesystem",
    domainId: "shell-files",
    name: "Allowlisted filesystem operations",
    shortName: "Files",
    description: "Reads, lists, stats, writes and deletes paths inside configured roots.",
    purpose: "Manipulate project and personal files while enforcing path and secret boundaries.",
    stability: "core",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/tools/filesystem-mcp.ts", "buildFilesystemTools"),
        source("server/src/tools/filesystem.ts", "buildFilesystem"),
        source("server/src/tools/filesystem.test.ts", "filesystem", "test"),
        source("server/src/security/path-allowlist.ts", "buildPathAllowlist"),
      ],
    },
    examples: ["Read this file.", "Create a report.", "List this folder.", "Delete this file after I approve."],
    inputs: [
      { name: "absolute path", description: "A target inside an allowlisted root.", required: true, sensitive: true },
      { name: "content", description: "Text to write for a write operation.", required: false, sensitive: true },
    ],
    outputs: [
      { name: "file content or metadata", description: "Sanitised content, listing or stat data." },
      { name: "filesystem change", description: "A created, updated or deleted file.", persistent: true },
    ],
    dependencies: [
      { targetType: "permission", targetId: "filesystem.allowlisted-roots", relationship: "requires", required: true, description: "Every path must remain inside a configured root." },
      { targetType: "capability", targetId: "security.risk-policy", relationship: "uses", required: true, description: "Secret paths are blocked and deletions require approval." },
    ],
    readiness: readiness(["defined", "configured", "available", "healthy", "tested"], { recentSuccess: true }),
    verification: verification(
      ["The resolved path stays within an allowlisted root.", "Writes and deletes are followed by direct operation success and, when important, stat or hash evidence."],
      ["tool-result", "artifact", "unit-test"],
      ["Text writes currently overwrite an existing file; preserving a diff is an Explorer instrumentation concern."],
    ),
    safety: safety("mixed", "policy-dependent", ["Reads and writes persistent local files.", "Deletes a single file or empty directory."], {
      sensitiveData: ["File paths", "File contents"],
      stopConditions: ["Block known secret paths even when they are under an allowed root.", "Require approval for deletion.", "Stop on path ambiguity."],
    }),
    runtime: runtime(["fs_read", "fs_write", "fs_list", "fs_stat", "fs_delete"]),
  },
  {
    id: "coding.project-work",
    domainId: "coding",
    name: "Coding and repository work",
    shortName: "Project work",
    description: "Combines repository inspection, file edits, commands and a bounded Claude Code worker.",
    purpose: "Implement, diagnose and verify software changes inside an explicitly selected project.",
    stability: "beta",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/tools/claude-code-mcp.ts", "buildClaudeCodeTool"),
        source("server/src/tools/claude-code.ts", "buildClaudeCode"),
        source("server/src/tools/claude-code.test.ts", "claude-code", "test"),
      ],
    },
    examples: ["Debug this application.", "Implement this feature and test it.", "Review this repository without changing it."],
    inputs: [
      { name: "project directory", description: "An allowlisted repository root.", required: true, sensitive: true },
      { name: "task", description: "The bounded coding objective.", required: true, sensitive: true },
    ],
    outputs: [
      { name: "code changes", description: "Files changed within the chosen project.", persistent: true },
      { name: "verification results", description: "Tests, builds, diagnostics and worker output." },
    ],
    dependencies: [
      { targetType: "tool", targetId: "claude_code", relationship: "uses", required: false, description: "Delegates large multi-file implementations when selected." },
      { targetType: "capability", targetId: "shell-files.filesystem", relationship: "uses", required: true, description: "Inspects and changes project files." },
      { targetType: "capability", targetId: "shell-files.shell", relationship: "uses", required: true, description: "Runs version-control, tests and builds." },
    ],
    readiness: readiness(["defined", "configured", "available", "healthy", "tested"], { authentication: true, recentSuccess: true }),
    verification: verification(
      ["Changed files remain within the selected project.", "Relevant automated tests or builds run, with failures reported rather than hidden."],
      ["exit-code", "artifact", "unit-test", "tool-result"],
      ["Passing tests only cover the behaviours represented by those tests."],
    ),
    safety: safety("medium", "policy-dependent", ["May change many source files and run project commands."], {
      sensitiveData: ["Source code", "Repository paths", "Command output"],
      stopConditions: ["Stop when the requested project cannot be resolved.", "Do not weaken security boundaries or use dangerous permission bypasses."],
    }),
    runtime: runtime(["claude_code", "shell", "fs_read", "fs_write"]),
  },
  {
    id: "instagram.messaging",
    domainId: "instagram",
    name: "Instagram workflows",
    shortName: "Instagram",
    description: "Dedicated browser workflows for connection checks, profiles, chats and direct messages.",
    purpose: "Use deterministic Instagram operations instead of fragile generic page clicking.",
    stability: "beta",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/apps/instagram-mcp.ts", "buildInstagramTools"),
        source("server/src/apps/instagram.ts", "Instagram workflows"),
        source("server/src/apps/instagram.test.ts", "Instagram workflows", "test"),
      ],
    },
    examples: ["Check whether Instagram is connected.", "Open Lasha's profile.", "Read my chat with Lasha."],
    inputs: [{ name: "person", description: "Known person, alias, search name or explicit Instagram username.", required: false, sensitive: true }],
    outputs: [{ name: "Instagram operation result", description: "Connection, profile or conversation state with a structured success/failure reason." }],
    dependencies: [
      { targetType: "capability", targetId: "browser.persistent-control", relationship: "depends-on", required: true, description: "Instagram uses AVA's persistent browser session." },
      { targetType: "capability", targetId: "people.identity-resolution", relationship: "uses", required: false, description: "Known people map to usernames and learned thread IDs." },
    ],
    readiness: readiness(["defined", "configured", "authenticated", "available", "healthy", "tested"], { authentication: true, recentSuccess: true }),
    verification: verification(
      ["The current page is recognised as an authenticated Instagram surface before account actions.", "The selected profile or chat matches the resolved identity."],
      ["tool-result", "dom-confirmation"],
      ["The capability snapshot currently maps Instagram availability to browser readiness; the dedicated status tool is stronger authentication evidence."],
    ),
    safety: safety("mixed", "policy-dependent", ["Reads private conversation content.", "May navigate an authenticated Instagram account."], {
      sensitiveData: ["Instagram account session", "People identities", "Private messages"],
      stopConditions: ["Stop when login, 2FA or exact identity is missing.", "Never guess an account for a consequential action."],
    }),
    runtime: runtime(
      ["instagram_status", "instagram_login", "instagram_submit_code", "instagram_open_profile", "instagram_open_chat", "instagram_read_chat"],
      [{ path: "integrations.instagram", dimension: "available", interpretation: "boolean", note: "This snapshot path currently reflects browser readiness, not authenticated Instagram proof." }],
    ),
  },
  {
    id: "instagram.connection",
    domainId: "instagram",
    parentId: "instagram.messaging",
    name: "Instagram connection and authentication",
    shortName: "Connection",
    description: "Detects logged-in, login-wall and 2FA-checkpoint states and can complete an explicitly supplied login.",
    purpose: "Establish whether Instagram work is possible now and state precisely what setup is missing.",
    stability: "beta",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/apps/instagram.ts", "ensureReady"),
        source("server/src/apps/instagram.ts", "login"),
        source("server/src/apps/instagram.ts", "submitCode"),
      ],
    },
    examples: ["Is Instagram logged in?", "Submit this Instagram verification code."],
    inputs: [
      { name: "username", description: "Account username for an explicit login operation.", required: false, sensitive: true },
      { name: "password", description: "Account password for an explicit login operation.", required: false, sensitive: true },
      { name: "verification code", description: "A current 2FA code supplied by Sir.", required: false, sensitive: true },
    ],
    outputs: [{ name: "connection state", description: "Logged in, login required, verification required or failed." }],
    dependencies: [
      { targetType: "capability", targetId: "browser.persistent-control", relationship: "depends-on", required: true, description: "Authentication lives in the persistent browser profile." },
      { targetType: "service", targetId: "instagram.com", relationship: "depends-on", required: true, description: "Instagram must be reachable." },
    ],
    readiness: readiness(["defined", "configured", "authenticated", "available", "healthy", "tested"], { authentication: true }),
    verification: verification(
      ["A recognised authenticated Instagram surface is visible after any login step."],
      ["dom-confirmation", "tool-result"],
      ["Authentication can expire after the observation; evidence must be timestamped."],
    ),
    safety: safety("medium", "policy-dependent", ["May submit credentials and one-time codes to Instagram."], {
      sensitiveData: ["Instagram username", "Password", "One-time verification code", "Session cookies"],
      redactions: ["Passwords, one-time codes and session values must be redacted before events are persisted."],
      stopConditions: ["Stop on an unrecognised challenge or repeated authentication failure."],
    }),
    runtime: runtime(["instagram_status", "instagram_login", "instagram_submit_code"]),
  },
  {
    id: "instagram.send-dm",
    domainId: "instagram",
    parentId: "instagram.messaging",
    name: "Send a verified Instagram direct message",
    shortName: "Send DM",
    description: "Resolves the intended recipient, opens the correct thread, sends exact text and verifies its appearance.",
    purpose: "Send a message only when recipient and completion can both be evidenced.",
    stability: "beta",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/apps/instagram.ts", "sendDm"),
        source("server/src/apps/instagram-mcp.ts", "instagram_send_dm"),
        source("server/src/apps/instagram.test.ts", "sendDm", "test"),
      ],
    },
    examples: ["Message Lasha saying I will call in ten minutes."],
    inputs: [
      { name: "person", description: "Known name, alias or Instagram username.", required: true, sensitive: true },
      { name: "text", description: "Message text to send verbatim.", required: true, sensitive: true },
    ],
    outputs: [
      { name: "remote message", description: "A message added to the verified Instagram conversation.", persistent: true },
      { name: "send result", description: "Success only when the message is visible, otherwise an actionable failure." },
    ],
    dependencies: [
      { targetType: "capability", targetId: "instagram.connection", relationship: "depends-on", required: true, description: "A current authenticated session is required." },
      { targetType: "capability", targetId: "people.identity-resolution", relationship: "uses", required: false, description: "Known names and aliases resolve to app identity." },
      { targetType: "capability", targetId: "verification.outcome-evidence", relationship: "verifies-with", required: true, description: "Visible message appearance is required before success." },
    ],
    readiness: readiness(["defined", "configured", "authenticated", "available", "healthy", "tested", "recently-successful"], { authentication: true, recentSuccess: true }),
    verification: verification(
      ["Recipient identity resolves without guessing.", "The intended thread opens.", "The exact message appears in that conversation after submission."],
      ["dom-confirmation", "tool-result", "task-event"],
      ["Visible appearance is not the same as recipient read receipt or server delivery guarantee."],
    ),
    safety: safety("medium", "policy-dependent", ["Sends a persistent external message to another person."], {
      sensitiveData: ["Recipient identity", "Private message text", "Conversation content"],
      stopConditions: ["Stop on ambiguous recipient.", "Stop when login or 2FA is required.", "Never claim success if appearance verification fails."],
    }),
    runtime: runtime(["instagram_send_dm"]),
    workflow: instagramSendWorkflow,
  },
  {
    id: "whatsapp.messaging",
    domainId: "whatsapp",
    name: "WhatsApp workflows",
    shortName: "WhatsApp",
    description: "Dedicated WhatsApp Web workflows for linked-session checks, chat opening, reading and messaging.",
    purpose: "Operate WhatsApp through deterministic, identity-aware browser routines.",
    stability: "beta",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/apps/whatsapp-mcp.ts", "buildWhatsappTools"),
        source("server/src/apps/whatsapp.ts", "WhatsApp workflows"),
        source("server/src/apps/whatsapp.test.ts", "WhatsApp workflows", "test"),
      ],
    },
    examples: ["Check if WhatsApp is linked.", "Open my chat with Lasha.", "Read the latest visible messages."],
    inputs: [{ name: "person", description: "Known person, display name or phone number.", required: false, sensitive: true }],
    outputs: [{ name: "WhatsApp operation result", description: "Linked state, verified chat or visible conversation tail." }],
    dependencies: [
      { targetType: "capability", targetId: "browser.persistent-control", relationship: "depends-on", required: true, description: "WhatsApp Web runs in AVA's persistent browser." },
      { targetType: "capability", targetId: "people.identity-resolution", relationship: "uses", required: false, description: "Known names can resolve to display names or phone numbers." },
    ],
    readiness: readiness(["defined", "configured", "authenticated", "available", "healthy", "tested"], { authentication: true, recentSuccess: true }),
    verification: verification(
      ["WhatsApp Web shows a linked chat surface.", "An opened conversation header matches the intended person."],
      ["tool-result", "dom-confirmation"],
      ["The capability snapshot currently maps WhatsApp availability to browser readiness; whatsapp_status is the stronger linked-session check."],
    ),
    safety: safety("mixed", "policy-dependent", ["Reads private chat content.", "May navigate an authenticated WhatsApp account."], {
      sensitiveData: ["WhatsApp linked session", "People identities", "Private messages"],
      stopConditions: ["Stop when QR linking or exact recipient identity is missing."],
    }),
    runtime: runtime(
      ["whatsapp_status", "whatsapp_open_chat", "whatsapp_read_chat"],
      [{ path: "integrations.whatsapp", dimension: "available", interpretation: "boolean", note: "This path currently reflects browser readiness, not a verified linked WhatsApp session." }],
    ),
  },
  {
    id: "whatsapp.connection",
    domainId: "whatsapp",
    parentId: "whatsapp.messaging",
    name: "WhatsApp linked-session status",
    shortName: "Connection",
    description: "Distinguishes a linked WhatsApp Web session from the QR login screen or an incomplete load.",
    purpose: "Show whether WhatsApp work can proceed now and whether Sir needs to link the device.",
    stability: "beta",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/apps/whatsapp.ts", "ensureReady"),
        source("server/src/apps/whatsapp-mcp.ts", "whatsapp_status"),
      ],
    },
    examples: ["Is WhatsApp connected?", "Tell me if I need to scan the QR code."],
    inputs: [],
    outputs: [{ name: "linked-session state", description: "Linked, QR required, still loading or failed." }],
    dependencies: [
      { targetType: "capability", targetId: "browser.persistent-control", relationship: "depends-on", required: true, description: "The session is held by the persistent browser." },
      { targetType: "service", targetId: "web.whatsapp.com", relationship: "depends-on", required: true, description: "WhatsApp Web must be reachable." },
    ],
    readiness: readiness(["defined", "configured", "authenticated", "available", "healthy", "tested"], { authentication: true }),
    verification: verification(
      ["The page exposes a recognised linked chat surface rather than the QR screen."],
      ["dom-confirmation", "tool-result"],
      ["A linked state can expire after the observation and must be timestamped."],
    ),
    safety: safety("read-only", "never", [], {
      sensitiveData: ["Linked-session state"],
      stopConditions: ["Do not infer linked status from browser availability alone."],
    }),
    runtime: runtime(["whatsapp_status"]),
  },
  {
    id: "whatsapp.send-message",
    domainId: "whatsapp",
    parentId: "whatsapp.messaging",
    name: "Send a verified WhatsApp message",
    shortName: "Send message",
    description: "Resolves a contact, verifies the conversation header, sends exact text and checks its appearance.",
    purpose: "Prevent wrong-recipient sends and unsupported success claims.",
    stability: "beta",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/apps/whatsapp.ts", "sendMessage"),
        source("server/src/apps/whatsapp-mcp.ts", "whatsapp_send_message"),
        source("server/src/apps/whatsapp.test.ts", "sendMessage", "test"),
      ],
    },
    examples: ["WhatsApp Lasha saying I will arrive at eight."],
    inputs: [
      { name: "person", description: "Known name, alias, display name or phone number.", required: true, sensitive: true },
      { name: "text", description: "Message text to send verbatim.", required: true, sensitive: true },
    ],
    outputs: [
      { name: "remote message", description: "A message added to the verified WhatsApp conversation.", persistent: true },
      { name: "send result", description: "Verified appearance or an actionable failure." },
    ],
    dependencies: [
      { targetType: "capability", targetId: "whatsapp.connection", relationship: "depends-on", required: true, description: "A linked session is required." },
      { targetType: "capability", targetId: "people.identity-resolution", relationship: "uses", required: false, description: "Resolves Sir's name or alias for the contact." },
      { targetType: "capability", targetId: "verification.outcome-evidence", relationship: "verifies-with", required: true, description: "Conversation header and sent appearance are mandatory evidence." },
    ],
    readiness: readiness(["defined", "configured", "authenticated", "available", "healthy", "tested", "recently-successful"], { authentication: true, recentSuccess: true }),
    verification: verification(
      ["Recipient identity resolves without guessing.", "The conversation header matches the intended person before typing.", "The exact message appears after submission."],
      ["dom-confirmation", "tool-result", "task-event"],
      ["Visible appearance does not establish a read receipt."],
    ),
    safety: safety("medium", "policy-dependent", ["Sends a persistent external message to another person."], {
      sensitiveData: ["Recipient identity", "Private message text", "Conversation content"],
      stopConditions: ["Stop on an ambiguous header or recipient.", "Stop when QR linking is required.", "Never claim success after failed appearance verification."],
    }),
    runtime: runtime(["whatsapp_send_message"]),
    workflow: whatsappSendWorkflow,
  },
  {
    id: "people.identity-resolution",
    domainId: "people",
    name: "People and app identity resolution",
    shortName: "People map",
    description: "Stores names, aliases and verified Instagram or WhatsApp identifiers in a local people map.",
    purpose: "Translate Sir's natural names into the correct communication target without unsafe guessing.",
    stability: "beta",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/apps/people.ts", "listPeople/upsertPerson"),
        source("server/src/apps/instagram-mcp.ts", "buildPeopleTools"),
        source("server/src/apps/people.test.ts", "people map", "test"),
      ],
    },
    examples: ["Remember that Laz is Lasha.", "List the people you know.", "Use Lasha's verified Instagram username."],
    inputs: [
      { name: "name and aliases", description: "The human-readable identity Sir uses.", required: true, sensitive: true },
      { name: "platform identifiers", description: "Verified username, phone, display name or learned thread ID.", required: false, sensitive: true },
    ],
    outputs: [{ name: "people-map record", description: "A local identity record used by app workflows.", persistent: true }],
    dependencies: [
      { targetType: "data-store", targetId: "memory.people", relationship: "writes-to", required: true, description: "People records persist in AVA's memory directory." },
    ],
    readiness: readiness(["defined", "configured", "available", "healthy", "tested"], { recentSuccess: true }),
    verification: verification(
      ["An explicit user clarification or verified application result supports a platform identity.", "A lookup returns one unambiguous person before consequential use."],
      ["tool-result", "unit-test", "task-event"],
      ["A stored identity may become stale if a platform username or display name changes."],
    ),
    safety: safety("low", "never", ["Persists personal identity and contact metadata."], {
      sensitiveData: ["Names", "Aliases", "Usernames", "Phone numbers", "Conversation thread identifiers"],
      stopConditions: ["Do not create a consequential identity mapping from an unverified guess."],
    }),
    runtime: runtime(
      ["person_remember", "person_list"],
      [{ path: "core.memory.people", dimension: "available", interpretation: "non-zero", note: "A zero count can still mean the store is healthy but empty." }],
    ),
  },
  {
    id: "memory.durable",
    domainId: "memory",
    name: "Durable cross-session memory",
    shortName: "Durable memory",
    description: "Reads, records, refreshes, supersedes and intentionally forgets preferences, observations and project context.",
    purpose: "Carry useful, auditable knowledge across sessions without treating raw chat history as memory.",
    stability: "core",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/tools/memory-mcp.ts", "buildMemoryTools"),
        source("server/src/memory/store.ts", "memory store"),
        source("server/src/memory/remember.ts", "rememberObservation"),
        source("server/src/memory/forget.ts", "forgetLast/forgetMatch/forgetProject"),
        source("server/src/tools/memory-mcp.test.ts", "memory tools", "test"),
      ],
    },
    examples: ["Remember that I prefer concise briefings.", "What do you know about this project?", "Forget the old address."],
    inputs: [
      { name: "memory destination", description: "Preferences, observations or a named project.", required: false },
      { name: "content or match", description: "The fact to persist or the existing item to forget.", required: false, sensitive: true },
    ],
    outputs: [
      { name: "memory content", description: "Sanitised memory returned for the current turn." },
      { name: "memory mutation", description: "A persisted, refreshed, superseded or forgotten entry.", persistent: true },
    ],
    dependencies: [
      { targetType: "data-store", targetId: "memory.markdown", relationship: "reads-from", required: true, description: "Memory is stored in auditable local files." },
      { targetType: "capability", targetId: "security.secret-redaction", relationship: "uses", required: true, description: "All persisted memory passes through secret scrubbing." },
    ],
    readiness: readiness(["defined", "configured", "available", "healthy", "tested"], { recentSuccess: true }),
    verification: verification(
      ["A write is scrubbed and can be read back from the intended destination.", "A forget or supersede operation identifies the exact affected entry."],
      ["tool-result", "artifact", "unit-test"],
      ["A successful write does not prove future relevance or correctness; confidence and provenance remain important."],
    ),
    safety: safety("low", "never", ["Persists or removes personal context used by future turns."], {
      sensitiveData: ["Preferences", "Personal observations", "Project context", "People information"],
      redactions: ["Secret patterns are scrubbed at the storage boundary before persistence."],
      stopConditions: ["Refuse to persist raw secrets.", "Do not silently convert one-session content into durable memory without a reason."],
    }),
    runtime: runtime(
      ["memory_read", "memory_remember", "memory_forget"],
      [{ path: "core.memory.ready", dimension: "healthy", interpretation: "boolean" }],
      ["/api/memory"],
    ),
  },
  {
    id: "playbooks.procedural-memory",
    domainId: "playbooks",
    name: "Learned procedural playbooks",
    shortName: "Playbooks",
    description: "Captures reusable steps and lessons from completed multi-step tasks, recalls lexical matches and tracks outcomes.",
    purpose: "Make recurring work faster and less error-prone while keeping the procedure visible and removable.",
    stability: "beta",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/playbooks/capture.ts", "maybeCapture"),
        source("server/src/playbooks/match.ts", "matchPlaybook"),
        source("server/src/playbooks/store.ts", "playbook store"),
        source("server/src/playbooks/capture.test.ts", "playbook capture", "test"),
      ],
    },
    examples: ["Reuse the reliable steps from the last time.", "Show my learned workflows.", "Delete this obsolete playbook."],
    inputs: [
      { name: "completed tool trace", description: "A multi-step run that reached a final reply.", required: true, sensitive: true },
      { name: "future request tokens", description: "Keywords used for lexical recall.", required: true, sensitive: true },
    ],
    outputs: [
      { name: "playbook", description: "Trigger, keywords, steps, lessons and performance counters.", persistent: true },
      { name: "recalled procedure", description: "A matched procedure injected as task guidance." },
    ],
    dependencies: [
      { targetType: "capability", targetId: "conversation.text-turn", relationship: "reads-from", required: true, description: "Learning consumes completed run steps." },
      { targetType: "data-store", targetId: "memory.playbooks", relationship: "writes-to", required: true, description: "Playbooks persist under the memory directory." },
    ],
    readiness: readiness(["defined", "configured", "available", "healthy", "tested"], { recentSuccess: true }),
    verification: verification(
      ["A learned playbook has a canonical trigger, steps and provenance from a completed run.", "Reuse updates success, failure and duration metrics instead of duplicating the procedure."],
      ["artifact", "unit-test", "task-event"],
      ["Lexical matching can miss a pure paraphrase with no shared tokens.", "A recalled playbook is guidance, not proof that its current execution succeeded."],
    ),
    safety: safety("low", "never", ["Persists reusable operational procedures.", "Can influence future task execution."], {
      sensitiveData: ["Sanitised task steps and learned operational context"],
      stopConditions: ["Do not learn from a run that did not reach a final reply.", "Do not treat a consequential playbook as self-verifying."],
    }),
    runtime: runtime(
      [],
      [{ path: "core.memory.playbooks", dimension: "available", interpretation: "non-zero", note: "A zero count can represent a healthy but empty store." }],
      ["/api/playbooks"],
    ),
  },
  {
    id: "automation.watches",
    domainId: "automation",
    name: "Scheduled watches and monitoring",
    shortName: "Watches",
    description: "Stores recurring checks that run as real agent turns and can notify Sir when a condition triggers.",
    purpose: "Continue useful monitoring after the originating conversation ends.",
    stability: "beta",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/tools/watches-mcp.ts", "buildWatchTools"),
        source("server/src/state/watches.ts", "watch store"),
        source("server/src/watches/scheduler.ts", "watch scheduler"),
        source("server/src/watches/scheduler.test.ts", "watch scheduler", "test"),
      ],
    },
    examples: ["Tell me when this price drops.", "Check this page every hour.", "List my active watches."],
    inputs: [
      { name: "check prompt", description: "A self-contained future task.", required: true, sensitive: true },
      { name: "interval", description: "How often the task should run.", required: true },
      { name: "one-shot", description: "Whether a trigger disables the watch.", required: false },
    ],
    outputs: [
      { name: "watch record", description: "A persisted scheduled check.", persistent: true },
      { name: "check session", description: "A normal auditable AVA session for each execution.", persistent: true },
      { name: "notification", description: "A push when the marker protocol reports a trigger." },
    ],
    dependencies: [
      { targetType: "capability", targetId: "orchestration.agent-loop", relationship: "uses", required: true, description: "Each check is a real agent task." },
      { targetType: "capability", targetId: "notifications.push-approvals", relationship: "uses", required: false, description: "A configured push channel reports triggers." },
      { targetType: "process", targetId: "ava.server", relationship: "depends-on", required: true, description: "The in-process scheduler only runs while AVA is running." },
    ],
    readiness: readiness(["defined", "configured", "available", "healthy", "tested"], { recentSuccess: true }),
    verification: verification(
      ["Every check produces an auditable task session.", "Only an explicit WATCH: TRIGGERED marker sends the trigger notification."],
      ["task-event", "api-response", "unit-test"],
      ["Missed intervals are not back-filled while AVA is offline.", "Every check consumes a real agent run."],
    ),
    safety: safety("mixed", "policy-dependent", ["Creates recurring paid agent work.", "May send push notifications.", "Can delete a watch."], {
      sensitiveData: ["Monitoring target", "Check result", "Notification content"],
      stopConditions: ["Do not notify on an unclear or missing marker.", "Use a frugal interval appropriate to the request."],
    }),
    runtime: runtime(
      ["watch_create", "watch_list", "watch_delete"],
      [
        { path: "automations.schedulerReady", dimension: "configured", interpretation: "boolean" },
        { path: "automations.watches", dimension: "available", interpretation: "non-zero", note: "A zero count means no active watches, not scheduler failure." },
      ],
      ["/api/watches"],
    ),
  },
  {
    id: "notifications.push-approvals",
    domainId: "notifications",
    name: "Push notifications and approvals",
    shortName: "Push & approvals",
    description: "Routes policy decisions to the client and can deliver actionable web-push notifications.",
    purpose: "Keep Sir in control of consequential actions without hiding why AVA paused.",
    stability: "core",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/policy/enforce.ts", "enforce"),
        source("server/src/routes/approvals.ts", "approvalsRoutes", "route"),
        source("server/src/push/deliver.ts", "buildDeliverer"),
        source("web/src/approvals/ApprovalCard.tsx", "ApprovalCard"),
      ],
    },
    examples: ["Approve this consequential action.", "Deny the request.", "Notify me when the watch triggers."],
    inputs: [
      { name: "approval request", description: "Action summary, risk and sanitised arguments.", required: false, sensitive: true },
      { name: "decision", description: "Approve or deny.", required: false },
    ],
    outputs: [
      { name: "policy decision", description: "A persisted approval resolution." },
      { name: "push notification", description: "An optional device notification with a safe summary." },
    ],
    dependencies: [
      { targetType: "capability", targetId: "security.risk-policy", relationship: "depends-on", required: true, description: "Policy determines when a decision is needed." },
      { targetType: "service", targetId: "web-push", relationship: "depends-on", required: false, description: "VAPID configuration and a live subscription are required for push." },
    ],
    readiness: readiness(["defined", "configured", "authenticated", "available", "healthy", "tested"], { authentication: true, recentSuccess: true }),
    verification: verification(
      ["A decision is tied to the exact pending approval.", "A tool resumes only after a valid approval or stops after denial/expiry."],
      ["api-response", "task-event", "unit-test"],
      ["A successful push send does not prove the device displayed or the user read it."],
    ),
    safety: safety("mixed", "always", ["Can authorize or deny an external action.", "Stores device subscriptions and approval state."], {
      sensitiveData: ["Push subscription endpoints", "Sanitised action arguments"],
      stopConditions: ["Never treat timeout or missing decision as approval.", "Do not place raw secrets in approval summaries or pushes."],
    }),
    runtime: runtime(
      [],
      [{ path: "integrations.push", dimension: "configured", interpretation: "boolean" }],
      ["/api/approvals/pending", "/api/push/subscribe"],
    ),
  },
  {
    id: "vision.screen-inspection",
    domainId: "vision",
    name: "Desktop capture and visual inspection",
    shortName: "Screen vision",
    description: "Captures the Windows desktop and, when configured, analyses it with a multimodal model.",
    purpose: "Let AVA describe or verify visible state honestly, while distinguishing capture from actual visual analysis.",
    stability: "beta",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/tools/screenshot/screenshot-mcp.ts", "buildScreenshotTool"),
        source("server/src/tools/screenshot/look-mcp.ts", "buildLookAtScreenTool"),
        source("server/src/tools/screenshot/screenshot.test.ts", "screenshot", "test"),
      ],
    },
    examples: ["What is on my screen?", "Check whether the dialog succeeded.", "Take a screenshot."],
    inputs: [{ name: "visual question", description: "Optional question that focuses the analysis.", required: false, sensitive: true }],
    outputs: [
      { name: "desktop screenshot", description: "A local PNG path; capture alone does not mean the model saw it.", persistent: true },
      { name: "visual description", description: "A short model analysis when look_at_screen is available." },
    ],
    dependencies: [
      { targetType: "application", targetId: "windows.desktop", relationship: "depends-on", required: true, description: "The interactive desktop must be capturable." },
      { targetType: "model", targetId: "openai.multimodal", relationship: "depends-on", required: false, description: "Visual analysis requires a configured multimodal model." },
    ],
    readiness: readiness(["defined", "configured", "available", "healthy", "tested"], { recentSuccess: true }),
    verification: verification(
      ["Capture returns an existing artifact path.", "Visual claims are made only from look_at_screen analysis, not from the path-only screenshot tool."],
      ["artifact", "visual-confirmation", "tool-result"],
      ["A model description can be imperfect and should be scoped to the supplied question and visible pixels."],
    ),
    safety: safety("medium", "policy-dependent", ["Captures potentially private desktop pixels.", "May incur a paid vision request."], {
      sensitiveData: ["Desktop pixels", "Window content", "Visible notifications and account information"],
      stopConditions: ["Avoid automatic capture around password or payment interfaces.", "Never claim to have seen a screenshot returned only as a path."],
    }),
    runtime: runtime(
      ["take_screenshot", "look_at_screen"],
      [{ path: "integrations.screenVision", dimension: "configured", interpretation: "boolean" }],
    ),
  },
  {
    id: "services.google-places",
    domainId: "services",
    name: "Google Places business lookup",
    shortName: "Places",
    description: "Queries the Google Places API for structured business details and optional missing-website filtering.",
    purpose: "Find real businesses without brittle map-page scraping.",
    stability: "beta",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/tools/places-mcp.ts", "buildPlacesTools"),
        source("server/src/tools/places-mcp.test.ts", "buildPlacesTools", "test"),
      ],
    },
    examples: ["Find nearby restaurants.", "Find businesses in London without a website."],
    inputs: [
      { name: "query", description: "Business type, name or search description.", required: true },
      { name: "location", description: "Location context for the search.", required: false, sensitive: true },
      { name: "website filter", description: "Whether results must lack a website.", required: false },
    ],
    outputs: [{ name: "places", description: "Structured names, addresses, phones, websites and map links." }],
    dependencies: [
      { targetType: "service", targetId: "google.places-api", relationship: "depends-on", required: true, description: "Requires a configured Google Places API credential and network access." },
    ],
    readiness: readiness(["defined", "configured", "authenticated", "available", "healthy", "tested"], { authentication: true, recentSuccess: true }),
    verification: verification(
      ["The vendor API returns structured place records.", "A requested missing-website filter is applied to the returned records."],
      ["api-response", "tool-result", "unit-test"],
      ["Vendor data may be stale or incomplete and should not be treated as a guarantee that a business is currently open."],
    ),
    safety: safety("read-only", "never", [], {
      sensitiveData: ["Search location", "Vendor API credential"],
      stopConditions: ["Do not expose API credentials in tool output or Explorer events."],
    }),
    runtime: runtime(
      ["find_places"],
      [{ path: "integrations.googlePlaces", dimension: "configured", interpretation: "boolean" }],
    ),
  },
  {
    id: "services.shopify-products",
    domainId: "services",
    name: "Shopify product administration",
    shortName: "Shopify",
    description: "Lists, reads and updates product titles or descriptions through the Shopify Admin API.",
    purpose: "Make bounded product-content changes through a direct API rather than browser automation.",
    stability: "beta",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/tools/shopify-mcp.ts", "buildShopifyTools"),
        source("server/src/tools/shopify-mcp.test.ts", "buildShopifyTools", "test"),
      ],
    },
    examples: ["List my products.", "Improve this product description without changing its images."],
    inputs: [
      { name: "product identifier", description: "The exact Shopify product to read or update.", required: false, sensitive: true },
      { name: "title or description", description: "Replacement product content.", required: false, sensitive: true },
    ],
    outputs: [
      { name: "product data", description: "Structured product title and description." },
      { name: "remote product update", description: "A persistent Shopify content change.", persistent: true },
    ],
    dependencies: [
      { targetType: "service", targetId: "shopify.admin-api", relationship: "depends-on", required: true, description: "Requires a configured store and Admin API token." },
      { targetType: "capability", targetId: "security.risk-policy", relationship: "uses", required: true, description: "Remote writes must remain explicit and reviewable." },
    ],
    readiness: readiness(["defined", "configured", "authenticated", "available", "healthy", "tested"], { authentication: true, recentSuccess: true }),
    verification: verification(
      ["The Admin API accepts the update for the exact product.", "A follow-up API result reflects the intended title or description."],
      ["api-response", "tool-result", "task-event"],
      ["API acceptance does not prove storefront cache propagation."],
    ),
    safety: safety("medium", "policy-dependent", ["Updates persistent remote product content."], {
      sensitiveData: ["Store identifier", "Admin API token", "Unpublished product content"],
      stopConditions: ["Stop when the product identifier is ambiguous.", "Never include or replace the product image array for a text-only edit."],
    }),
    runtime: runtime(
      ["shopify_list_products", "shopify_get_product", "shopify_update_product"],
      [{ path: "integrations.shopify", dimension: "configured", interpretation: "boolean" }],
    ),
  },
  {
    id: "self-improvement.pipeline",
    domainId: "self-improvement",
    name: "Guarded self-improvement pipeline",
    shortName: "Self-improvement",
    description: "Queues an AVA change, works in isolation, verifies it, swaps it into the live tree and watches for rollback.",
    purpose: "Improve AVA without letting an unverified change silently damage the working system.",
    stability: "experimental",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/self/improver.ts", "runImprovement"),
        source("server/src/self/verify.ts", "verify"),
        source("server/src/self/swap.ts", "swapTo"),
        source("server/src/self/watchdog.ts", "decideRollback"),
        source("server/src/self/improver.integration.test.ts", "self improvement", "test"),
      ],
    },
    examples: ["Improve chat search.", "Show the status of the current self-improvement.", "Roll back the last unhealthy change."],
    inputs: [{ name: "improvement goal", description: "A bounded request to change AVA itself.", required: true, sensitive: true }],
    outputs: [
      { name: "intent lifecycle", description: "Queued, reflecting, awaiting approval, implementing, verifying, shipped, failed or rolled back.", persistent: true },
      { name: "verified code change", description: "A committed change applied to AVA's live tree.", persistent: true },
    ],
    dependencies: [
      { targetType: "capability", targetId: "coding.project-work", relationship: "uses", required: true, description: "A coding worker implements the isolated change." },
      { targetType: "capability", targetId: "verification.outcome-evidence", relationship: "verifies-with", required: true, description: "Tests, builds and boot smoke must pass before swap." },
      { targetType: "capability", targetId: "security.risk-policy", relationship: "depends-on", required: true, description: "Protected surfaces and dangerous bypasses remain blocked." },
    ],
    readiness: readiness(["defined", "configured", "available", "healthy", "tested"], { authentication: true, recentSuccess: true }),
    verification: verification(
      ["The change is isolated in a worktree.", "Tests, web build, server build and boot smoke pass before swap.", "Post-swap health remains good or the watchdog rolls back."],
      ["exit-code", "unit-test", "health-check", "artifact", "task-event"],
      ["Verification coverage is bounded by the available tests and smoke checks."],
    ),
    safety: safety("high", "always", ["Changes AVA's own source and may hot-swap the running application."], {
      sensitiveData: ["Source code", "Development task and logs"],
      stopConditions: ["Never modify protected security, auth, approval, sandbox or self-improvement guard code.", "Only one mutation may run at a time.", "Roll back on failed post-swap health."],
    }),
    runtime: runtime(
      ["self_improve", "self_improve_status"],
      [{ path: "automations.selfImprovement", dimension: "available", interpretation: "boolean" }],
      ["/api/self"],
    ),
  },
  {
    id: "developer-collaboration.claude",
    domainId: "developer-collaboration",
    name: "Claude development collaboration",
    shortName: "Claude collaboration",
    description: "Reads Claude's attributed development notes and can queue a background discussion with the Claude CLI.",
    purpose: "Keep runtime AVA informed about developer work while preserving honest attribution.",
    stability: "beta",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/tools/update-log-mcp.ts", "buildUpdateLogTools"),
        source("server/src/tools/discuss-mcp.ts", "buildDiscussTools"),
        source("server/src/self/dev-log.ts", "development log"),
        source("server/src/tools/discuss-mcp.test.ts", "buildDiscussTools", "test"),
      ],
    },
    examples: ["What did Claude change?", "Ask Claude to think through this architecture.", "Read the latest development note."],
    inputs: [{ name: "discussion topic", description: "Optional question for the external coding agent.", required: false, sensitive: true }],
    outputs: [
      { name: "development notes", description: "Attributed started, shipped or note entries." },
      { name: "background discussion", description: "A queued and later retrievable Claude response.", persistent: true },
    ],
    dependencies: [
      { targetType: "application", targetId: "claude.cli", relationship: "depends-on", required: false, description: "Background discussion requires a logged-in Claude CLI." },
      { targetType: "data-store", targetId: "claude-updates.jsonl", relationship: "reads-from", required: false, description: "Development notes are stored as an append-only log." },
    ],
    readiness: readiness(["defined", "configured", "authenticated", "available", "healthy", "tested"], { authentication: true, recentSuccess: true }),
    verification: verification(
      ["A returned note retains its author and timestamp.", "A discussion result is tied to the queued discussion ID."],
      ["artifact", "tool-result", "unit-test"],
      ["A developer-agent response is advice or reported work, not proof that AVA's live code changed."],
    ),
    safety: safety("low", "never", ["May send a bounded topic to an external developer tool.", "Persists discussion results."], {
      sensitiveData: ["Development context", "Project details"],
      stopConditions: ["Never attribute Claude's work to AVA or Codex.", "Do not send secrets to the developer CLI."],
    }),
    runtime: runtime(["read_claude_updates", "discuss_with_claude", "read_discussion"]),
  },
  {
    id: "security.risk-policy",
    domainId: "security",
    name: "Risk classification and approval policy",
    shortName: "Risk policy",
    description: "Classifies proposed tool actions, applies user rules and blocks, allows or pauses the dispatch.",
    purpose: "Keep irreversible and sensitive actions under explicit, inspectable control.",
    stability: "core",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/policy/classify.ts", "classifyRisk"),
        source("server/src/policy/enforce.ts", "enforce"),
        source("server/src/policy/runtime.ts", "policy runtime"),
        source("server/src/policy/classify.test.ts", "classifyRisk", "test"),
      ],
    },
    examples: ["Explain why this action needs approval.", "Apply my saved autonomy rule.", "Block access to environment secrets."],
    inputs: [
      { name: "tool and sanitised arguments", description: "The proposed operation to classify.", required: true, sensitive: true },
      { name: "autonomy rules", description: "Sir's enabled allow, deny or ask overrides.", required: false, sensitive: true },
    ],
    outputs: [{ name: "policy decision", description: "Allow, ask, deny or hard block with a reason." }],
    dependencies: [
      { targetType: "data-store", targetId: "sqlite.rules", relationship: "reads-from", required: false, description: "User-defined autonomy rules can override ordinary tiers." },
      { targetType: "capability", targetId: "notifications.push-approvals", relationship: "uses", required: false, description: "Ask decisions create visible approval records." },
    ],
    readiness: readiness(["defined", "configured", "available", "healthy", "tested"]),
    verification: verification(
      ["Every tool dispatch receives a deterministic policy outcome.", "Hard-blocked secret or dangerous-bypass patterns cannot be overridden by a user rule."],
      ["unit-test", "task-event"],
      ["Risk classification is pattern- and tool-aware but cannot understand every real-world consequence from syntax alone."],
    ),
    safety: safety("read-only", "never", [], {
      sensitiveData: ["Sanitised tool arguments", "Autonomy rules"],
      stopConditions: ["Hard-block secret access and permission-bypass patterns.", "Treat missing approval as denial."],
    }),
    runtime: runtime([], [], ["/api/rules", "/api/approvals/pending"]),
  },
  {
    id: "security.secret-redaction",
    domainId: "security",
    name: "Secret and sensitive-data redaction",
    shortName: "Redaction",
    description: "Scrubs known credential patterns before storage or outward-facing operational records.",
    purpose: "Make AVA observable without turning logs, memory or Explorer into a credential warehouse.",
    stability: "core",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("server/src/security/scrub.ts", "scrubSecrets"),
        source("server/src/orchestrator/redact.ts", "redactSensitiveArgs"),
        source("server/src/security/scrub.test.ts", "scrubSecrets", "test"),
        source("server/src/orchestrator/redact.test.ts", "redactSensitiveArgs", "test"),
      ],
    },
    examples: ["Store this memory without exposing its token.", "Show a sanitised tool call."],
    inputs: [{ name: "potentially sensitive content", description: "Text or structured tool arguments at a logging/storage boundary.", required: true, sensitive: true }],
    outputs: [{ name: "sanitised representation", description: "Content with supported secret patterns replaced by redaction markers." }],
    dependencies: [],
    readiness: readiness(["defined", "available", "healthy", "tested"]),
    verification: verification(
      ["Known password, token, API-key, authentication-header and private-key patterns are absent after scrubbing.", "Raw secrets are not persisted as a fallback field."],
      ["unit-test", "artifact"],
      ["No pattern-based scrubber can guarantee detection of every arbitrary secret; tools should also mark sensitive fields explicitly."],
    ),
    safety: safety("read-only", "never", [], {
      sensitiveData: ["Raw pre-redaction content"],
      redactions: ["Redaction must occur before persistence wherever possible.", "The frontend must never provide an unredacted trace endpoint."],
      stopConditions: ["Drop or replace a field when safe sanitisation cannot be guaranteed."],
    }),
    runtime: runtime([]),
  },
  {
    id: "verification.outcome-evidence",
    domainId: "verification",
    name: "Evidence-based outcome verification",
    shortName: "Outcome evidence",
    description: "Requires operational evidence appropriate to a side effect before presenting a task as verified.",
    purpose: "Separate 'AVA said it worked' from direct evidence that the requested result occurred.",
    stability: "beta",
    definition: {
      implementation: "partial",
      sourceReferences: [
        source("server/src/orchestrator/tool-result-consistency.ts", "classifyActionResult"),
        source("server/src/tools/activity-log-mcp.ts", "buildReadLogsTool"),
        source("server/src/apps/instagram.ts", "sendDm"),
        source("server/src/apps/whatsapp.ts", "sendMessage"),
        source("server/src/tools/screenshot/look-mcp.ts", "buildLookAtScreenTool"),
        source("server/src/orchestrator/tool-result-consistency.test.ts", "tool result consistency", "test"),
      ],
    },
    examples: ["Show what proves the message was sent.", "Mark this completed but unverified.", "Retry only the failed verification step."],
    inputs: [
      { name: "claimed outcome", description: "The result AVA is about to report.", required: true, sensitive: true },
      { name: "operation evidence", description: "Tool results, DOM state, exit codes, artifacts or visual confirmation.", required: true, sensitive: true },
    ],
    outputs: [{ name: "verification classification", description: "Verified, partially verified, unverified or failed with an explanation." }],
    dependencies: [
      { targetType: "capability", targetId: "orchestration.agent-loop", relationship: "reads-from", required: true, description: "Uses tool results and run state." },
    ],
    readiness: readiness(["defined", "available", "healthy", "tested"], { recentSuccess: true }),
    verification: verification(
      ["A success claim cites at least one operation-appropriate evidence record.", "Missing evidence produces an unverified or failed classification rather than silent success."],
      ["tool-result", "exit-code", "dom-confirmation", "visual-confirmation", "artifact", "task-event"],
      ["Verification is currently implemented in several tool-specific paths; a universal persisted evidence store is still part of Explorer development."],
    ),
    safety: safety("read-only", "never", [], {
      sensitiveData: ["Evidence may reference private resources and communications"],
      stopConditions: ["Do not downgrade a failed verification into success because the attempted action returned without throwing."],
    }),
    runtime: runtime(["read_logs"]),
  },
  {
    id: "interface.pwa",
    domainId: "interface",
    name: "Phone-first PWA and private remote access",
    shortName: "AVA interface",
    description: "Provides pairing, home, chat, voice, sessions, memory, rules, capabilities and self-improvement surfaces.",
    purpose: "Give Sir one private, responsive control surface for conversation, actions and system state.",
    stability: "core",
    definition: {
      implementation: "implemented",
      sourceReferences: [
        source("web/src/App.tsx", "App"),
        source("web/src/components/ava/TubelightNav.tsx", "TubelightNav"),
        source("server/src/routes/auth.ts", "authRoutes", "route"),
        source("docs/architecture/09-web-frontend.md", "Web frontend", "documentation"),
      ],
    },
    examples: ["Open a previous chat.", "Switch to voice.", "Review memory.", "Explore what AVA can do."],
    inputs: [
      { name: "paired device token", description: "A device credential obtained through the pairing flow.", required: true, sensitive: true },
      { name: "user interactions", description: "Navigation, text, audio and approval decisions.", required: true, sensitive: true },
    ],
    outputs: [
      { name: "interactive AVA surfaces", description: "Rendered system and task state." },
      { name: "authenticated API requests", description: "Private requests to the AVA server." },
    ],
    dependencies: [
      { targetType: "service", targetId: "tailscale.network", relationship: "depends-on", required: false, description: "The deployment can use Tailscale for private phone access." },
      { targetType: "permission", targetId: "paired-device", relationship: "requires", required: true, description: "Protected API calls require a valid device token." },
    ],
    readiness: readiness(["defined", "configured", "authenticated", "available", "healthy", "tested"], { authentication: true, recentSuccess: true }),
    verification: verification(
      ["The application shell renders on a paired client.", "Protected API calls reject missing or invalid device tokens.", "Navigation preserves the intended AVA surface."],
      ["api-response", "unit-test", "health-check"],
      ["Reachability over Tailscale depends on local network and service state outside the PWA bundle."],
    ),
    safety: safety("mixed", "policy-dependent", ["Stores a device token locally.", "Provides controls that can trigger external actions."], {
      sensitiveData: ["Device token", "Conversation content", "Memory and task state"],
      stopConditions: ["Clear invalid tokens and return to pairing after authentication failure.", "Never expose raw server secrets to the client."],
    }),
    runtime: runtime([], [], ["/api/auth/pair", "/api/health", "/_status"]),
  },
];

const WORKFLOW_BY_CAPABILITY_ID: Readonly<Record<string, ExplorerWorkflow>> = {
  "conversation.text-turn": conversationWorkflow,
  "voice.realtime": defineWorkflow(
    "voice.realtime",
    "Hold an interruptible realtime voice turn",
    "Connect one Realtime session, listen, speak directly, and delegate computer work without changing voices.",
    [
      { key: "connect", name: "Connect realtime session", description: "Create the authenticated OpenAI Realtime session using the configured voice and model.", kind: "operation", producesEvidence: ["api-response"] },
      { key: "listen", parent: "connect", name: "Listen for speech", description: "Capture microphone audio using semantic VAD or push-to-talk.", kind: "request" },
      { key: "gate-transcript", parent: "listen", name: "Gate transcript", description: "Reject empty, too-brief, low-confidence and known hallucinated transcripts.", kind: "decision", producesEvidence: ["task-event"] },
      { key: "choose-response", parent: "connect", name: "Choose speech or action", description: "Keep chitchat inside Realtime or call do_on_computer for real work.", kind: "decision" },
      { key: "speak", parent: "choose-response", name: "Speak directly", description: "Stream the current Realtime response through the configured speaker.", kind: "result", producesEvidence: ["task-event"] },
      { key: "delegate", parent: "choose-response", capabilityId: "conversation.text-turn", name: "Delegate computer work", description: "Run the full action agent over the internal chat path.", kind: "operation", producesEvidence: ["task-event"] },
      { key: "return-result", parent: "delegate", name: "Return result to same session", description: "Inject the action result into the same Realtime conversation and speaker.", kind: "result", producesEvidence: ["task-event"] },
      { key: "interrupt", parent: "connect", name: "Handle barge-in", description: "Cancel the active response, stop queued audio and truncate what was not heard.", kind: "stop", producesEvidence: ["task-event"] },
    ],
    [
      { from: "connect", to: "listen" },
      { from: "listen", to: "gate-transcript" },
      { from: "gate-transcript", to: "choose-response", kind: "branch", label: "valid speech" },
      { from: "gate-transcript", to: "listen", kind: "retry", label: "discarded transcript" },
      { from: "choose-response", to: "speak", kind: "branch", label: "conversation" },
      { from: "choose-response", to: "delegate", kind: "branch", label: "computer action" },
      { from: "delegate", to: "return-result" },
      { from: "return-result", to: "speak" },
      { from: "speak", to: "interrupt", kind: "branch", label: "user speaks" },
      { from: "interrupt", to: "listen", kind: "retry", label: "resume listening" },
    ],
  ),
  "interpretation.request-mode": defineWorkflow(
    "interpretation.request-mode",
    "Interpret a request without losing its meaning",
    "Assemble context, decide whether action is needed, and stop for material ambiguity.",
    [
      { key: "receive", name: "Preserve original request", description: "Keep the exact user request and conversation reference.", kind: "request", producesEvidence: ["task-event"] },
      { key: "load-context", parent: "receive", capabilityId: "memory.durable", name: "Load relevant context", description: "Add persona, preferences, observations, project context and any matched playbook.", kind: "operation" },
      { key: "identify-objective", parent: "receive", name: "Identify objective", description: "Use the configured model and system instructions to form the current objective.", kind: "decision" },
      { key: "ambiguity", parent: "identify-objective", name: "Check consequential ambiguity", description: "Determine whether different interpretations would change an external action.", kind: "decision" },
      { key: "clarify", parent: "ambiguity", name: "Request clarification", description: "Pause before acting when identity, target or intended side effect is materially unclear.", kind: "stop", producesEvidence: ["task-event"] },
      { key: "conversation", parent: "identify-objective", capabilityId: "conversation.text-turn", name: "Answer conversationally", description: "Respond without external tools when no action is needed.", kind: "result" },
      { key: "action", parent: "identify-objective", capabilityId: "orchestration.agent-loop", name: "Enter action loop", description: "Expose the action toolset and preserve the objective for execution.", kind: "result", producesEvidence: ["task-event"] },
    ],
    [
      { from: "receive", to: "load-context" },
      { from: "load-context", to: "identify-objective" },
      { from: "identify-objective", to: "ambiguity" },
      { from: "ambiguity", to: "clarify", kind: "stop", label: "materially ambiguous" },
      { from: "ambiguity", to: "conversation", kind: "branch", label: "no external action" },
      { from: "ambiguity", to: "action", kind: "branch", label: "actionable" },
    ],
  ),
  "orchestration.agent-loop": defineWorkflow(
    "orchestration.agent-loop",
    "Run the model-tool loop",
    "Select tools, enforce policy, execute, return evidence to the model and stop safely.",
    [
      { key: "assemble", name: "Assemble turn", description: "Build system prompt, memory, relevant playbook, messages and available tool definitions.", kind: "request" },
      { key: "model", parent: "assemble", name: "Invoke configured model", description: "Request either a final response or structured tool calls.", kind: "decision" },
      { key: "validate-call", parent: "model", name: "Validate tool call", description: "Reject malformed arguments and unknown tool names without dispatch.", kind: "verification", producesEvidence: ["tool-result"] },
      { key: "policy", parent: "validate-call", capabilityId: "security.risk-policy", name: "Apply risk policy", description: "Allow, ask, deny or hard-block the proposed action.", kind: "decision", producesEvidence: ["task-event"] },
      { key: "execute", parent: "validate-call", name: "Execute bounded tool", description: "Run the selected tool with cancellation and its configured timeout budget.", kind: "external-action", producesEvidence: ["tool-result"] },
      { key: "observe", parent: "model", name: "Return result to model", description: "Append the sanitised result so the model can continue, retry or choose a fallback.", kind: "operation", producesEvidence: ["tool-result"] },
      { key: "verify", parent: "model", capabilityId: "verification.outcome-evidence", name: "Check completion evidence", description: "Compare the intended outcome with operation-specific evidence.", kind: "verification", producesEvidence: ["task-event"] },
      { key: "final", parent: "assemble", name: "Persist final state", description: "Stream and store the verified, partial, blocked or failed result.", kind: "result", producesEvidence: ["task-event"] },
      { key: "stop", parent: "assemble", name: "Cancel or stop stalled work", description: "Abort on user cancellation, timeout or sustained no-progress detection.", kind: "stop", producesEvidence: ["task-event"] },
    ],
    [
      { from: "assemble", to: "model" },
      { from: "model", to: "validate-call", kind: "branch", label: "tool call" },
      { from: "model", to: "verify", kind: "branch", label: "proposed final" },
      { from: "validate-call", to: "policy" },
      { from: "policy", to: "execute", kind: "branch", label: "allowed" },
      { from: "policy", to: "stop", kind: "stop", label: "denied or expired" },
      { from: "execute", to: "observe" },
      { from: "observe", to: "model", kind: "retry", label: "continue loop" },
      { from: "verify", to: "final", label: "sufficient evidence" },
      { from: "verify", to: "model", kind: "retry", label: "retry or fallback" },
    ],
  ),
  "browser.persistent-control": browserWorkflow,
  "desktop.native-control": defineWorkflow(
    "desktop.native-control",
    "Control a native Windows application",
    "Prefer deterministic local automation, then visually verify the resulting window state.",
    [
      { key: "identify", name: "Identify application and target", description: "Resolve the requested app, file or window without assuming a similarly named target.", kind: "request" },
      { key: "launch-focus", parent: "identify", name: "Launch or focus", description: "Use Start-Process, an application URI, Invoke-Item or AppActivate.", kind: "external-action", toolName: "shell", producesEvidence: ["exit-code", "tool-result"] },
      { key: "locate-control", parent: "launch-focus", name: "Locate control", description: "Find the target through Windows UI Automation or a bounded keyboard route.", kind: "operation", toolName: "control_app" },
      { key: "act", parent: "locate-control", name: "Perform app action", description: "Click, set a value or send keys to the verified target window.", kind: "external-action", toolName: "control_app" },
      { key: "verify", parent: "launch-focus", capabilityId: "vision.screen-inspection", name: "Verify visible state", description: "Use a return value or look_at_screen when the UI result matters.", kind: "verification", toolName: "look_at_screen", producesEvidence: ["visual-confirmation", "tool-result"] },
      { key: "stop", parent: "identify", name: "Stop on wrong or unknown target", description: "Do not type or click when the active application cannot be verified.", kind: "stop" },
    ],
    [
      { from: "identify", to: "launch-focus" },
      { from: "launch-focus", to: "locate-control" },
      { from: "locate-control", to: "act", kind: "branch", label: "control found" },
      { from: "act", to: "verify", kind: "verification" },
      { from: "identify", to: "stop", kind: "stop", label: "target ambiguous" },
    ],
  ),
  "shell-files.shell": defineWorkflow(
    "shell-files.shell",
    "Execute a bounded PowerShell command",
    "Classify and run a local command with cancellation, secret scrubbing and exit evidence.",
    [
      { key: "receive", name: "Receive command", description: "Record the command and working context in sanitised form.", kind: "request" },
      { key: "classify", parent: "receive", capabilityId: "security.risk-policy", name: "Classify command", description: "Block secret access and dangerous bypasses; classify other consequences.", kind: "decision" },
      { key: "approve", parent: "classify", capabilityId: "notifications.push-approvals", name: "Resolve approval", description: "Wait for an explicit approval when policy requires one.", kind: "decision", producesEvidence: ["task-event"] },
      { key: "spawn", parent: "receive", name: "Spawn PowerShell", description: "Run PowerShell with the run cancellation signal and PID tracking.", kind: "external-action", toolName: "shell" },
      { key: "capture", parent: "spawn", name: "Capture result", description: "Collect exit code and sanitised stdout/stderr within output limits.", kind: "verification", toolName: "shell", producesEvidence: ["exit-code", "tool-result"] },
      { key: "stop", parent: "classify", name: "Block or terminate", description: "Do not execute a blocked, denied, timed-out or cancelled command.", kind: "stop", producesEvidence: ["task-event"] },
      { key: "report", parent: "receive", name: "Report command outcome", description: "State success or failure from exit and output evidence.", kind: "result" },
    ],
    [
      { from: "receive", to: "classify" },
      { from: "classify", to: "spawn", kind: "branch", label: "allowed" },
      { from: "classify", to: "approve", kind: "branch", label: "ask" },
      { from: "classify", to: "stop", kind: "stop", label: "blocked" },
      { from: "approve", to: "spawn", kind: "branch", label: "approved" },
      { from: "approve", to: "stop", kind: "stop", label: "denied or expired" },
      { from: "spawn", to: "capture" },
      { from: "capture", to: "report" },
    ],
  ),
  "shell-files.filesystem": defineWorkflow(
    "shell-files.filesystem",
    "Perform an allowlisted file operation",
    "Resolve and guard the path before selecting a read, write or approved delete operation.",
    [
      { key: "request", name: "Receive path and operation", description: "Record the requested absolute path and intended read, list, stat, write or delete.", kind: "request" },
      { key: "secret-check", parent: "request", capabilityId: "security.secret-redaction", name: "Reject secret paths", description: "Block environment and known credential paths before any file access.", kind: "decision" },
      { key: "allowlist", parent: "request", name: "Resolve allowlisted path", description: "Normalize lexical and canonical paths and require an allowed root.", kind: "verification", producesEvidence: ["tool-result"] },
      { key: "choose", parent: "request", name: "Choose operation", description: "Route read/list/stat, write or delete through its exact filesystem tool.", kind: "decision" },
      { key: "read", parent: "choose", name: "Read metadata or content", description: "Read, list or stat and scrub returned content.", kind: "operation", toolName: "fs_read", producesEvidence: ["tool-result"] },
      { key: "write", parent: "choose", name: "Write content", description: "Create parents inside the allowed root and write the requested UTF-8 content.", kind: "external-action", toolName: "fs_write", producesEvidence: ["artifact", "tool-result"] },
      { key: "approve-delete", parent: "choose", capabilityId: "notifications.push-approvals", name: "Approve deletion", description: "Require approval before deleting one file or empty directory.", kind: "decision" },
      { key: "delete", parent: "approve-delete", name: "Delete exact target", description: "Delete only the resolved single target without recursive removal.", kind: "external-action", toolName: "fs_delete", producesEvidence: ["tool-result"] },
      { key: "stop", parent: "request", name: "Refuse unsafe path", description: "Stop on secret, outside-root, ambiguous or denied operations.", kind: "stop" },
      { key: "verify", parent: "request", name: "Verify affected resource", description: "Use result, stat or artifact evidence appropriate to the operation.", kind: "verification", toolName: "fs_stat", producesEvidence: ["artifact", "tool-result"] },
    ],
    [
      { from: "request", to: "secret-check" },
      { from: "secret-check", to: "stop", kind: "stop", label: "secret path" },
      { from: "secret-check", to: "allowlist", kind: "branch", label: "not secret" },
      { from: "allowlist", to: "stop", kind: "stop", label: "outside roots" },
      { from: "allowlist", to: "choose", label: "allowed path" },
      { from: "choose", to: "read", kind: "branch", label: "read/list/stat" },
      { from: "choose", to: "write", kind: "branch", label: "write" },
      { from: "choose", to: "approve-delete", kind: "branch", label: "delete" },
      { from: "approve-delete", to: "delete", kind: "branch", label: "approved" },
      { from: "approve-delete", to: "stop", kind: "stop", label: "denied" },
      { from: "read", to: "verify" },
      { from: "write", to: "verify" },
      { from: "delete", to: "verify" },
    ],
  ),
  "coding.project-work": defineWorkflow(
    "coding.project-work",
    "Change a selected software project",
    "Inspect first, choose direct or delegated implementation, then verify the exact change.",
    [
      { key: "scope", name: "Resolve project and objective", description: "Confirm the repository root, requested outcome and whether the task is review-only or mutating.", kind: "request" },
      { key: "inspect", parent: "scope", name: "Inspect repository state", description: "Read instructions, relevant source and existing uncommitted changes before editing.", kind: "operation", toolName: "fs_read" },
      { key: "plan", parent: "scope", name: "Choose implementation path", description: "Decide between direct bounded edits and a Claude Code worker for broad multi-file work.", kind: "decision" },
      { key: "direct", parent: "plan", name: "Implement directly", description: "Edit only scoped files while preserving unrelated changes.", kind: "external-action", toolName: "fs_write", producesEvidence: ["artifact"] },
      { key: "delegate", parent: "plan", name: "Delegate bounded worker", description: "Run Claude Code in the allowlisted project with the explicit task.", kind: "external-action", toolName: "claude_code", producesEvidence: ["tool-result", "artifact"] },
      { key: "tests", parent: "scope", name: "Run focused tests", description: "Execute the smallest relevant test suite and capture exact failures.", kind: "verification", toolName: "shell", producesEvidence: ["unit-test", "exit-code"] },
      { key: "build", parent: "scope", name: "Run build or typecheck", description: "Check integration-level compilation appropriate to the project.", kind: "verification", toolName: "shell", producesEvidence: ["exit-code"] },
      { key: "report", parent: "scope", name: "Report changed files and evidence", description: "Distinguish completed, partial and blocked results and name remaining failures.", kind: "result", producesEvidence: ["task-event"] },
    ],
    [
      { from: "scope", to: "inspect" },
      { from: "inspect", to: "plan" },
      { from: "plan", to: "direct", kind: "branch", label: "bounded edit" },
      { from: "plan", to: "delegate", kind: "branch", label: "multi-file worker" },
      { from: "direct", to: "tests" },
      { from: "delegate", to: "tests" },
      { from: "tests", to: "build" },
      { from: "build", to: "report" },
      { from: "tests", to: "direct", kind: "retry", label: "fix test failure" },
    ],
  ),
  "instagram.messaging": defineWorkflow(
    "instagram.messaging",
    "Navigate Instagram profiles and messages",
    "Open Instagram, branch deliberately between profile and message work, and verify identity before any send.",
    [
      { key: "open", name: "Open Instagram", description: "Navigate AVA Chrome to Instagram Direct, dismiss known popups and wait for a rendered state.", kind: "operation", toolName: "instagram_status", producesEvidence: ["dom-confirmation", "tool-result"] },
      { key: "surface", parent: "open", name: "Choose profile or messages", description: "Keep profile browsing separate from private conversation operations.", kind: "decision" },
      { key: "profile", parent: "surface", name: "Open profile", description: "Open a known or explicit username directly; use safe search for an unknown plain name.", kind: "decision" },
      { key: "profile-resolve", parent: "profile", capabilityId: "people.identity-resolution", name: "Resolve profile target", description: "Use a known username or explicit @handle without inventing an account.", kind: "decision" },
      { key: "profile-open", parent: "profile", name: "Open profile or safe search", description: "Open the exact profile when resolved, otherwise display search results without messaging.", kind: "external-action", toolName: "instagram_open_profile", producesEvidence: ["dom-confirmation", "tool-result"] },
      { key: "messages", parent: "surface", name: "Open messages", description: "Handle opening, reading or sending inside a verified direct-message thread.", kind: "decision" },
      { key: "resolve-recipient", parent: "messages", capabilityId: "people.identity-resolution", name: "Resolve recipient", description: "Resolve a known alias, learned thread or handle-like explicit username; stop on a plain unknown name.", kind: "decision", toolName: "person_list" },
      { key: "open-chat", parent: "messages", name: "Open verified chat", description: "Use the learned thread fast path or exact compose-dialog discovery, then learn only a successful thread.", kind: "operation", toolName: "instagram_open_chat", producesEvidence: ["dom-confirmation", "tool-result"] },
      { key: "chat-action", parent: "messages", name: "Choose open, read or send", description: "Branch only after the intended conversation is open.", kind: "decision" },
      { key: "open-result", parent: "chat-action", name: "Leave chat open", description: "Report the verified conversation without reading or sending more than requested.", kind: "result", producesEvidence: ["tool-result"] },
      { key: "read-chat", parent: "chat-action", name: "Read visible conversation tail", description: "Return only the visible tail of the opened conversation.", kind: "operation", toolName: "instagram_read_chat", producesEvidence: ["tool-result"] },
      { key: "send", parent: "chat-action", capabilityId: "instagram.send-dm", name: "Send exact text", description: "Locate the current composer, enter the approved text and submit it.", kind: "external-action", toolName: "instagram_send_dm" },
      { key: "verify-send", parent: "send", capabilityId: "instagram.send-dm", name: "Verify sent appearance", description: "Require the text to appear in the active thread before success.", kind: "verification", toolName: "instagram_send_dm", producesEvidence: ["dom-confirmation", "tool-result"] },
      { key: "stop", parent: "open", name: "Stop for setup or identity", description: "Ask for login, 2FA, manual challenge completion or exact identity without flailing.", kind: "stop", producesEvidence: ["tool-result"] },
    ],
    [
      { from: "open", to: "surface", label: "authenticated" },
      { from: "open", to: "stop", kind: "stop", label: "login, code or challenge" },
      { from: "surface", to: "profile", kind: "branch", label: "profile" },
      { from: "surface", to: "messages", kind: "branch", label: "messages" },
      { from: "profile", to: "profile-resolve" },
      { from: "profile-resolve", to: "profile-open" },
      { from: "messages", to: "resolve-recipient" },
      { from: "resolve-recipient", to: "open-chat", label: "one exact recipient" },
      { from: "resolve-recipient", to: "stop", kind: "stop", label: "unknown or ambiguous" },
      { from: "open-chat", to: "chat-action" },
      { from: "chat-action", to: "open-result", kind: "branch", label: "open only" },
      { from: "chat-action", to: "read-chat", kind: "branch", label: "read" },
      { from: "chat-action", to: "send", kind: "branch", label: "send" },
      { from: "send", to: "verify-send", kind: "verification" },
    ],
  ),
  "instagram.connection": defineWorkflow(
    "instagram.connection",
    "Establish Instagram session readiness",
    "Detect the URL-led Instagram state and route login, 2FA or human-only challenges explicitly.",
    [
      { key: "navigate", name: "Navigate to Direct inbox", description: "Open /direct/inbox in AVA's persistent browser and dismiss known nag dialogs.", kind: "operation", toolName: "instagram_status" },
      { key: "poll", parent: "navigate", name: "Wait for rendered state", description: "Poll a cold blank page for up to roughly six seconds before judging it unavailable.", kind: "operation", toolName: "instagram_status" },
      { key: "detect", parent: "navigate", name: "Detect URL-led state", description: "Classify authenticated, login wall, checkpoint, challenge or unknown using URL plus bounded page text.", kind: "decision", producesEvidence: ["dom-confirmation", "tool-result"] },
      { key: "ready", parent: "detect", name: "Confirm inbox ready", description: "Return logged in only when an authenticated Instagram surface is established.", kind: "result", producesEvidence: ["dom-confirmation"] },
      { key: "login", parent: "detect", name: "Submit explicit credentials", description: "Fill username and password only when Sir supplies them, then inspect the resulting state.", kind: "external-action", toolName: "instagram_login" },
      { key: "code", parent: "detect", name: "Submit verification code", description: "Fill the current 2FA code supplied by Sir and re-check the state.", kind: "external-action", toolName: "instagram_submit_code" },
      { key: "manual", parent: "detect", name: "Request human challenge completion", description: "Stop for captcha, challenge or an unrecognised authentication step.", kind: "stop" },
      { key: "unavailable", parent: "detect", name: "Report blank or unreachable page", description: "Report network/browser failure without mislabelling it as logged out.", kind: "stop", producesEvidence: ["tool-result"] },
    ],
    [
      { from: "navigate", to: "poll" },
      { from: "poll", to: "detect" },
      { from: "detect", to: "ready", kind: "branch", label: "authenticated" },
      { from: "detect", to: "login", kind: "branch", label: "login wall" },
      { from: "detect", to: "code", kind: "branch", label: "2FA checkpoint" },
      { from: "detect", to: "manual", kind: "stop", label: "challenge" },
      { from: "detect", to: "unavailable", kind: "stop", label: "blank or unreachable" },
      { from: "login", to: "detect", kind: "retry", label: "inspect result" },
      { from: "code", to: "detect", kind: "retry", label: "inspect result" },
    ],
  ),
  "instagram.send-dm": instagramSendWorkflow,
  "whatsapp.messaging": defineWorkflow(
    "whatsapp.messaging",
    "Navigate WhatsApp chats safely",
    "Open WhatsApp Web, verify the linked state, resolve one contact, then open, read or send.",
    [
      { key: "open", name: "Open WhatsApp Web", description: "Navigate AVA Chrome to web.whatsapp.com and wait for the chat surface.", kind: "operation", toolName: "whatsapp_status", producesEvidence: ["dom-confirmation", "tool-result"] },
      { key: "linked", parent: "open", capabilityId: "whatsapp.connection", name: "Check linked state", description: "Distinguish chat list, loading state and QR screen from bounded page markers.", kind: "decision" },
      { key: "resolve", parent: "linked", capabilityId: "people.identity-resolution", name: "Resolve contact", description: "Use a known identity, phone number or first-time exact display name; stop on ambiguity.", kind: "decision", toolName: "person_list" },
      { key: "search", parent: "resolve", name: "Search chat list", description: "Use scoped selectors or accessibility references for the chat-list search box.", kind: "operation", toolName: "whatsapp_open_chat" },
      { key: "select-exact", parent: "search", name: "Select exact result", description: "Click an exact quoted accessible name rather than a substring or group containing it.", kind: "operation", toolName: "whatsapp_open_chat" },
      { key: "verify-header", parent: "search", name: "Verify conversation header", description: "Require the target name in the conversation pane, not merely in the left rail.", kind: "verification", toolName: "whatsapp_open_chat", producesEvidence: ["dom-confirmation", "tool-result"] },
      { key: "action", parent: "linked", name: "Choose open, read or send", description: "Branch only after header verification.", kind: "decision" },
      { key: "open-result", parent: "action", name: "Leave verified chat open", description: "Report the selected conversation without extra actions.", kind: "result" },
      { key: "read", parent: "action", name: "Read visible chat tail", description: "Return the current visible tail of the verified conversation.", kind: "operation", toolName: "whatsapp_read_chat", producesEvidence: ["tool-result"] },
      { key: "send", parent: "action", capabilityId: "whatsapp.send-message", name: "Send exact text", description: "Type into the footer composer, press Enter and do not confuse the search box for the composer.", kind: "external-action", toolName: "whatsapp_send_message" },
      { key: "verify-send", parent: "send", capabilityId: "whatsapp.send-message", name: "Verify message left composer", description: "Require the text in the conversation tail and absent from the composer.", kind: "verification", toolName: "whatsapp_send_message", producesEvidence: ["dom-confirmation", "tool-result"] },
      { key: "stop", parent: "open", name: "Stop for QR or identity", description: "Ask Sir to link the session or clarify the exact contact instead of guessing.", kind: "stop" },
    ],
    [
      { from: "open", to: "linked" },
      { from: "linked", to: "resolve", kind: "branch", label: "linked" },
      { from: "linked", to: "stop", kind: "stop", label: "QR or still loading" },
      { from: "resolve", to: "search", label: "one contact" },
      { from: "resolve", to: "stop", kind: "stop", label: "ambiguous or missing" },
      { from: "search", to: "select-exact" },
      { from: "select-exact", to: "verify-header", kind: "verification" },
      { from: "verify-header", to: "action", label: "correct header" },
      { from: "verify-header", to: "stop", kind: "stop", label: "wrong header" },
      { from: "action", to: "open-result", kind: "branch", label: "open only" },
      { from: "action", to: "read", kind: "branch", label: "read" },
      { from: "action", to: "send", kind: "branch", label: "send" },
      { from: "send", to: "verify-send", kind: "verification" },
    ],
  ),
  "whatsapp.connection": defineWorkflow(
    "whatsapp.connection",
    "Check WhatsApp linked-session state",
    "Open WhatsApp Web and classify chat list, loading or QR state without relying on URL changes.",
    [
      { key: "navigate", name: "Navigate to WhatsApp Web", description: "Open web.whatsapp.com in AVA's persistent browser.", kind: "operation", toolName: "whatsapp_status" },
      { key: "settle", parent: "navigate", name: "Wait for chat state", description: "Allow the application to load and give a loading state one additional settle window.", kind: "operation" },
      { key: "detect", parent: "navigate", name: "Inspect bounded page markers", description: "Require QR markers without logged-in chat markers before declaring the session unlinked.", kind: "decision", toolName: "whatsapp_status", producesEvidence: ["dom-confirmation", "tool-result"] },
      { key: "ready", parent: "detect", name: "Confirm linked chat list", description: "Return ready when the chats/search surface is visible.", kind: "result", producesEvidence: ["dom-confirmation"] },
      { key: "retry", parent: "detect", name: "Report still loading", description: "Ask for a short retry without requiring user action.", kind: "stop" },
      { key: "qr", parent: "detect", name: "Request QR linking", description: "Tell Sir to use WhatsApp Linked devices and scan the QR in AVA Chrome.", kind: "stop" },
    ],
    [
      { from: "navigate", to: "settle" },
      { from: "settle", to: "detect" },
      { from: "detect", to: "ready", kind: "branch", label: "chat list" },
      { from: "detect", to: "retry", kind: "stop", label: "loading" },
      { from: "detect", to: "qr", kind: "stop", label: "QR screen" },
    ],
  ),
  "whatsapp.send-message": whatsappSendWorkflow,
  "people.identity-resolution": defineWorkflow(
    "people.identity-resolution",
    "Resolve one person to platform identity",
    "Prefer exact known records, surface ambiguity and persist new mappings only from explicit or verified evidence.",
    [
      { key: "normalise", name: "Normalise requested identity", description: "Trim the requested name, alias, username, display name or phone number.", kind: "request" },
      { key: "lookup", parent: "normalise", name: "Search people map", description: "Match exact names and aliases and collect plausible candidates.", kind: "decision", toolName: "person_list" },
      { key: "known", parent: "lookup", name: "Use known platform identity", description: "Return the stored username, phone, display name or learned thread for one match.", kind: "result", producesEvidence: ["tool-result"] },
      { key: "explicit", parent: "lookup", name: "Accept explicit safe identifier", description: "Temporarily use an explicit @handle or phone-shaped value under the platform's rules.", kind: "decision" },
      { key: "clarify", parent: "lookup", name: "Ask which person", description: "List candidates or request the exact platform identity for an unknown plain name.", kind: "stop" },
      { key: "verify", parent: "explicit", name: "Verify through app result", description: "Require a successful profile/thread/header result before learning a transient identity.", kind: "verification", producesEvidence: ["dom-confirmation", "tool-result"] },
      { key: "persist", parent: "verify", name: "Persist verified mapping", description: "Save the name, aliases and app fields only after explicit clarification or verified success.", kind: "external-action", toolName: "person_remember", producesEvidence: ["artifact", "tool-result"] },
    ],
    [
      { from: "normalise", to: "lookup" },
      { from: "lookup", to: "known", kind: "branch", label: "one known match" },
      { from: "lookup", to: "explicit", kind: "branch", label: "explicit handle or phone" },
      { from: "lookup", to: "clarify", kind: "stop", label: "unknown or ambiguous" },
      { from: "explicit", to: "verify" },
      { from: "verify", to: "persist", label: "verified" },
      { from: "verify", to: "clarify", kind: "stop", label: "not verified" },
    ],
  ),
  "memory.durable": defineWorkflow(
    "memory.durable",
    "Read or intentionally change durable memory",
    "Route reads, writes and forgetting to the correct auditable memory store with secret scrubbing.",
    [
      { key: "request", name: "Classify memory intent", description: "Distinguish read, remember, refresh/supersede and forget requests.", kind: "decision" },
      { key: "select-store", parent: "request", name: "Select memory destination", description: "Choose preferences, observations or an exact project note.", kind: "decision" },
      { key: "read", parent: "select-store", name: "Read sanitised memory", description: "Load only the requested memory files and project context.", kind: "operation", toolName: "memory_read", producesEvidence: ["tool-result"] },
      { key: "scrub", parent: "select-store", capabilityId: "security.secret-redaction", name: "Scrub proposed memory", description: "Remove supported credential patterns before persistence.", kind: "verification" },
      { key: "remember", parent: "select-store", name: "Append, refresh or supersede", description: "Persist the observation with destination, date, confidence and category semantics.", kind: "external-action", toolName: "memory_remember", producesEvidence: ["artifact", "tool-result"] },
      { key: "forget", parent: "select-store", name: "Forget exact match", description: "Remove or supersede only the requested entry or project target.", kind: "external-action", toolName: "memory_forget", producesEvidence: ["artifact", "tool-result"] },
      { key: "verify", parent: "select-store", name: "Read back affected destination", description: "Confirm the intended entry is present, refreshed, superseded or absent.", kind: "verification", toolName: "memory_read", producesEvidence: ["artifact", "tool-result"] },
    ],
    [
      { from: "request", to: "select-store" },
      { from: "select-store", to: "read", kind: "branch", label: "read" },
      { from: "select-store", to: "scrub", kind: "branch", label: "remember" },
      { from: "select-store", to: "forget", kind: "branch", label: "forget" },
      { from: "scrub", to: "remember" },
      { from: "remember", to: "verify", kind: "verification" },
      { from: "forget", to: "verify", kind: "verification" },
    ],
  ),
  "playbooks.procedural-memory": defineWorkflow(
    "playbooks.procedural-memory",
    "Capture, recall and improve a playbook",
    "Learn only from completed multi-step work and treat later recall as guidance that still requires verification.",
    [
      { key: "mode", name: "Choose capture or recall", description: "Route a completed run to learning or a new request to lexical matching.", kind: "decision" },
      { key: "capture-eligible", parent: "mode", name: "Check capture eligibility", description: "Require a final reply and at least two tool steps before distillation.", kind: "verification" },
      { key: "distill", parent: "mode", name: "Distil trigger, steps and lessons", description: "Create a concise trigger, keywords, successful steps and avoidance lessons.", kind: "operation", producesEvidence: ["artifact"] },
      { key: "merge", parent: "mode", name: "Merge existing playbook", description: "Increment the version while retaining success, failure and duration history.", kind: "external-action", producesEvidence: ["artifact"] },
      { key: "match", parent: "mode", name: "Lexically match request", description: "Tokenise the new prompt and choose a non-demoted matching playbook.", kind: "decision" },
      { key: "inject", parent: "mode", name: "Inject procedure and lessons", description: "Prepend the matched guidance to the current request.", kind: "operation", producesEvidence: ["task-event"] },
      { key: "record", parent: "mode", name: "Record recalled outcome", description: "Update wins, failures, last-used date and rolling duration after execution.", kind: "external-action", producesEvidence: ["artifact", "task-event"] },
      { key: "none", parent: "mode", name: "Continue without playbook", description: "Do not manufacture a match when overlap or eligibility is insufficient.", kind: "result" },
    ],
    [
      { from: "mode", to: "capture-eligible", kind: "branch", label: "completed run" },
      { from: "capture-eligible", to: "distill", label: "eligible" },
      { from: "capture-eligible", to: "none", kind: "stop", label: "not eligible" },
      { from: "distill", to: "merge" },
      { from: "mode", to: "match", kind: "branch", label: "new request" },
      { from: "match", to: "inject", label: "match" },
      { from: "match", to: "none", kind: "branch", label: "no match" },
      { from: "inject", to: "record" },
    ],
  ),
  "automation.watches": defineWorkflow(
    "automation.watches",
    "Create and execute a standing watch",
    "Persist a frugal scheduled check, run it as an auditable agent session and notify only on an explicit trigger marker.",
    [
      { key: "intent", name: "Choose create, list or delete", description: "Interpret the monitoring request and avoid creating a watch for a one-off lookup.", kind: "decision" },
      { key: "create", parent: "intent", name: "Create self-contained check", description: "Persist the prompt, interval and one-shot setting with a frugal schedule.", kind: "external-action", toolName: "watch_create", producesEvidence: ["api-response"] },
      { key: "schedule", parent: "create", name: "Wait for due time", description: "The in-process scheduler selects enabled due watches while AVA is running.", kind: "operation" },
      { key: "run", parent: "create", capabilityId: "orchestration.agent-loop", name: "Run auditable agent check", description: "Post the saved prompt to AVA's own chat path and create a normal session.", kind: "operation", producesEvidence: ["task-event"] },
      { key: "marker", parent: "run", name: "Parse terminal marker", description: "Accept only WATCH: TRIGGERED or WATCH: OK; treat missing markers as unclear.", kind: "decision", producesEvidence: ["task-event"] },
      { key: "notify", parent: "marker", capabilityId: "notifications.push-approvals", name: "Notify trigger", description: "Send a push and disable a one-shot watch only for an explicit trigger marker.", kind: "external-action", producesEvidence: ["api-response"] },
      { key: "reschedule", parent: "marker", name: "Record OK and reschedule", description: "Persist the result and calculate the next run without notifying.", kind: "result" },
      { key: "unclear", parent: "marker", name: "Record unclear result", description: "Do not send a false notification when the marker protocol is missing.", kind: "stop" },
      { key: "list", parent: "intent", name: "List active watches", description: "Return persisted watch state without running checks.", kind: "result", toolName: "watch_list" },
      { key: "delete", parent: "intent", name: "Delete exact watch", description: "Disable and remove the requested watch record.", kind: "external-action", toolName: "watch_delete", producesEvidence: ["api-response"] },
    ],
    [
      { from: "intent", to: "create", kind: "branch", label: "create" },
      { from: "intent", to: "list", kind: "branch", label: "list" },
      { from: "intent", to: "delete", kind: "branch", label: "delete" },
      { from: "create", to: "schedule" },
      { from: "schedule", to: "run" },
      { from: "run", to: "marker" },
      { from: "marker", to: "notify", kind: "branch", label: "triggered" },
      { from: "marker", to: "reschedule", kind: "branch", label: "OK" },
      { from: "marker", to: "unclear", kind: "stop", label: "missing marker" },
      { from: "reschedule", to: "schedule", kind: "retry", label: "next interval" },
    ],
  ),
  "notifications.push-approvals": defineWorkflow(
    "notifications.push-approvals",
    "Resolve a consequential action",
    "Create one approval record, notify safely, and resume only from an explicit valid decision.",
    [
      { key: "request", name: "Create pending approval", description: "Store the exact run, tool and sanitised action summary with an expiry.", kind: "request", producesEvidence: ["task-event"] },
      { key: "push", parent: "request", name: "Deliver optional push", description: "Send an approve/deny notification when VAPID and a live subscription are available.", kind: "external-action", producesEvidence: ["api-response"] },
      { key: "display", parent: "request", name: "Display inline approval", description: "Render the approval card in the active chat or voice surface.", kind: "operation" },
      { key: "decision", parent: "request", name: "Validate decision", description: "Tie approve or deny to the exact pending record and authenticated device.", kind: "decision", producesEvidence: ["api-response", "task-event"] },
      { key: "resume", parent: "decision", name: "Resume exact tool call", description: "Continue only the operation represented by the approved record.", kind: "external-action", producesEvidence: ["task-event"] },
      { key: "deny", parent: "decision", name: "Deny or expire safely", description: "Resolve denial, timeout or invalid decisions without dispatching the tool.", kind: "stop", producesEvidence: ["task-event"] },
    ],
    [
      { from: "request", to: "push", kind: "branch", label: "push configured" },
      { from: "request", to: "display" },
      { from: "push", to: "decision" },
      { from: "display", to: "decision" },
      { from: "decision", to: "resume", kind: "branch", label: "approved" },
      { from: "decision", to: "deny", kind: "stop", label: "denied or expired" },
    ],
  ),
  "vision.screen-inspection": defineWorkflow(
    "vision.screen-inspection",
    "Capture or inspect the Windows desktop",
    "Keep path-only screenshot capture distinct from a model-backed visual observation.",
    [
      { key: "request", name: "Choose capture or visual answer", description: "Determine whether Sir wants an artifact or an actual description/verification.", kind: "decision" },
      { key: "capture", parent: "request", name: "Capture desktop PNG", description: "Capture the visible Windows desktop under Downloads/Ava/screenshots.", kind: "external-action", toolName: "take_screenshot", producesEvidence: ["artifact"] },
      { key: "path", parent: "capture", name: "Return artifact path only", description: "State clearly that capture alone has not shown the pixels to the model.", kind: "result", producesEvidence: ["artifact"] },
      { key: "privacy", parent: "request", name: "Check sensitive visual context", description: "Avoid automatic capture around password and payment interfaces.", kind: "decision" },
      { key: "analyze", parent: "request", name: "Capture and analyse once", description: "Send one captured desktop image and the focused question to a multimodal model.", kind: "operation", toolName: "look_at_screen", producesEvidence: ["visual-confirmation", "tool-result"] },
      { key: "answer", parent: "analyze", name: "Return bounded visual finding", description: "Describe only visible evidence relevant to the question and disclose uncertainty.", kind: "result", producesEvidence: ["visual-confirmation"] },
      { key: "stop", parent: "privacy", name: "Stop for sensitive screen", description: "Do not capture an unsafe surface automatically.", kind: "stop" },
    ],
    [
      { from: "request", to: "capture", kind: "branch", label: "screenshot only" },
      { from: "capture", to: "path" },
      { from: "request", to: "privacy", kind: "branch", label: "look at screen" },
      { from: "privacy", to: "analyze", label: "safe to inspect" },
      { from: "privacy", to: "stop", kind: "stop", label: "sensitive surface" },
      { from: "analyze", to: "answer" },
    ],
  ),
  "services.google-places": defineWorkflow(
    "services.google-places",
    "Find structured business records",
    "Call Google Places directly, normalise fields and enforce the requested website filter.",
    [
      { key: "request", name: "Build place query", description: "Combine business type/name, location context and website-presence requirement.", kind: "request" },
      { key: "configured", parent: "request", name: "Check API configuration", description: "Use the tool only when a Google Places credential registered it.", kind: "decision" },
      { key: "search", parent: "request", name: "Query Google Places", description: "Request structured candidates from the vendor API.", kind: "operation", toolName: "find_places", producesEvidence: ["api-response", "tool-result"] },
      { key: "details", parent: "search", name: "Normalise place details", description: "Return name, address, phone, website and Maps link when available.", kind: "operation" },
      { key: "filter", parent: "search", name: "Apply website filter", description: "When requested, retain only records whose structured website field is absent.", kind: "verification", producesEvidence: ["api-response"] },
      { key: "report", parent: "request", name: "Report sourced results", description: "Present vendor results without guaranteeing that listings are current.", kind: "result" },
      { key: "stop", parent: "configured", name: "Report setup required", description: "Do not pretend a browser scrape is the same structured capability.", kind: "stop" },
    ],
    [
      { from: "request", to: "configured" },
      { from: "configured", to: "search", label: "configured" },
      { from: "configured", to: "stop", kind: "stop", label: "missing configuration" },
      { from: "search", to: "details" },
      { from: "details", to: "filter" },
      { from: "filter", to: "report" },
    ],
  ),
  "services.shopify-products": defineWorkflow(
    "services.shopify-products",
    "Read or update Shopify product content",
    "Resolve an exact product, branch read versus update, and verify text fields without touching images.",
    [
      { key: "intent", name: "Choose list, read or update", description: "Identify the requested Shopify operation and exact product target.", kind: "decision" },
      { key: "configured", parent: "intent", name: "Check store configuration", description: "Require the store and Admin API token that register these tools.", kind: "decision" },
      { key: "list", parent: "intent", name: "List products", description: "Return bounded product identifiers and titles.", kind: "operation", toolName: "shopify_list_products", producesEvidence: ["api-response"] },
      { key: "get", parent: "intent", name: "Read exact product", description: "Fetch the current title and description for one identifier.", kind: "operation", toolName: "shopify_get_product", producesEvidence: ["api-response"] },
      { key: "prepare", parent: "intent", name: "Prepare text-only update", description: "Preserve description image tags and omit the Shopify images array entirely.", kind: "decision" },
      { key: "update", parent: "prepare", name: "Update product", description: "Send one Admin API update for the exact product title or description.", kind: "external-action", toolName: "shopify_update_product", producesEvidence: ["api-response", "tool-result"] },
      { key: "verify", parent: "update", name: "Read back changed fields", description: "Confirm the API representation contains the intended title or description.", kind: "verification", toolName: "shopify_get_product", producesEvidence: ["api-response"] },
      { key: "stop", parent: "configured", name: "Stop for setup or ambiguity", description: "Do not update without credentials or one exact product.", kind: "stop" },
    ],
    [
      { from: "intent", to: "configured" },
      { from: "configured", to: "stop", kind: "stop", label: "not configured" },
      { from: "configured", to: "list", kind: "branch", label: "list" },
      { from: "configured", to: "get", kind: "branch", label: "read" },
      { from: "configured", to: "prepare", kind: "branch", label: "update" },
      { from: "prepare", to: "update" },
      { from: "update", to: "verify", kind: "verification" },
    ],
  ),
  "self-improvement.pipeline": defineWorkflow(
    "self-improvement.pipeline",
    "Ship a guarded AVA improvement",
    "Queue one intent, implement in isolation, verify before swap and roll back automatically if health degrades.",
    [
      { key: "queue", name: "Queue improvement intent", description: "Persist the bounded goal and serialize it behind any active mutation.", kind: "request", toolName: "self_improve", producesEvidence: ["task-event"] },
      { key: "reflect", parent: "queue", name: "Reflect into change brief", description: "Turn the goal and grounded friction into a concrete, protected-surface-aware brief.", kind: "operation", producesEvidence: ["artifact"] },
      { key: "guard", parent: "reflect", capabilityId: "security.risk-policy", name: "Apply self-safety guard", description: "Reject changes to security, auth, policy, sandbox, approval and self-improvement guard machinery.", kind: "verification", producesEvidence: ["task-event"] },
      { key: "approval", parent: "queue", capabilityId: "notifications.push-approvals", name: "Resolve user-requested plan", description: "Pause user-requested changes at awaiting_approval until Sir approves or rejects.", kind: "decision", producesEvidence: ["task-event"] },
      { key: "worktree", parent: "queue", name: "Create isolated worktree", description: "Prepare a fresh temporary Git worktree instead of editing the live tree.", kind: "operation", producesEvidence: ["artifact"] },
      { key: "implement", parent: "worktree", capabilityId: "coding.project-work", name: "Implement with coding worker", description: "Run the bounded Claude worker only inside the isolated worktree.", kind: "external-action", toolName: "claude_code", producesEvidence: ["artifact", "tool-result"] },
      { key: "verify", parent: "worktree", capabilityId: "verification.outcome-evidence", name: "Verify tests, builds and boot", description: "Run tests, web build, server build and scratch-port boot smoke.", kind: "verification", producesEvidence: ["unit-test", "exit-code", "health-check"] },
      { key: "swap", parent: "queue", name: "Commit and hot-swap", description: "Apply the verified commit to the live tree and append its changelog.", kind: "external-action", producesEvidence: ["artifact", "task-event"] },
      { key: "watchdog", parent: "swap", name: "Watch post-swap health", description: "Poll the live server after swap and preserve the last known good commit.", kind: "verification", producesEvidence: ["health-check"] },
      { key: "rollback", parent: "watchdog", name: "Roll back unhealthy change", description: "Restore the last known good revision when post-swap health fails.", kind: "external-action", producesEvidence: ["artifact", "health-check"] },
      { key: "shipped", parent: "queue", name: "Record shipped state", description: "Mark the intent shipped only after verification and healthy swap evidence.", kind: "result", producesEvidence: ["task-event"] },
      { key: "failed", parent: "queue", name: "Record rejected or failed state", description: "Keep failure evidence without mutating the live tree further.", kind: "stop", producesEvidence: ["task-event"] },
    ],
    [
      { from: "queue", to: "reflect" },
      { from: "reflect", to: "guard" },
      { from: "guard", to: "approval", label: "allowed scope" },
      { from: "guard", to: "failed", kind: "stop", label: "protected surface" },
      { from: "approval", to: "worktree", kind: "branch", label: "approved or unattended" },
      { from: "approval", to: "failed", kind: "stop", label: "rejected" },
      { from: "worktree", to: "implement" },
      { from: "implement", to: "verify" },
      { from: "verify", to: "swap", label: "all checks pass" },
      { from: "verify", to: "failed", kind: "stop", label: "verification failed" },
      { from: "swap", to: "watchdog" },
      { from: "watchdog", to: "shipped", kind: "branch", label: "healthy" },
      { from: "watchdog", to: "rollback", kind: "fallback", label: "unhealthy" },
      { from: "rollback", to: "failed" },
    ],
  ),
  "developer-collaboration.claude": defineWorkflow(
    "developer-collaboration.claude",
    "Read or request Claude development context",
    "Keep attributed developer notes separate from background consultation and from proof of live changes.",
    [
      { key: "intent", name: "Choose updates or discussion", description: "Distinguish reading existing developer notes from asking a new question.", kind: "decision" },
      { key: "updates", parent: "intent", name: "Read append-only update log", description: "Load recent started, shipped and note records with their original author and timestamp.", kind: "operation", toolName: "read_claude_updates", producesEvidence: ["artifact", "tool-result"] },
      { key: "queue", parent: "intent", name: "Queue background discussion", description: "Start a read-only Claude CLI consultation and return immediately with its ID.", kind: "external-action", toolName: "discuss_with_claude", producesEvidence: ["tool-result"] },
      { key: "continue", parent: "queue", name: "Continue AVA conversation", description: "Do not freeze the current chat while Claude works.", kind: "operation" },
      { key: "read", parent: "queue", name: "Read completed discussion", description: "Retrieve the exact discussion result by ID when it is ready.", kind: "operation", toolName: "read_discussion", producesEvidence: ["tool-result"] },
      { key: "attribute", parent: "intent", name: "Preserve authorship", description: "State whether an item came from Claude, AVA, Codex or Sir and do not convert advice into a shipped claim.", kind: "verification", producesEvidence: ["artifact"] },
      { key: "report", parent: "intent", name: "Report development context", description: "Summarise the attributed note or discussion with its evidentiary limits.", kind: "result" },
    ],
    [
      { from: "intent", to: "updates", kind: "branch", label: "what changed" },
      { from: "intent", to: "queue", kind: "branch", label: "ask Claude" },
      { from: "queue", to: "continue" },
      { from: "continue", to: "read" },
      { from: "updates", to: "attribute" },
      { from: "read", to: "attribute" },
      { from: "attribute", to: "report" },
    ],
  ),
  "security.risk-policy": defineWorkflow(
    "security.risk-policy",
    "Classify and enforce a tool action",
    "Apply non-overridable blocks first, then user rules and ordinary risk tiers before dispatch.",
    [
      { key: "proposal", name: "Receive proposed tool call", description: "Take the tool identity and sanitised arguments before execution.", kind: "request" },
      { key: "hard-block", parent: "proposal", name: "Check hard-block patterns", description: "Detect environment secrets, permission bypasses and prohibited destructive patterns first.", kind: "decision" },
      { key: "rules", parent: "proposal", name: "Match autonomy rules", description: "Apply enabled user allow, deny or force-ask rules that do not override hard blocks.", kind: "decision" },
      { key: "tier", parent: "proposal", name: "Classify default risk", description: "Assign read-only, low, medium, high or blocked using tool and argument semantics.", kind: "decision" },
      { key: "allow", parent: "tier", name: "Allow dispatch", description: "Return an allow decision for read-only/low or explicitly pre-allowed work.", kind: "result", producesEvidence: ["task-event"] },
      { key: "ask", parent: "tier", capabilityId: "notifications.push-approvals", name: "Create approval", description: "Pause medium/high or force-ask work for an explicit decision.", kind: "result", producesEvidence: ["task-event"] },
      { key: "deny", parent: "tier", name: "Deny or hard-block", description: "Return a non-dispatching decision with the specific reason.", kind: "stop", producesEvidence: ["task-event"] },
    ],
    [
      { from: "proposal", to: "hard-block" },
      { from: "hard-block", to: "deny", kind: "stop", label: "hard block" },
      { from: "hard-block", to: "rules", label: "not blocked" },
      { from: "rules", to: "allow", kind: "branch", label: "rule allows" },
      { from: "rules", to: "deny", kind: "stop", label: "rule denies" },
      { from: "rules", to: "ask", kind: "branch", label: "rule asks" },
      { from: "rules", to: "tier", kind: "branch", label: "no matching rule" },
      { from: "tier", to: "allow", kind: "branch", label: "read-only or low" },
      { from: "tier", to: "ask", kind: "branch", label: "medium or high" },
      { from: "tier", to: "deny", kind: "stop", label: "blocked" },
    ],
  ),
  "security.secret-redaction": defineWorkflow(
    "security.secret-redaction",
    "Sanitise sensitive operational data",
    "Redact structured sensitive fields and supported secret patterns before persistence or display.",
    [
      { key: "boundary", name: "Enter logging or storage boundary", description: "Receive memory text, tool arguments, output or export data before it is persisted.", kind: "request" },
      { key: "field-policy", parent: "boundary", name: "Remove designated secret fields", description: "Replace tool-declared password, token, cookie and authentication fields.", kind: "operation" },
      { key: "patterns", parent: "boundary", name: "Scrub known credential patterns", description: "Detect API keys, bearer values, password lines and private-key material in text.", kind: "operation" },
      { key: "query", parent: "boundary", name: "Sanitise sensitive query data", description: "Remove designated sensitive URL parameters and headers.", kind: "operation" },
      { key: "verify", parent: "boundary", name: "Check sanitised representation", description: "Require supported secret patterns to be absent and avoid retaining a raw fallback field.", kind: "verification", producesEvidence: ["unit-test"] },
      { key: "drop", parent: "verify", name: "Drop unsafe field", description: "Remove content entirely when it cannot be represented safely.", kind: "stop" },
      { key: "persist", parent: "verify", name: "Persist sanitised data only", description: "Pass only the redacted representation to memory, events, logs or exports.", kind: "result", producesEvidence: ["artifact"] },
    ],
    [
      { from: "boundary", to: "field-policy" },
      { from: "field-policy", to: "patterns" },
      { from: "patterns", to: "query" },
      { from: "query", to: "verify" },
      { from: "verify", to: "persist", kind: "branch", label: "safe" },
      { from: "verify", to: "drop", kind: "stop", label: "cannot sanitise" },
    ],
  ),
  "verification.outcome-evidence": defineWorkflow(
    "verification.outcome-evidence",
    "Classify an outcome from direct evidence",
    "Select evidence appropriate to the claimed side effect and refuse unsupported success.",
    [
      { key: "claim", name: "Receive proposed outcome", description: "Capture what AVA intends to report and the exact resource or side effect involved.", kind: "request" },
      { key: "criteria", parent: "claim", name: "Select success criteria", description: "Choose exit code, API response, DOM state, visual confirmation, artifact or task event appropriate to the action.", kind: "decision" },
      { key: "collect", parent: "criteria", name: "Collect direct evidence", description: "Link evidence emitted by the operation rather than reconstructing it from prose.", kind: "operation" },
      { key: "compare", parent: "criteria", name: "Compare evidence to claim", description: "Check target identity, requested value and resulting state.", kind: "verification", producesEvidence: ["task-event"] },
      { key: "verified", parent: "compare", name: "Completed and verified", description: "Use only when direct evidence covers the requested outcome.", kind: "result", producesEvidence: ["task-event"] },
      { key: "partial", parent: "compare", name: "Completed but partially verified", description: "State exactly which portion succeeded and which proof is missing.", kind: "result", producesEvidence: ["task-event"] },
      { key: "retry", parent: "compare", name: "Retry verification or safe action", description: "Repeat only the failed check or choose an evidence-producing fallback.", kind: "operation" },
      { key: "failed", parent: "compare", name: "Report unverified or failed", description: "Do not convert an attempted call or assistant statement into success.", kind: "stop", producesEvidence: ["task-event"] },
    ],
    [
      { from: "claim", to: "criteria" },
      { from: "criteria", to: "collect" },
      { from: "collect", to: "compare" },
      { from: "compare", to: "verified", kind: "branch", label: "sufficient" },
      { from: "compare", to: "partial", kind: "branch", label: "partial evidence" },
      { from: "compare", to: "retry", kind: "fallback", label: "recoverable" },
      { from: "compare", to: "failed", kind: "stop", label: "failed" },
      { from: "retry", to: "collect", kind: "retry", label: "re-check" },
    ],
  ),
  "interface.pwa": defineWorkflow(
    "interface.pwa",
    "Reach and use AVA's private interface",
    "Pair a device, authenticate API calls and move among AVA surfaces while preserving active work.",
    [
      { key: "load", name: "Load PWA shell", description: "Open the installed or browser-hosted phone interface over the configured private network.", kind: "request" },
      { key: "token", parent: "load", name: "Check paired-device token", description: "Read the local device credential and attach it only to AVA API requests.", kind: "decision" },
      { key: "pair", parent: "token", name: "Pair device", description: "Exchange a valid short-lived six-character code for a revocable device token.", kind: "external-action", producesEvidence: ["api-response"] },
      { key: "navigate", parent: "load", name: "Choose AVA surface", description: "Navigate Home, Chats, Memory, Explore, Rules, Self, Chat or Voice.", kind: "decision" },
      { key: "request", parent: "navigate", name: "Call authenticated API", description: "Send conversation, memory, approval or control requests with the paired token.", kind: "operation", producesEvidence: ["api-response"] },
      { key: "stream", parent: "navigate", name: "Render live state", description: "Show stream events, active steps, approvals and terminal results without exposing raw secrets.", kind: "operation", producesEvidence: ["task-event"] },
      { key: "unauthorized", parent: "token", name: "Clear invalid token", description: "On a 401, remove the stale token and return to pairing rather than looping failed requests.", kind: "stop", producesEvidence: ["api-response"] },
      { key: "ready", parent: "load", name: "Interactive surface ready", description: "Render the selected authenticated surface and preserve session navigation.", kind: "result" },
    ],
    [
      { from: "load", to: "token" },
      { from: "token", to: "pair", kind: "branch", label: "not paired" },
      { from: "pair", to: "navigate" },
      { from: "token", to: "navigate", kind: "branch", label: "valid token" },
      { from: "token", to: "unauthorized", kind: "stop", label: "invalid token" },
      { from: "navigate", to: "request" },
      { from: "request", to: "stream" },
      { from: "stream", to: "ready" },
    ],
  ),
};

export const EXPLORER_CAPABILITIES: readonly ExplorerCapability[] = capabilities.map(
  (capability) => ({
    ...capability,
    workflow: WORKFLOW_BY_CAPABILITY_ID[capability.id],
  }),
);

export const CAPABILITY_BY_ID: ReadonlyMap<ExplorerCapabilityId, ExplorerCapability> =
  new Map(EXPLORER_CAPABILITIES.map((capability) => [capability.id, capability]));

export const DOMAIN_BY_ID: ReadonlyMap<ExplorerDomainId, ExplorerDomain> =
  new Map(EXPLORER_DOMAINS.map((domain) => [domain.id, domain]));

export const EXPLORER_REGISTRY: ExplorerRegistry = {
  domains: EXPLORER_DOMAINS,
  capabilities: EXPLORER_CAPABILITIES,
};

export function getCapability(id: ExplorerCapabilityId): ExplorerCapability | undefined {
  return CAPABILITY_BY_ID.get(id);
}

export function getDomainCapabilities(domainId: ExplorerDomainId): readonly ExplorerCapability[] {
  return EXPLORER_CAPABILITIES.filter((capability) => capability.domainId === domainId);
}

export function getChildCapabilities(parentId: ExplorerCapabilityId): readonly ExplorerCapability[] {
  return EXPLORER_CAPABILITIES.filter((capability) => capability.parentId === parentId);
}

export type RegistryValidationCode =
  | "duplicate-domain-id"
  | "duplicate-domain-order"
  | "empty-domain"
  | "duplicate-capability-id"
  | "unknown-domain"
  | "unknown-parent"
  | "cross-domain-parent"
  | "cyclic-hierarchy"
  | "invalid-id"
  | "missing-source"
  | "invalid-source-path"
  | "duplicate-readiness-dimension"
  | "missing-defined-readiness"
  | "unknown-capability-dependency"
  | "duplicate-runtime-tool"
  | "duplicate-runtime-snapshot-path"
  | "missing-workflow"
  | "duplicate-workflow-id"
  | "duplicate-workflow-node-id"
  | "duplicate-workflow-edge-id"
  | "unknown-workflow-entry"
  | "unknown-workflow-node-capability"
  | "unknown-workflow-node-parent"
  | "cyclic-workflow-node-hierarchy"
  | "unknown-workflow-edge-node"
  | "unreachable-workflow-node";

export type RegistryValidationIssue = {
  code: RegistryValidationCode;
  path: string;
  message: string;
};

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/**
 * Runtime-safe validation is exported because future registry data may be loaded
 * from generated modules. Tests invoke the same checks the UI can use in
 * development, preventing a broken graph from failing only at render time.
 */
export function validateExplorerRegistry(
  registry: ExplorerRegistry = EXPLORER_REGISTRY,
): RegistryValidationIssue[] {
  const issues: RegistryValidationIssue[] = [];
  const domainIds = new Set<string>();
  const domainOrders = new Set<number>();
  const capabilityIds = new Set<string>();

  for (const [index, domain] of registry.domains.entries()) {
    const path = `domains[${index}]`;
    if (!ID_PATTERN.test(domain.id)) {
      issues.push({ code: "invalid-id", path: `${path}.id`, message: `Invalid domain id: ${domain.id}` });
    }
    if (domainIds.has(domain.id)) {
      issues.push({ code: "duplicate-domain-id", path: `${path}.id`, message: `Duplicate domain id: ${domain.id}` });
    }
    if (domainOrders.has(domain.order)) {
      issues.push({ code: "duplicate-domain-order", path: `${path}.order`, message: `Duplicate domain order: ${domain.order}` });
    }
    domainIds.add(domain.id);
    domainOrders.add(domain.order);
  }

  for (const [index, capability] of registry.capabilities.entries()) {
    const path = `capabilities[${index}]`;
    if (!ID_PATTERN.test(capability.id)) {
      issues.push({ code: "invalid-id", path: `${path}.id`, message: `Invalid capability id: ${capability.id}` });
    }
    if (capabilityIds.has(capability.id)) {
      issues.push({ code: "duplicate-capability-id", path: `${path}.id`, message: `Duplicate capability id: ${capability.id}` });
    }
    capabilityIds.add(capability.id);
  }

  for (const domain of registry.domains) {
    if (!registry.capabilities.some((capability) => capability.domainId === domain.id)) {
      issues.push({ code: "empty-domain", path: `domain:${domain.id}`, message: `Domain has no capabilities: ${domain.id}` });
    }
  }

  const capabilityById = new Map(registry.capabilities.map((capability) => [capability.id, capability]));
  const workflowIds = new Set<string>();
  const workflowNodeIds = new Set<string>();
  const workflowEdgeIds = new Set<string>();

  for (const capability of registry.capabilities) {
    const path = `capability:${capability.id}`;
    if (!domainIds.has(capability.domainId)) {
      issues.push({ code: "unknown-domain", path: `${path}.domainId`, message: `Unknown domain: ${capability.domainId}` });
    }
    if (capability.parentId) {
      const parent = capabilityById.get(capability.parentId);
      if (!parent) {
        issues.push({ code: "unknown-parent", path: `${path}.parentId`, message: `Unknown parent: ${capability.parentId}` });
      } else if (parent.domainId !== capability.domainId) {
        issues.push({
          code: "cross-domain-parent",
          path: `${path}.parentId`,
          message: `Parent ${parent.id} belongs to ${parent.domainId}, not ${capability.domainId}`,
        });
      }
    }

    const seenAncestors = new Set<string>([capability.id]);
    let parentId = capability.parentId;
    while (parentId) {
      if (seenAncestors.has(parentId)) {
        issues.push({ code: "cyclic-hierarchy", path: `${path}.parentId`, message: `Hierarchy cycle reaches ${parentId}` });
        break;
      }
      seenAncestors.add(parentId);
      parentId = capabilityById.get(parentId)?.parentId;
    }

    if (capability.definition.sourceReferences.length === 0) {
      issues.push({ code: "missing-source", path: `${path}.definition`, message: "Capability has no source reference." });
    }
    for (const [sourceIndex, reference] of capability.definition.sourceReferences.entries()) {
      if (
        !reference.path ||
        reference.path.includes("\\") ||
        reference.path.startsWith("/") ||
        /^[a-z]:/i.test(reference.path) ||
        reference.path.split("/").includes("..")
      ) {
        issues.push({
          code: "invalid-source-path",
          path: `${path}.definition.sourceReferences[${sourceIndex}].path`,
          message: `Source reference must be a repository-relative forward-slash path: ${reference.path}`,
        });
      }
    }

    const readinessDimensions = new Set<ReadinessDimension>();
    for (const [readinessIndex, requirement] of capability.readiness.entries()) {
      if (readinessDimensions.has(requirement.dimension)) {
        issues.push({
          code: "duplicate-readiness-dimension",
          path: `${path}.readiness[${readinessIndex}]`,
          message: `Duplicate readiness dimension: ${requirement.dimension}`,
        });
      }
      readinessDimensions.add(requirement.dimension);
    }
    if (!capability.readiness.some((requirement) => requirement.dimension === "defined" && requirement.required)) {
      issues.push({
        code: "missing-defined-readiness",
        path: `${path}.readiness`,
        message: "Every capability must require source-definition evidence.",
      });
    }

    for (const [dependencyIndex, dependency] of capability.dependencies.entries()) {
      if (dependency.targetType === "capability" && !capabilityById.has(dependency.targetId)) {
        issues.push({
          code: "unknown-capability-dependency",
          path: `${path}.dependencies[${dependencyIndex}]`,
          message: `Unknown capability dependency: ${dependency.targetId}`,
        });
      }
    }

    const runtimeTools = new Set<string>();
    for (const [toolIndex, toolName] of (capability.runtime?.toolNames ?? []).entries()) {
      if (runtimeTools.has(toolName)) {
        issues.push({
          code: "duplicate-runtime-tool",
          path: `${path}.runtime.toolNames[${toolIndex}]`,
          message: `Duplicate runtime tool: ${toolName}`,
        });
      }
      runtimeTools.add(toolName);
    }
    const snapshotPaths = new Set<string>();
    for (const [bindingIndex, binding] of (capability.runtime?.snapshot ?? []).entries()) {
      if (snapshotPaths.has(binding.path)) {
        issues.push({
          code: "duplicate-runtime-snapshot-path",
          path: `${path}.runtime.snapshot[${bindingIndex}]`,
          message: `Duplicate runtime snapshot path: ${binding.path}`,
        });
      }
      snapshotPaths.add(binding.path);
    }

    const workflow = capability.workflow;
    if (!workflow) {
      issues.push({
        code: "missing-workflow",
        path: `${path}.workflow`,
        message: "Every Explorer capability must define an operational workflow.",
      });
      continue;
    }
    if (workflowIds.has(workflow.id)) {
      issues.push({ code: "duplicate-workflow-id", path: `${path}.workflow.id`, message: `Duplicate workflow id: ${workflow.id}` });
    }
    workflowIds.add(workflow.id);

    const localNodeIds = new Set<string>();
    const localNodeById = new Map<string, ExplorerWorkflowNode>();
    for (const [nodeIndex, node] of workflow.nodes.entries()) {
      if (!ID_PATTERN.test(node.id)) {
        issues.push({ code: "invalid-id", path: `${path}.workflow.nodes[${nodeIndex}].id`, message: `Invalid node id: ${node.id}` });
      }
      if (localNodeIds.has(node.id) || workflowNodeIds.has(node.id)) {
        issues.push({
          code: "duplicate-workflow-node-id",
          path: `${path}.workflow.nodes[${nodeIndex}].id`,
          message: `Duplicate workflow node id: ${node.id}`,
        });
      }
      localNodeIds.add(node.id);
      localNodeById.set(node.id, node);
      workflowNodeIds.add(node.id);
      if (!capabilityById.has(node.capabilityId)) {
        issues.push({
          code: "unknown-workflow-node-capability",
          path: `${path}.workflow.nodes[${nodeIndex}].capabilityId`,
          message: `Unknown workflow node capability: ${node.capabilityId}`,
        });
      }
    }
    for (const [nodeIndex, node] of workflow.nodes.entries()) {
      if (!node.parentNodeId) continue;
      if (!localNodeIds.has(node.parentNodeId)) {
        issues.push({
          code: "unknown-workflow-node-parent",
          path: `${path}.workflow.nodes[${nodeIndex}].parentNodeId`,
          message: `Unknown workflow node parent: ${node.parentNodeId}`,
        });
        continue;
      }
      const seenParents = new Set<string>([node.id]);
      let parentNodeId: string | undefined = node.parentNodeId;
      while (parentNodeId) {
        if (seenParents.has(parentNodeId)) {
          issues.push({
            code: "cyclic-workflow-node-hierarchy",
            path: `${path}.workflow.nodes[${nodeIndex}].parentNodeId`,
            message: `Workflow node hierarchy cycle reaches ${parentNodeId}`,
          });
          break;
        }
        seenParents.add(parentNodeId);
        parentNodeId = localNodeById.get(parentNodeId)?.parentNodeId;
      }
    }
    if (!localNodeIds.has(workflow.entryNodeId)) {
      issues.push({
        code: "unknown-workflow-entry",
        path: `${path}.workflow.entryNodeId`,
        message: `Entry node does not exist in workflow: ${workflow.entryNodeId}`,
      });
    }

    const adjacency = new Map<string, string[]>();
    for (const [edgeIndex, edge] of workflow.edges.entries()) {
      if (workflowEdgeIds.has(edge.id)) {
        issues.push({
          code: "duplicate-workflow-edge-id",
          path: `${path}.workflow.edges[${edgeIndex}].id`,
          message: `Duplicate workflow edge id: ${edge.id}`,
        });
      }
      workflowEdgeIds.add(edge.id);
      if (!localNodeIds.has(edge.from) || !localNodeIds.has(edge.to)) {
        issues.push({
          code: "unknown-workflow-edge-node",
          path: `${path}.workflow.edges[${edgeIndex}]`,
          message: `Edge references a node outside its workflow: ${edge.from} -> ${edge.to}`,
        });
      }
      adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
    }

    if (localNodeIds.has(workflow.entryNodeId)) {
      const reachable = new Set<string>();
      const pending = [workflow.entryNodeId];
      while (pending.length) {
        const current = pending.pop()!;
        if (reachable.has(current)) continue;
        reachable.add(current);
        pending.push(...(adjacency.get(current) ?? []));
      }
      for (const nodeId of localNodeIds) {
        if (!reachable.has(nodeId)) {
          issues.push({
            code: "unreachable-workflow-node",
            path: `${path}.workflow.nodes`,
            message: `Workflow node is unreachable from entry: ${nodeId}`,
          });
        }
      }
    }
  }

  return issues;
}
