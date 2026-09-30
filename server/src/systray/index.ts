import * as SysTrayNs from "systray2";
import type { ClickEvent, Conf } from "systray2";
import type { Logger } from "../logs/logger.js";
import { exec } from "node:child_process";

// systray2 v2.1.4 publishes `export default class SysTray` in its `.d.ts`, but
// its CommonJS impl sets `exports.default = SysTray`. Different ESM loaders
// expose that differently: tsc-compiled output gets the ctor at `m.default`,
// while tsx/Node-native ESM gets it at `m.default.default`. Probe both.
type SysTrayCtor = new (conf: Conf) => {
  onClick(listener: (action: ClickEvent) => void): Promise<unknown>;
  kill(exitNode?: boolean): Promise<void>;
};
type SysTrayModule = SysTrayCtor & { separator: { title: string; tooltip: string; enabled: boolean } };

const nsDefault = (SysTrayNs as unknown as { default: unknown }).default;
const SysTray = (typeof nsDefault === "function"
  ? nsDefault
  : (nsDefault as { default: unknown }).default) as SysTrayModule;

export function startSystray(opts: {
  onPair: () => string;
  log: Logger;
}): void {
  const tray = new SysTray({
    menu: {
      icon: "",
      title: "Ava",
      tooltip: "Ava — personal AI agent",
      items: [
        { title: "Show pairing code", tooltip: "Generate a code to pair a phone", checked: false, enabled: true },
        { title: "Open status page", tooltip: "Browse to /_status", checked: false, enabled: true },
        SysTray.separator,
        { title: "Stop server", tooltip: "Quit Ava", checked: false, enabled: true },
      ],
    },
    debug: false,
    copyDir: true,
  });

  void tray.onClick((action: ClickEvent) => {
    if (action.seq_id === 0) {
      const code = opts.onPair();
      exec(
        `powershell -NoProfile -Command "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; [System.Windows.Forms.MessageBox]::Show('${code}', 'Ava pairing code (5 min)')"`
      );
      opts.log.info({ code }, "pairing code issued");
    } else if (action.seq_id === 1) {
      exec(`start http://localhost:8787/_status`);
    } else if (action.seq_id === 3) {
      void tray.kill().catch((error) => {
        opts.log.warn(
          { err: error instanceof Error ? error.message : String(error) },
          "systray failed to stop cleanly",
        );
      });
      process.exit(0);
    }
  }).catch((error) => {
    // SysTray starts its helper process asynchronously. A surrounding try/catch
    // in index.ts cannot see a rejected ready()/onClick() promise, so handle it
    // here instead of leaking an unhandledRejection into the server process.
    opts.log.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "systray failed to start — server still running. Mint a pairing code with: npm.cmd -w server run pair",
    );
  });
}
