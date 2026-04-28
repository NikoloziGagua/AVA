export const TOOL_BUDGET_MS: Record<string, number> = {
  shell: 30_000,
  fs_read: 5_000, fs_write: 5_000, fs_list: 5_000, fs_stat: 5_000, fs_delete: 5_000,
  claude_code: 600_000,
  chrome_navigate: 30_000, chrome_click: 10_000, chrome_type: 10_000,
  chrome_press_key: 5_000, chrome_read_page: 15_000, chrome_screenshot: 15_000, chrome_tabs: 5_000,
  computer_use: 60_000,
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
