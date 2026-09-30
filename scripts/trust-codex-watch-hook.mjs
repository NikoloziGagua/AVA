#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const cwd = resolve(process.argv[2] ?? process.cwd());
const installed = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin", "codex.exe")
  : "";
const command = installed && existsSync(installed) ? installed : "codex";
const child = spawn(command, ["app-server", "--stdio"], {
  cwd,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let nextId = 1;
let buffer = "";
let stderr = "";
const pending = new Map();

child.stderr.on("data", (chunk) => { stderr += String(chunk); });
child.stdout.on("data", (chunk) => {
  buffer += String(chunk);
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).replace(/\r$/, "");
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.id == null) continue;
    const waiter = pending.get(message.id);
    if (!waiter) continue;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  }
});

function send(method, params) {
  const id = nextId++;
  return new Promise((resolveRequest, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out${stderr ? `: ${stderr.trim()}` : ""}`));
    }, 15_000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolveRequest(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
  });
}

try {
  await send("initialize", {
    clientInfo: { name: "ava-hook-installer", title: "AVA Hook Installer", version: "1.0.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
  const listed = await send("hooks/list", { cwds: [cwd] });
  const hooks = listed?.data?.flatMap((entry) => entry.hooks ?? []) ?? [];
  const hook = hooks.find((entry) => entry.eventName === "stop" && String(entry.command ?? "").includes("codex-watch-stop-hook.mjs"));
  if (!hook) throw new Error("AVA's project Stop hook was not discovered");
  if (!hook.currentHash || !hook.key) throw new Error("Codex did not return a trust identity for AVA's Stop hook");

  await send("config/batchWrite", {
    edits: [{
      keyPath: "hooks.state",
      value: { [hook.key]: { enabled: true, trusted_hash: hook.currentHash } },
      mergeStrategy: "upsert",
    }],
    reloadUserConfig: true,
  });

  const verified = await send("hooks/list", { cwds: [cwd] });
  const verifiedHook = (verified?.data?.flatMap((entry) => entry.hooks ?? []) ?? [])
    .find((entry) => entry.key === hook.key);
  if (!verifiedHook?.enabled || verifiedHook.trustStatus !== "trusted") {
    throw new Error(`Stop hook trust did not become active (${verifiedHook?.trustStatus ?? "missing"})`);
  }
  process.stdout.write(`trusted ${verifiedHook.key}\n`);
} finally {
  child.stdin.end();
  setTimeout(() => child.kill(), 500).unref?.();
}
