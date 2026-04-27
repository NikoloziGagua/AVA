import * as SysTrayNs from "systray2";
import type { ClickEvent, Conf } from "systray2";
import type { Logger } from "pino";
import { exec } from "node:child_process";

// systray2 v2.1.4 publishes a `.d.ts` with `export default class SysTray`, but
// its CommonJS implementation only sets `exports.default = SysTray`. Node's
// ESM loader exposes that as the namespace, so we have to reach into `.default`
// at both type and runtime level.
type SysTrayCtor = new (conf: Conf) => {
  onClick(listener: (action: ClickEvent) => void): Promise<unknown>;
  kill(exitNode?: boolean): Promise<void>;
};
type SysTrayModule = SysTrayCtor & { separator: { title: string; tooltip: string; enabled: boolean } };

const SysTray = (SysTrayNs as unknown as { default: SysTrayModule }).default;

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
      void tray.kill();
      process.exit(0);
    }
  });
}
