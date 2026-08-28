export const TOOL_BUDGET_MS: Record<string, number> = {
  // Backstop above the tool's own internal timeout (default 30s, per-call
  // override up to 120s) — the tool tree-kills its child itself; this budget
  // only catches a wedged tool wrapper.
  shell: 130_000,
  fs_read: 5_000, fs_write: 5_000, fs_list: 5_000, fs_stat: 5_000, fs_delete: 5_000,
  claude_code: 600_000,
  chrome_navigate: 30_000, chrome_click: 10_000, chrome_type: 10_000,
  chrome_press_key: 5_000, chrome_read_page: 15_000, chrome_screenshot: 15_000, chrome_tabs: 5_000,
  chrome_snapshot: 15_000,
  // App-module workflows chain several navigations + verification reads.
  instagram_send_dm: 90_000, instagram_open_profile: 45_000,
  instagram_open_chat: 60_000, instagram_read_chat: 60_000,
  instagram_status: 45_000, instagram_login: 60_000, instagram_submit_code: 30_000,
  whatsapp_send_message: 90_000, whatsapp_open_chat: 60_000, whatsapp_status: 45_000,
  whatsapp_read_chat: 60_000,
  // Was 60s against an inner loop of up to 100 model iterations — a guaranteed
  // budget blowout. The dispatch-level abort (agent.ts) now cancels the loop on
  // timeout; 120s gives real visual tasks room to finish.
  computer_use: 120_000,
  chrome_google_search: 45_000,
  control_app: 30_000,
  // Capture + one vision call on a multi-MB PNG — 30s default is too tight
  // when the vision model queues.
  look_at_screen: 60_000,
  // Its own description tells the model to fan out up to 12 queries at up to
  // 20s each — the 30s unknown-tool default rejected exactly the sweeps the
  // tool exists for.
  find_places: 120_000,
  ufo_experiment_observe: 15_000,
  ufo_experiment_action: 15_000,
  ufo_runtime_run: 610_000,
};

export function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('timeout: ' + tag + ' ' + ms + 'ms'));
    }, ms);
    p.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
