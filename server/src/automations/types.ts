export const AUTOMATION_SCHEMA_VERSION = 1 as const;

export const SYSTEM_REPORT_WORKFLOW = {
  id: "ava.system-report",
  version: 1,
  displayName: "AVA system health report",
  trigger: "manual",
  risk: "read_only",
} as const;

export type AutomationRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "unavailable";

export type AutomationProviderHealth = {
  schemaVersion: 1;
  provider: "activepieces";
  configured: boolean;
  available: boolean;
  executionMode: "sync_webhook" | "unavailable";
  reason: string;
  workflow: typeof SYSTEM_REPORT_WORKFLOW;
  timeoutMs: number;
  runtimeEvidence: "configured_endpoint" | "missing_configuration" | "deterministic_fixture";
  usage: "not_reported";
  cost: "not_reported";
};

export type AutomationSystemSnapshot = {
  generatedAt: number;
  ready: boolean;
  provider: string | null;
  core: {
    brainReady: boolean;
    voiceReady: boolean;
    browserReady: boolean;
    memoryReady: boolean;
  };
  counts: {
    preferences: number;
    observations: number;
    projects: number;
    people: number;
    playbooks: number;
    watches: number;
  };
  integrations: {
    instagram: boolean;
    whatsapp: boolean;
    shopify: boolean;
    googlePlaces: boolean;
    screenVision: boolean;
    push: boolean;
    microsoftUfoAvailable: boolean;
  };
};

export type AutomationExecutorStep = {
  id: string;
  status: "completed" | "failed" | "skipped";
  summary: string;
  durationMs: number | null;
};

export type AutomationExecutorResult = {
  schemaVersion: 1;
  workflowId: string;
  workflowVersion: number;
  requestKey: string;
  externalRunId: string | null;
  providerVersion: string | null;
  status: "succeeded" | "failed";
  steps: AutomationExecutorStep[];
  report: {
    title: string;
    markdown: string;
  } | null;
  error: {
    code: string;
    message: string;
  } | null;
  usage: "not_reported";
  cost: "not_reported";
};

export type AutomationExecutor = {
  readonly id: "activepieces" | "deterministic_fixture";
  health(): AutomationProviderHealth;
  execute(input: {
    requestKey: string;
    workflowId: string;
    workflowVersion: number;
    snapshot: AutomationSystemSnapshot;
    signal: AbortSignal;
  }): Promise<AutomationExecutorResult>;
};

export type AutomationRun = {
  id: string;
  requestKey: string;
  workflowId: string;
  workflowVersion: number;
  executor: string;
  externalRunId: string | null;
  observabilityRunId: string;
  status: AutomationRunStatus;
  version: number;
  stepCount: number;
  inputSummary: unknown;
  outputSummary: unknown;
  artifactPath: string | null;
  artifactHash: string | null;
  memoryEntryId: string | null;
  verificationState: "unverified" | "verified" | "contradicted" | "unavailable";
  verificationMethod: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};
