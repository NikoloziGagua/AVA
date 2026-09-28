import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ fetchInitiativeSettings: vi.fn(), patchInitiativeSettings: vi.fn(), fetchNotesTree: vi.fn() }));
vi.mock("./api.js", () => ({
  fetchInitiativeSettings: (...args: unknown[]) => calls.fetchInitiativeSettings(...args),
  patchInitiativeSettings: (...args: unknown[]) => calls.patchInitiativeSettings(...args),
}));
vi.mock("../notes/api.js", () => ({ fetchNotesTree: (...args: unknown[]) => calls.fetchNotesTree(...args) }));
vi.mock("../components/ava/PanelShell.js", () => ({
  PanelSection: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import { ApiError } from "../api.js";
import { IdeasSettingsSection } from "./IdeasSettingsSection.js";

const SETTINGS = { enabled: false, deliveryLocalTime: "11:00", quietStart: "22:30", quietEnd: "08:30", activeProjectFolderIds: [], version: 3 };
const folder = (id: string, path: string, builtIn = false) => ({
  id, parentId: null, name: path, description: "", position: 0, builtIn, version: 1, documentCount: 0, breadcrumb: [], path, createdAt: 1, updatedAt: 1,
});

beforeEach(() => {
  for (const mock of Object.values(calls)) mock.mockReset();
  calls.fetchNotesTree.mockResolvedValue({ folders: [folder("f_inbox", "Inbox", true), folder("f_acme", "Projects / Acme")] });
});
afterEach(() => { cleanup(); });

describe("AVA's ideas settings", () => {
  it("starts off, and turns on against the version it read", async () => {
    calls.fetchInitiativeSettings.mockResolvedValue(SETTINGS);
    calls.patchInitiativeSettings.mockResolvedValue({ ok: true, settings: { ...SETTINGS, enabled: true, version: 4 } });
    render(<IdeasSettingsSection />);
    const toggle = await screen.findByRole("switch", { name: "AVA's ideas" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    expect(calls.patchInitiativeSettings).toHaveBeenCalledWith({ enabled: true }, 3);
    expect(screen.getByText(/Ideas come only while AVA is running on your PC/)).toBeTruthy();
  });

  it("saves a time when the field is left, and only a real time", async () => {
    calls.fetchInitiativeSettings.mockResolvedValue(SETTINGS);
    calls.patchInitiativeSettings.mockResolvedValue({ ok: true, settings: { ...SETTINGS, deliveryLocalTime: "09:30", version: 4 } });
    render(<IdeasSettingsSection />);
    const time = await screen.findByLabelText("Idea time");
    fireEvent.change(time, { target: { value: "09:30" } });
    expect(calls.patchInitiativeSettings).not.toHaveBeenCalled();
    fireEvent.blur(time);
    await waitFor(() => expect(calls.patchInitiativeSettings).toHaveBeenCalledWith({ deliveryLocalTime: "09:30" }, 3));
  });

  it("keeps a first edit made the moment the time field appears", async () => {
    // The settings arrive outside act; the edit lands in the first microtask
    // after the field commits, before React has flushed its passive effects.
    let resolveSettings!: (settings: typeof SETTINGS) => void;
    calls.fetchInitiativeSettings.mockReturnValue(new Promise((resolve) => { resolveSettings = resolve; }));
    calls.patchInitiativeSettings.mockResolvedValue({ ok: true, settings: { ...SETTINGS, deliveryLocalTime: "09:30", version: 4 } });
    render(<IdeasSettingsSection />);
    const edited = new Promise<void>((done) => {
      const observer = new MutationObserver(() => {
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Idea time"]');
        if (!input) return;
        observer.disconnect();
        fireEvent.change(input, { target: { value: "09:30" } });
        done();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    resolveSettings(SETTINGS);
    await edited;
    const input = await screen.findByLabelText("Idea time") as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("09:30"));
    fireEvent.blur(input);
    await waitFor(() => expect(calls.patchInitiativeSettings).toHaveBeenCalledWith({ deliveryLocalTime: "09:30" }, 3));
  });

  it("follows a newer saved time that arrives from elsewhere", async () => {
    calls.fetchInitiativeSettings
      .mockResolvedValueOnce(SETTINGS)
      .mockResolvedValueOnce({ ...SETTINGS, deliveryLocalTime: "07:15", enabled: true, version: 5 });
    calls.patchInitiativeSettings.mockResolvedValue({ ok: false, stale: true });
    render(<IdeasSettingsSection />);
    fireEvent.click(await screen.findByRole("switch", { name: "AVA's ideas" }));
    await waitFor(() => expect((screen.getByLabelText("Idea time") as HTMLInputElement).value).toBe("07:15"));
  });

  it("lists only Niko's own folders as projects to mark active", async () => {
    calls.fetchInitiativeSettings.mockResolvedValue(SETTINGS);
    calls.patchInitiativeSettings.mockResolvedValue({ ok: true, settings: { ...SETTINGS, activeProjectFolderIds: ["f_acme"], version: 4 } });
    render(<IdeasSettingsSection />);
    const acme = await screen.findByRole("checkbox", { name: "Projects / Acme" });
    expect(screen.queryByRole("checkbox", { name: "Inbox" })).toBeNull();
    fireEvent.click(acme);
    await waitFor(() => expect(calls.patchInitiativeSettings).toHaveBeenCalledWith({ activeProjectFolderIds: ["f_acme"] }, 3));
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "Projects / Acme" }) as HTMLInputElement).checked).toBe(true));
  });

  it("shows the latest settings when they changed elsewhere", async () => {
    calls.fetchInitiativeSettings
      .mockResolvedValueOnce(SETTINGS)
      .mockResolvedValueOnce({ ...SETTINGS, enabled: true, version: 5 });
    calls.patchInitiativeSettings.mockResolvedValue({ ok: false, stale: true });
    render(<IdeasSettingsSection />);
    fireEvent.click(await screen.findByRole("switch", { name: "AVA's ideas" }));
    await screen.findByText("These settings changed elsewhere. Showing the latest.");
    await waitFor(() => expect(screen.getByRole("switch", { name: "AVA's ideas" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("shows nothing on an AVA without ideas", async () => {
    calls.fetchInitiativeSettings.mockRejectedValue(new ApiError(404, "not found", "api_route_not_found"));
    const { container } = render(<IdeasSettingsSection />);
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });
});
