import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE = "v3.0.8";
const COMMIT = "96983c73ed09e884a5f1d7ff8936c953b234b684";
const REPOSITORY = "https://github.com/microsoft/UFO.git";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = resolve(process.env.UFO_RUNTIME_ROOT ?? join(serverRoot, "data", "ufo-runtime"));
const sourceDir = join(runtimeRoot, "source");
const venvDir = join(runtimeRoot, "venv");
const python = join(venvDir, "Scripts", "python.exe");
const marker = join(runtimeRoot, ".dependencies-installed-v3.0.8");

function run(command: string, args: string[], cwd = serverRoot): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  }).trim();
}

mkdirSync(runtimeRoot, { recursive: true });
if (!existsSync(join(sourceDir, ".git"))) {
  run("git", ["clone", "--depth", "1", "--branch", RELEASE, REPOSITORY, sourceDir]);
}
const actualCommit = run("git", ["rev-parse", "HEAD"], sourceDir);
if (actualCommit !== COMMIT) {
  throw new Error(`Refusing unpinned UFO source: expected ${COMMIT}, found ${actualCommit}`);
}

if (!existsSync(python)) {
  run("py", ["-3.10", "-m", "venv", venvDir]);
}
if (!existsSync(marker)) {
  run(python, ["-m", "pip", "install", "--disable-pip-version-check", "-r", join(sourceDir, "requirements.txt")]);
  writeFileSync(marker, `${new Date().toISOString()}\n`, "utf8");
}

const configDir = join(sourceDir, "config", "ufo");
mkdirSync(configDir, { recursive: true });
writeFileSync(join(configDir, "agents.yaml"), `HOST_AGENT:
  VISUAL_MODE: true
  REASONING_MODEL: false
  API_TYPE: "openai"
  API_BASE: "https://api.openai.com/v1"
  API_KEY: "\${OPENAI_API_KEY}"
  API_VERSION: "2025-02-01-preview"
  API_MODEL: "gpt-4o"
  PROMPT: "ufo/prompts/share/base/host_agent.yaml"
  EXAMPLE_PROMPT: "ufo/prompts/examples/{mode}/host_agent_example.yaml"
APP_AGENT:
  VISUAL_MODE: true
  REASONING_MODEL: false
  API_TYPE: "openai"
  API_BASE: "https://api.openai.com/v1"
  API_KEY: "\${OPENAI_API_KEY}"
  API_VERSION: "2025-02-01-preview"
  API_MODEL: "gpt-4o"
  PROMPT: "ufo/prompts/share/base/app_agent.yaml"
  EXAMPLE_PROMPT: "ufo/prompts/examples/{mode}/app_agent_example.yaml"
  EXAMPLE_PROMPT_AS: "ufo/prompts/examples/{mode}/app_agent_example_as.yaml"
BACKUP_AGENT:
  VISUAL_MODE: true
  REASONING_MODEL: false
  API_TYPE: "openai"
  API_BASE: "https://api.openai.com/v1"
  API_KEY: "\${OPENAI_API_KEY}"
  API_VERSION: "2025-02-01-preview"
  API_MODEL: "gpt-4o"
EVALUATION_AGENT:
  VISUAL_MODE: true
  REASONING_MODEL: false
  API_TYPE: "openai"
  API_BASE: "https://api.openai.com/v1"
  API_KEY: "\${OPENAI_API_KEY}"
  API_VERSION: "2025-02-01-preview"
  API_MODEL: "gpt-4o"
MAX_TOKENS: 1200
MAX_RETRY: 2
TEMPERATURE: 0.0
TOP_P: 0.0
TIMEOUT: 60
APP_API_PROMPT_ADDRESS: {}
`, "utf8");

writeFileSync(join(configDir, "system_ava.yaml"), `MAX_STEP: 8
MAX_ROUND: 1
SLEEP_TIME: 0.5
RECTANGLE_TIME: 0
ACTION_SEQUENCE: false
SHOW_VISUAL_OUTLINE_ON_SCREEN: false
MAXIMIZE_WINDOW: false
SAFE_GUARD: true
CONTROL_BACKEND: ["uia"]
USE_MCP: false
MCP_FALLBACK_TO_UI: false
PRINT_LOG: true
LOG_LEVEL: "INFO"
LOG_XML: false
LOG_TO_MARKDOWN: true
SCREENSHOT_TO_MEMORY: false
SAVE_UI_TREE: false
SAVE_FULL_SCREEN: false
SAVE_EXPERIENCE: "always_not"
EVA_SESSION: false
EVA_ROUND: false
EVA_ALL_SCREENSHOTS: false
ASK_QUESTION: false
USE_CUSTOMIZATION: false
`, "utf8");
writeFileSync(join(configDir, "rag_ava.yaml"), `RAG_ONLINE_SEARCH: false
RAG_OFFLINE_DOCS: false
RAG_EXPERIENCE: false
RAG_DEMONSTRATION: false
`, "utf8");

// Host/application UI automation remains available, but the command-line MCP
// executor is intentionally absent from this fixed Notepad proof.
writeFileSync(join(configDir, "mcp.yaml"), `HostAgent:
  default:
    data_collection:
      - namespace: UICollector
        type: local
        start_args: []
        reset: false
    action:
      - namespace: HostUIExecutor
        type: local
        start_args: []
        reset: false
AppAgent:
  default:
    data_collection:
      - namespace: UICollector
        type: local
        start_args: []
        reset: false
    action:
      - namespace: AppUIExecutor
        type: local
        start_args: []
        reset: false
`, "utf8");

const helperSource = join(serverRoot, "scripts", "ufo-notepad-fixture.py");
const helperTarget = join(runtimeRoot, "ufo-notepad-fixture.py");
copyFileSync(helperSource, helperTarget);

run(python, ["-c", "import ufo, pywinauto, win32api; print('UFO_RUNTIME_IMPORT_OK')"], sourceDir);
const manifest = {
  schemaVersion: 1,
  provider: "microsoft/UFO",
  runtime: "UFO2",
  release: RELEASE,
  commit: COMMIT,
  installedAt: new Date().toISOString(),
  pythonVersion: run(python, ["--version"]),
  configuration: "ava-bounded-notepad-v1",
  commandLineExecutorEnabled: false,
  fixtureDriverSha256: await import("node:crypto").then(({ createHash }) =>
    createHash("sha256").update(readFileSync(helperTarget)).digest("hex")),
};
writeFileSync(join(runtimeRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  runtimeRoot,
  sourceDir,
  python,
  release: RELEASE,
  commit: COMMIT,
  configuration: manifest.configuration,
  commandLineExecutorEnabled: false,
}));
