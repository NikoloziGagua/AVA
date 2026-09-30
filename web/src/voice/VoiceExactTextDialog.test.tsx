// @vitest-environment jsdom
import { useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceExactTextDialog } from "./VoiceExactTextDialog.js";

afterEach(() => cleanup());

function Harness({
  submit = async () => true,
  sessionReady = true,
}: {
  submit?: (text: string) => Promise<boolean>;
  sessionReady?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={openerRef} onClick={() => setOpen(true)}>Open exact input</button>
      <VoiceExactTextDialog
        open={open}
        onOpenChange={setOpen}
        onSubmit={submit}
        sessionReady={sessionReady}
        returnFocusRef={openerRef}
      />
    </>
  );
}

describe("VoiceExactTextDialog", () => {
  it("opens accessibly, focuses the exact field, and returns focus after cancel", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open exact input" });
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Type exact text" });
    expect(dialog).toBeTruthy();
    const field = screen.getByLabelText("Exact wording");
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("never submits blank input and plain Enter remains a newline", async () => {
    const submit = vi.fn(async () => true);
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByRole("button", { name: "Open exact input" }));
    const field = screen.getByLabelText("Exact wording") as HTMLTextAreaElement;
    expect(screen.getByRole("button", { name: "Send to AVA" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send to AVA" }).hasAttribute("disabled")).toBe(true);
  });

  it("preserves exact characters and submits only on the explicit shortcut", async () => {
    const submit = vi.fn(async () => true);
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByRole("button", { name: "Open exact input" }));
    const field = screen.getByLabelText("Exact wording");
    const exact = "  @_princi150/path?q=A_B%20C\nconst ID = `Case-Sensitive`;  ";
    fireEvent.change(field, { target: { value: exact } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(submit).toHaveBeenCalledWith(exact));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("guards duplicate sends and keeps the draft visible on an acceptance error", async () => {
    let resolve!: (accepted: boolean) => void;
    const submit = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByRole("button", { name: "Open exact input" }));
    const field = screen.getByLabelText("Exact wording");
    fireEvent.change(field, { target: { value: "Exact_Name" } });
    const button = screen.getByRole("button", { name: "Send to AVA" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => resolve(false));
    expect(screen.getByRole("alert").textContent).toContain("still here");
    expect((field as HTMLTextAreaElement).value).toBe("Exact_Name");
  });

  it("waits for the canonical shared session and supports Escape cancellation", async () => {
    const submit = vi.fn(async () => true);
    render(<Harness submit={submit} sessionReady={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Open exact input" }));
    fireEvent.change(screen.getByLabelText("Exact wording"), { target: { value: "do not send yet" } });
    expect(screen.getByText(/Waiting for the shared voice session/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send to AVA" }).hasAttribute("disabled")).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(submit).not.toHaveBeenCalled();
  });
});
