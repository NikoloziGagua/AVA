// Turn a raw tool name + args into a short, human, present-tense phrase for the
// activity display — so Sir sees "Running git status" / "Writing notes.txt" /
// "Opening bing.com" instead of raw "shell" / "fs_write" / "chrome_navigate"
// and stdout dumps. Pure + tested.

function truncate(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function baseName(p: string): string {
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return truncate(url, 30);
  }
}

export function humanizeTool(tool: string, args?: unknown): string {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const s = (v: unknown): string => (typeof v === "string" ? v : "");
  switch (tool) {
    case "shell": return a.command ? `Running ${truncate(s(a.command), 44)}` : "Running a command";
    case "fs_write": return a.path ? `Writing ${baseName(s(a.path))}` : "Writing a file";
    case "fs_read": return a.path ? `Reading ${baseName(s(a.path))}` : "Reading a file";
    case "fs_list": return a.path ? `Listing ${baseName(s(a.path))}` : "Listing files";
    case "fs_stat": return a.path ? `Checking ${baseName(s(a.path))}` : "Checking a file";
    case "fs_delete": return a.path ? `Deleting ${baseName(s(a.path))}` : "Deleting a file";
    case "claude_code": return "Writing code";
    case "chrome_navigate": return a.url ? `Opening ${domain(s(a.url))}` : "Opening a page";
    case "chrome_click": return "Clicking";
    case "chrome_type": return "Typing";
    case "chrome_press_key": return "Pressing a key";
    case "chrome_read_page": return "Reading the page";
    case "chrome_screenshot": return "Capturing the page";
    case "chrome_tabs": return "Checking tabs";
    case "computer_use": return a.task ? truncate(s(a.task), 50) : "Controlling the screen";
    case "take_screenshot": return "Taking a screenshot";
    case "memory_remember": return "Saving to memory";
    case "memory_forget": return "Updating memory";
    case "memory_read": return "Recalling from memory";
    case "self_improve": return "Queuing a self-improvement";
    case "self_improve_status": return "Checking self-improvement status";
    default: return tool.replace(/_/g, " ").replace(/\b\w/, (c) => c.toUpperCase());
  }
}
