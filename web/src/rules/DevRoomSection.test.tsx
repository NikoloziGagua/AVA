// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgentroomStatus } from "../api.js";

const api = vi.hoisted(() => ({ fetchAgentroomStatus: vi.fn(), setAgentroomEnabled: vi.fn() }));
vi.mock("../api.js", () => api);
vi.mock("../components/ava/PanelShell.js", () => ({
  PanelSection: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import { DevRoomSection, devRoomStatusLine } from "./DevRoomSection.js";

const status = (over: Partial<AgentroomStatus>): AgentroomStatus => ({
  schemaVersion: 1, enabled: false, version: 1, availability: "disabled", identity: "AVA", roomName: null, reason: null, ...over,
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("DevRoomSection", () => {
  it("describes every availability state truthfully", () => {
    expect(devRoomStatusLine(status({ availability: "ready", enabled: true, roomName: "klevar" }))).toBe("Connected as AVA in klevar.");
    expect(devRoomStatusLine(status({}))).toMatch(/^Off/);
    expect(devRoomStatusLine(status({ availability: "unconfigured" }))).toMatch(/Not set up yet/);
    expect(devRoomStatusLine(status({ availability: "unreachable" }))).toMatch(/Can't reach/);
    expect(devRoomStatusLine(status({ availability: "identity_mismatch" }))).toMatch(/isn't AVA's/);
  });

  it("turns the room on with the current version and shows the result", async () => {
    api.fetchAgentroomStatus.mockResolvedValue(status({ version: 4 }));
    api.setAgentroomEnabled.mockResolvedValue({ ok: true, status: status({ enabled: true, version: 5, availability: "ready", roomName: "klevar" }) });
    render(<DevRoomSection />);
    const toggle = await screen.findByRole("switch", { name: "AVA in the dev room" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect((await screen.findByRole("status")).textContent).toBe("Connected as AVA in klevar.");
    expect(api.setAgentroomEnabled).toHaveBeenCalledWith(true, 4);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it("shows the server's truth when the change is refused or stale", async () => {
    api.fetchAgentroomStatus.mockResolvedValue(status({}));
    api.setAgentroomEnabled.mockResolvedValue({ ok: false, error: "unconfigured", status: status({ availability: "unconfigured" }) });
    render(<DevRoomSection />);
    fireEvent.click(await screen.findByRole("switch"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Not set up yet/);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");

    api.setAgentroomEnabled.mockResolvedValue({ ok: false, error: "stale_version", status: status({ enabled: true, version: 9, availability: "ready" }) });
    fireEvent.click(screen.getByRole("switch"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/changed elsewhere/);
  });
});
