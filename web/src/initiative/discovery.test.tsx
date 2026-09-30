import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomBar, StatusIsland, type Destination } from "../design/index.js";

afterEach(() => { cleanup(); });

const DESTINATIONS: Destination[] = [{ id: "home", label: "Home", icon: null, group: "primary" }];

function bar(ideas: Parameters<typeof BottomBar>[0]["ideas"], extra: Partial<Parameters<typeof BottomBar>[0]> = {}) {
  render(
    <BottomBar
      destinations={DESTINATIONS}
      current="home"
      onNavigate={vi.fn()}
      draft=""
      onDraftChange={vi.fn()}
      onSend={vi.fn()}
      face={<span data-testid="face" />}
      ideas={ideas}
      {...extra}
    />,
  );
}

const dot = () => document.querySelector<HTMLElement>("[data-idea-dot]");

describe("AVA's ideas in the bar (option B)", () => {
  it("shows a bright dot on the face while an idea is unopened, and names it", () => {
    bar({ label: "2 ideas from AVA", fresh: true, onOpen: vi.fn() });
    expect(dot()?.dataset.ideaDot).toBe("new");
    expect(screen.getByRole("button", { name: "Open menu, 2 ideas from AVA" })).toBeTruthy();
    expect(screen.getByTestId("face")).toBeTruthy();
  });

  it("dims the dot once every pending idea has been opened", () => {
    bar({ label: "1 idea from AVA", fresh: false, onOpen: vi.fn() });
    expect(dot()?.dataset.ideaDot).toBe("seen");
  });

  it("keeps the face button opening the menu, whose first entry opens the newest idea", () => {
    const onOpen = vi.fn();
    bar({ label: "1 idea from AVA", fresh: true, onOpen });
    fireEvent.click(screen.getByRole("button", { name: "Open menu, 1 idea from AVA" }));
    const entry = screen.getByRole("button", { name: /1 idea from AVA/ });
    expect(document.activeElement).toBe(entry);
    expect(entry.textContent).toContain("New");
    fireEvent.click(entry);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Open menu, 1 idea from AVA" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("shows nothing extra without pending ideas, including the compact Voice bar", () => {
    bar(null);
    expect(dot()).toBeNull();
    expect(screen.getByRole("button", { name: "Open menu" })).toBeTruthy();
    cleanup();
    bar({ label: "1 idea from AVA", fresh: true, onOpen: vi.fn() }, { compact: true });
    expect(dot()?.dataset.ideaDot).toBe("new");
  });
});

describe("StatusIsland action", () => {
  it("offers one small control inside the island", () => {
    const onPress = vi.fn();
    render(<StatusIsland mode="idle" time="11:04" action={{ label: "1 idea", description: "Open AVA's newest idea", onPress }} />);
    fireEvent.click(screen.getByRole("button", { name: "Open AVA's newest idea" }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".ds-island")?.textContent).toContain("1 idea");
  });
});
