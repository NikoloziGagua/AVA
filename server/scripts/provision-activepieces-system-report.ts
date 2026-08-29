import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(scriptDir, "..", "..");
const envPath = resolve(repoDir, ".env");
loadDotEnv({ path: envPath, quiet: true });

const apiBase = (process.env.ACTIVEPIECES_LOCAL_API_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const adminEmail = process.env.ACTIVEPIECES_LOCAL_ADMIN_EMAIL || "ava.activepieces@local.test";
const adminPassword = process.env.ACTIVEPIECES_LOCAL_ADMIN_PASSWORD || randomBytes(24).toString("base64url");
const webhookToken = process.env.ACTIVEPIECES_WEBHOOK_TOKEN || randomBytes(32).toString("base64url");
type Json = Record<string, unknown>;
type WorkflowSpec = {
  id: "ava.system-report" | "ava.operations-brief" | "ava.approved-action-plan";
  version: 1;
  flowName: string;
  triggerName: string;
  reportTitle: string;
  envKey: "ACTIVEPIECES_SYSTEM_REPORT_WEBHOOK_URL" | "ACTIVEPIECES_OPERATIONS_BRIEF_WEBHOOK_URL" |
    "ACTIVEPIECES_APPROVED_ACTION_PLAN_WEBHOOK_URL";
  steps: Array<{ id: string; summary: string }>;
  markdown: string;
};

async function request(path: string, init: RequestInit = {}, token?: string): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body: Json = {};
  if (text) {
    try { body = JSON.parse(text) as Json; }
    catch { body = { message: text.slice(0, 500) }; }
  }
  return { status: response.status, body };
}

async function waitUntilReady(): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const result = await request("/api/v1/flags");
      if (result.status === 200) return;
    } catch {
      // Runtime is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  throw new Error(`Activepieces did not become ready at ${apiBase}`);
}

async function authenticate(): Promise<{ token: string; projectId: string }> {
  const signIn = await request("/api/v1/authentication/sign-in", {
    method: "POST",
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  let response = signIn;
  if (signIn.status !== 200) {
    response = await request("/api/v1/authentication/sign-up", {
      method: "POST",
      body: JSON.stringify({
        email: adminEmail,
        password: adminPassword,
        firstName: "AVA",
        lastName: "Automation",
        trackEvents: false,
        newsLetter: false,
      }),
    });
  }
  if (response.status !== 200 || typeof response.body.token !== "string" || typeof response.body.projectId !== "string") {
    throw new Error(`Activepieces authentication failed with HTTP ${response.status}`);
  }
  return { token: response.body.token, projectId: response.body.projectId };
}

const systemReportMarkdown = [
    "# AVA System Health Report",
    "",
    "Generated: {{trigger['body']['snapshot']['generatedAtIso']}}",
    "",
    "## Core",
    "",
    "- Overall ready: {{trigger['body']['snapshot']['ready']}}",
    "- Brain ready: {{trigger['body']['snapshot']['core']['brainReady']}}",
    "- Voice ready: {{trigger['body']['snapshot']['core']['voiceReady']}}",
    "- Browser ready: {{trigger['body']['snapshot']['core']['browserReady']}}",
    "- Memory ready: {{trigger['body']['snapshot']['core']['memoryReady']}}",
    "- Provider: {{trigger['body']['snapshot']['provider']}}",
    "",
    "## Durable state",
    "",
    "- Preferences: {{trigger['body']['snapshot']['counts']['preferences']}}",
    "- Observations: {{trigger['body']['snapshot']['counts']['observations']}}",
    "- Projects: {{trigger['body']['snapshot']['counts']['projects']}}",
    "- People: {{trigger['body']['snapshot']['counts']['people']}}",
    "- Learned playbooks: {{trigger['body']['snapshot']['counts']['playbooks']}}",
    "- Enabled watches: {{trigger['body']['snapshot']['counts']['watches']}}",
    "",
    "## Integrations",
    "",
    "- Instagram: {{trigger['body']['snapshot']['integrations']['instagram']}}",
    "- WhatsApp: {{trigger['body']['snapshot']['integrations']['whatsapp']}}",
    "- Activepieces: true",
    "",
    "This report was assembled by the pinned Activepieces workflow from AVA's bounded readiness snapshot. No credentials or raw memories were supplied.",
].join("\n");

const operationsBriefMarkdown = [
  "# AVA Operations Brief",
  "",
  "Generated: {{trigger['body']['snapshot']['generatedAtIso']}}",
  "Window: last {{trigger['body']['snapshot']['windowHours']}} hours",
  "",
  "## Readiness",
  "",
  "- Overall ready: {{trigger['body']['snapshot']['readiness']['ready']}}",
  "- Provider: {{trigger['body']['snapshot']['readiness']['provider']}}",
  "- Brain ready: {{trigger['body']['snapshot']['readiness']['brainReady']}}",
  "- Voice ready: {{trigger['body']['snapshot']['readiness']['voiceReady']}}",
  "- Browser ready: {{trigger['body']['snapshot']['readiness']['browserReady']}}",
  "- Memory ready: {{trigger['body']['snapshot']['readiness']['memoryReady']}}",
  "",
  "## Last 24 hours",
  "",
  "- Runs: {{trigger['body']['snapshot']['recentRuns']['total']}}",
  "- Active: {{trigger['body']['snapshot']['recentRuns']['active']}}",
  "- Completed: {{trigger['body']['snapshot']['recentRuns']['completed']}}",
  "- Failed: {{trigger['body']['snapshot']['recentRuns']['failed']}}",
  "- Cancelled: {{trigger['body']['snapshot']['recentRuns']['cancelled']}}",
  "- Timed out: {{trigger['body']['snapshot']['recentRuns']['timedOut']}}",
  "- Verified: {{trigger['body']['snapshot']['recentRuns']['verified']}}",
  "- Not verified: {{trigger['body']['snapshot']['recentRuns']['notVerified']}}",
  "",
  "## Attention",
  "",
  "- Pending approvals: {{trigger['body']['snapshot']['attention']['pendingApprovals']}}",
  "- Blocked Self improvements: {{trigger['body']['snapshot']['attention']['blockedSelfImprovements']}}",
  "- Blocked watcher successors: {{trigger['body']['snapshot']['attention']['blockedWatcherSuccessors']}}",
  "",
  "## Work and knowledge",
  "",
  "- Pinned notes: {{trigger['body']['snapshot']['work']['pinnedNotes']}}",
  "- Notes doing: {{trigger['body']['snapshot']['work']['notesDoing']}}",
  "- Notes in review: {{trigger['body']['snapshot']['work']['notesInReview']}}",
  "- Active Self improvements: {{trigger['body']['snapshot']['work']['activeSelfImprovements']}}",
  "- Shipped Self improvements: {{trigger['body']['snapshot']['work']['shippedSelfImprovements']}}",
  "- Enabled watches: {{trigger['body']['snapshot']['work']['enabledWatches']}}",
  "- Active memory entries: {{trigger['body']['snapshot']['knowledge']['activeMemoryEntries']}}",
  "- Verified memory sources: {{trigger['body']['snapshot']['knowledge']['verifiedMemorySources']}}",
  "",
  "This brief was assembled by the pinned Activepieces workflow from bounded AVA counts. No prompts, note bodies, memory content, credentials, or raw logs were supplied.",
].join("\n");

const approvedActionPlanMarkdown = [
  "# AVA Approved Action Plan",
  "",
  "Generated: {{trigger['body']['snapshot']['generatedAtIso']}}",
  "",
  "## Definition",
  "",
  "- Playbook: {{trigger['body']['snapshot']['playbookId']}}",
  "- Revision: {{trigger['body']['snapshot']['revision']}}",
  "- Name: {{trigger['body']['snapshot']['displayName']}}",
  "",
  "## Approved steps",
  "",
  "- {{trigger['body']['snapshot']['action']['tool']}}: {{trigger['body']['snapshot']['action']['targetLabel']}} (@{{trigger['body']['snapshot']['action']['targetIdentity']}})",
  "",
  "## Evidence boundary",
  "",
  "- Approval: {{trigger['body']['snapshot']['approval']['state']}}",
  "- Verified source tasks: {{trigger['body']['snapshot']['approval']['evidenceTaskCount']}}",
  "- Evidence fingerprint: {{trigger['body']['snapshot']['approval']['evidenceFingerprint']}}",
  "",
  "Activepieces validated this bounded plan. AVA still owns identity revalidation, local execution, and outcome verification.",
].join("\n");

const workflows: WorkflowSpec[] = [
  {
    id: "ava.system-report", version: 1, flowName: "AVA System Health Report",
    triggerName: "AVA system-report webhook", reportTitle: "AVA System Health Report",
    envKey: "ACTIVEPIECES_SYSTEM_REPORT_WEBHOOK_URL",
    steps: [
      { id: "accept_snapshot", summary: "Accepted AVA's bounded readiness snapshot." },
      { id: "build_report", summary: "Built the pinned Markdown health report." },
    ],
    markdown: systemReportMarkdown,
  },
  {
    id: "ava.operations-brief", version: 1, flowName: "AVA Operations Brief",
    triggerName: "AVA operations-brief webhook", reportTitle: "AVA Operations Brief",
    envKey: "ACTIVEPIECES_OPERATIONS_BRIEF_WEBHOOK_URL",
    steps: [
      { id: "accept_snapshot", summary: "Accepted AVA's bounded operational-count snapshot." },
      { id: "build_report", summary: "Built the pinned Markdown operations brief." },
    ],
    markdown: operationsBriefMarkdown,
  },
  {
    id: "ava.approved-action-plan", version: 1, flowName: "AVA Approved Action Plan",
    triggerName: "AVA approved-action-plan webhook", reportTitle: "AVA Approved Action Plan",
    envKey: "ACTIVEPIECES_APPROVED_ACTION_PLAN_WEBHOOK_URL",
    steps: [
      { id: "accept_approved_definition", summary: "Accepted AVA's bounded approved playbook definition." },
      { id: "build_action_plan", summary: "Built the pinned action plan for AVA verification." },
    ],
    markdown: approvedActionPlanMarkdown,
  },
];

function workflowTemplate(pieceVersion: string, workflow: WorkflowSpec): Json {

  return {
    displayName: workflow.flowName,
    schemaVersion: null,
    notes: [],
    trigger: {
      name: "trigger",
      valid: true,
      displayName: workflow.triggerName,
      type: "PIECE_TRIGGER",
      settings: {
        pieceName: "@activepieces/piece-webhook",
        pieceVersion,
        triggerName: "catch_webhook",
        input: {
          authType: "header",
          authFields: { headerName: "authorization", headerValue: `Bearer ${webhookToken}` },
        },
        propertySettings: {},
        sampleData: {},
      },
      nextAction: {
        name: "return_report",
        skip: false,
        type: "PIECE",
        valid: true,
        displayName: "Return verified report payload",
        settings: {
          pieceName: "@activepieces/piece-webhook",
          pieceVersion,
          actionName: "return_response",
          input: {
            responseType: "json",
            respond: "stop",
            fields: {
              status: 200,
              headers: { "content-type": "application/json" },
              body: {
                schemaVersion: 1,
                workflowId: "{{trigger['body']['workflowId']}}",
                workflowVersion: workflow.version,
                requestKey: "{{trigger['body']['requestKey']}}",
                externalRunId: null,
                providerVersion: "0.88.3",
                status: "succeeded",
                steps: workflow.steps.map((step) => ({ ...step, status: "completed", durationMs: null })),
                report: { title: workflow.reportTitle, markdown: workflow.markdown },
                error: null,
              },
            },
          },
          propertySettings: {},
          sampleData: {},
          errorHandlingOptions: {
            retryOnFailure: { value: false },
            continueOnFailure: { value: false },
          },
        },
      },
    },
  };
}

function updateLocalEnvironment(entries: Record<string, string>): void {
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  for (const [key, value] of Object.entries(entries)) {
    const replacement = `${key}=${value}`;
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index >= 0) lines[index] = replacement;
    else lines.push(replacement);
  }
  writeFileSync(envPath, `${lines.filter((line, index) => line || index < lines.length - 1).join("\n")}\n`, { mode: 0o600 });
}

function responseDiagnostic(body: Json): string {
  const diagnostic = {
    code: typeof body.code === "string" ? body.code.slice(0, 100) : undefined,
    message: typeof body.message === "string" ? body.message.slice(0, 500) : undefined,
  };
  return JSON.stringify(diagnostic);
}

async function main(): Promise<void> {
  // Persist locally generated management credentials before the first API call so a
  // partially completed provisioning attempt can safely resume instead of orphaning
  // an account with a password that no longer exists.
  updateLocalEnvironment({
    ACTIVEPIECES_LOCAL_API_URL: apiBase,
    ACTIVEPIECES_LOCAL_ADMIN_EMAIL: adminEmail,
    ACTIVEPIECES_LOCAL_ADMIN_PASSWORD: adminPassword,
    ACTIVEPIECES_WEBHOOK_TOKEN: webhookToken,
  });
  await waitUntilReady();
  const auth = await authenticate();
  const piece = await request(`/api/v1/pieces/${encodeURIComponent("@activepieces/piece-webhook")}?projectId=${encodeURIComponent(auth.projectId)}`, {}, auth.token);
  if (piece.status !== 200 || typeof piece.body.version !== "string") {
    throw new Error("The genuine Activepieces webhook piece is unavailable; include webhook in AP_DEV_PIECES and restart the runtime");
  }
  const pieceVersion = `~${piece.body.version}`;
  const list = await request(`/api/v1/flows?projectId=${encodeURIComponent(auth.projectId)}&limit=100`, {}, auth.token);
  if (list.status !== 200) throw new Error(`Could not list Activepieces flows (HTTP ${list.status})`);
  const candidates = Array.isArray(list.body.data) ? list.body.data as Json[] : [];
  const provisioned: Array<{ workflowId: string; workflowVersion: number; flowId: string; webhookUrl: string }> = [];
  const environment: Record<string, string> = {
    ACTIVEPIECES_ENABLED: "true",
    ACTIVEPIECES_WEBHOOK_TOKEN: webhookToken,
    ACTIVEPIECES_TIMEOUT_SECONDS: "30",
    ACTIVEPIECES_LOCAL_API_URL: apiBase,
    ACTIVEPIECES_LOCAL_ADMIN_EMAIL: adminEmail,
    ACTIVEPIECES_LOCAL_ADMIN_PASSWORD: adminPassword,
  };
  for (const workflow of workflows) {
    let flow = candidates.find((candidate) => candidate.version && (candidate.version as Json).displayName === workflow.flowName);
    if (!flow) {
      const created = await request(`/api/v1/flows?projectId=${encodeURIComponent(auth.projectId)}`, {
        method: "POST",
        body: JSON.stringify({ displayName: workflow.flowName, projectId: auth.projectId }),
      }, auth.token);
      if (created.status !== 201 || typeof created.body.id !== "string") {
        throw new Error(`Could not create Activepieces flow ${workflow.id} (HTTP ${created.status})`);
      }
      flow = created.body;
    }
    const flowId = flow.id;
    if (typeof flowId !== "string") throw new Error(`Activepieces returned an invalid flow identifier for ${workflow.id}`);
    const imported = await request(`/api/v1/flows/${flowId}?projectId=${encodeURIComponent(auth.projectId)}`, {
      method: "POST",
      body: JSON.stringify({ type: "IMPORT_FLOW", request: workflowTemplate(pieceVersion, workflow) }),
    }, auth.token);
    if (imported.status !== 200) throw new Error(`Could not import ${workflow.id} (HTTP ${imported.status} ${responseDiagnostic(imported.body)})`);
    const published = await request(`/api/v1/flows/${flowId}?projectId=${encodeURIComponent(auth.projectId)}`, {
      method: "POST",
      body: JSON.stringify({ type: "LOCK_AND_PUBLISH", request: { status: "ENABLED" } }),
    }, auth.token);
    if (published.status !== 200) throw new Error(`Could not publish ${workflow.id} (HTTP ${published.status} ${responseDiagnostic(published.body)})`);
    const webhookUrl = `${apiBase}/api/v1/webhooks/${flowId}/sync`;
    environment[workflow.envKey] = webhookUrl;
    provisioned.push({ workflowId: workflow.id, workflowVersion: workflow.version, flowId, webhookUrl });
  }
  updateLocalEnvironment(environment);
  console.log(JSON.stringify({
    activepiecesReady: true,
    runtimeVersion: "0.88.3",
    workflows: provisioned,
    authentication: "shared_header",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
