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
    case "discuss_with_claude": return "Consulting Claude";
    case "read_discussion": return "Reading a Claude consult";
    case "read_claude_updates": return "Reading Claude's update notes";
    case "chrome_navigate": return a.url ? `Opening ${domain(s(a.url))}` : "Opening a page";
    case "chrome_click": return "Clicking";
    case "chrome_type": return "Typing";
    case "chrome_press_key": return "Pressing a key";
    case "chrome_read_page": return "Reading the page";
    case "chrome_snapshot": return "Mapping the page's controls";
    case "chrome_screenshot": return "Capturing the page";
    case "chrome_tabs": return "Checking tabs";
    case "computer_use": return a.task ? truncate(s(a.task), 50) : "Controlling the screen";
    case "chrome_google_search": return a.query ? `Searching Google for ${truncate(s(a.query), 42)}` : "Searching Google";
    case "control_app": { const app = s(a.app) || s(a.name); return app ? `Controlling ${truncate(app, 30)}` : "Controlling an app"; }
    case "find_places": return a.query ? `Finding places: ${truncate(s(a.query), 36)}` : "Finding places";
    case "take_screenshot": return "Taking a screenshot";
    case "memory_remember": return "Saving to memory";
    case "memory_forget": return "Updating memory";
    case "memory_read": return "Recalling from memory";
    case "notes_capture": return a.project ? `Saving to ${truncate(s(a.project), 24)} Notes` : "Saving to Notes";
    case "notes_search": return "Searching Notes";
    case "notes_update": return "Organising Notes";
    case "notes_promote": return a.target === "self_improvement" ? "Requesting an improvement from Notes" : "Turning a note into a task";
    case "read_logs": return "Checking her own logs";
    case "shopify_list_products": return "Listing store products";
    case "shopify_get_product": return "Reading a product";
    case "shopify_update_product": return "Updating a product";
    case "self_improve": return "Queuing a self-improvement";
    case "self_improve_status": return "Checking self-improvement status";
    case "look_at_screen": return "Looking at the screen";
    case "watch_create": return "Setting up a watch";
    case "watch_list": return "Listing watches";
    case "watch_delete": return "Removing a watch";
    case "instagram_send_dm": return a.person ? `Messaging ${truncate(s(a.person), 24)} on Instagram` : "Sending an Instagram DM";
    case "instagram_open_profile": return a.person ? `Opening ${truncate(s(a.person), 24)}'s Instagram profile` : "Opening an Instagram profile";
    case "instagram_open_chat": return a.person ? `Opening ${truncate(s(a.person), 24)}'s Instagram chat` : "Opening an Instagram chat";
    case "instagram_read_chat": return a.person ? `Reading ${truncate(s(a.person), 24)}'s Instagram chat` : "Reading an Instagram chat";
    case "instagram_status": return "Checking Instagram login";
    case "instagram_login": return "Logging in to Instagram";
    case "instagram_submit_code": return "Submitting the verification code";
    case "whatsapp_send_message": return a.person ? `Messaging ${truncate(s(a.person), 24)} on WhatsApp` : "Sending a WhatsApp message";
    case "whatsapp_open_chat": return a.person ? `Opening ${truncate(s(a.person), 24)}'s WhatsApp chat` : "Opening a WhatsApp chat";
    case "whatsapp_read_chat": return "Reading a WhatsApp chat";
    case "whatsapp_status": return "Checking WhatsApp login";
    case "person_remember": return a.name ? `Remembering ${truncate(s(a.name), 24)}` : "Updating the people map";
    case "person_list": return "Checking the people map";
    default: return tool.replace(/_/g, " ").replace(/\b\w/, (c) => c.toUpperCase());
  }
}
