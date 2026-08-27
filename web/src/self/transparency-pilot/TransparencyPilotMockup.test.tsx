import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TransparencyPilotMockup } from "./TransparencyPilotMockup.js";
import { SYNTHETIC_RUN_RECORDS } from "./mockRecords.js";
import {
  PROVISIONAL_ADOPTION_REQUIREMENTS,
  PROVISIONAL_ROLLBACK_CONDITIONS,
  SYNTHETIC_DATA_NOTICE,
  UNRESOLVED_DECISIONS,
} from "./model.js";

afterEach(cleanup);

describe("TransparencyPilotMockup", () => {
  it("renders the executive view from all 24 shared synthetic records with absolute per-run variation", () => {
    render(<TransparencyPilotMockup records={SYNTHETIC_RUN_RECORDS} />);
    const pilot = screen.getByTestId("transparency-pilot");
    expect(pilot.getAttribute("data-record-count")).toBe("24");
    const decision = pilot.querySelector('[data-view="decision"]');
    expect(decision?.getAttribute("data-record-count")).toBe("24");
    expect(screen.getByText(/individual-run variation · 24\/24/i)).toBeTruthy();
    expect(screen.getAllByText(SYNTHETIC_DATA_NOTICE).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/87,400 ms/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "B-T01-1" })).toBeTruthy();
  });

  it("represents every provisional adoption and rollback condition verbatim and cannot apply them", () => {
    render(<TransparencyPilotMockup records={SYNTHETIC_RUN_RECORDS} />);
    for (const requirement of PROVISIONAL_ADOPTION_REQUIREMENTS) expect(screen.getByText(requirement)).toBeTruthy();
    for (const condition of PROVISIONAL_ROLLBACK_CONDITIONS) expect(screen.getByText(condition)).toBeTruthy();
    expect(screen.getAllByText(/awaiting design-review approval/i).length).toBe(2);
    expect(screen.getAllByText(/cannot trigger an operational action/i)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^adopt$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^run benchmark$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^swap workflow$/i })).toBeNull();
  });

  it("shows all seven unresolved decisions as undecided without defaults", () => {
    render(<TransparencyPilotMockup records={SYNTHETIC_RUN_RECORDS} />);
    for (const question of UNRESOLVED_DECISIONS) expect(screen.getByText(question)).toBeTruthy();
    expect(screen.getAllByText("undecided")).toHaveLength(7);
    expect(screen.getByText(/no defaults applied · 7 undecided/i)).toBeTruthy();
  });

  it("connects all three views to the same record set and cross-links a scorecard run to evidence", () => {
    render(<TransparencyPilotMockup records={SYNTHETIC_RUN_RECORDS} />);
    fireEvent.click(screen.getByRole("button", { name: "R-T05-2" }));
    const evidence = screen.getByTestId("transparency-pilot").querySelector('[data-view="evidence"]');
    expect(evidence?.getAttribute("data-record-count")).toBe("24");
    expect(evidence?.getAttribute("data-selected-run")).toBe("R-T05-2");
    expect(screen.getByText("Synthetic critical assertion intentionally lacks support.")).toBeTruthy();
    expect(screen.getByText(/one intentionally critical unsupported mock claim/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /before \/ after workflow/i }));
    const workflow = screen.getByTestId("transparency-pilot").querySelector('[data-view="workflow"]');
    expect(workflow?.getAttribute("data-record-count")).toBe("24");
    expect(workflow?.querySelectorAll("[data-provenance-ids]").length).toBeGreaterThan(0);
    expect(within(workflow as HTMLElement).getAllByText(/human intervention/i).length).toBeGreaterThan(0);
    expect(within(workflow as HTMLElement).getAllByText(/failure/i).length).toBeGreaterThan(0);
  });

  it("drills into failures, intervention, approvals, sources, claims, timings, and metric provenance", () => {
    render(<TransparencyPilotMockup records={SYNTHETIC_RUN_RECORDS} />);
    fireEvent.click(screen.getByRole("tab", { name: /evidence & runs/i }));
    fireEvent.change(screen.getByLabelText("Selected synthetic run"), { target: { value: "B-T04-2" } });
    expect(screen.getByText("Synthetic source parser failure remained unresolved.")).toBeTruthy();
    expect(screen.getByText(/stopped before completion/i)).toBeTruthy();
    expect(screen.getByText("APPROVAL BOUNDARIES")).toBeTruthy();
    expect(screen.getByText("AUTOMATIC METRICS & DERIVATION PROVENANCE")).toBeTruthy();
    expect(screen.getAllByText(/not_authorized/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/endedAt minus startedAt/i)).toBeTruthy();
    expect(screen.getByText(/packet:\/\/TP-T04-v1\/primary/i)).toBeTruthy();
    expect(screen.queryByText(/Failures: 0 structured error records/i)).toBeNull();
  });
});
