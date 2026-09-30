// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AssistantMarkdown, safeMarkdownUrl } from "./AssistantMarkdown.js";

afterEach(cleanup);

describe("AssistantMarkdown", () => {
  it("renders CommonMark and GFM structure with accessible overflow regions", () => {
    render(
      <AssistantMarkdown
        text={`# System status

This is **verified**, *useful*, and ~~not provisional~~.

1. First step
2. Second step with \`inline code\`

> Evidence remains inspectable.

\`\`\`ts
const ready = true;
\`\`\`

| Area | State |
| --- | --- |
| Chat | Ready |

- [x] Tested
- [ ] Follow-up`}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "System status" })).toBeTruthy();
    expect(screen.getByText("verified").tagName).toBe("STRONG");
    expect(screen.getByText("useful").tagName).toBe("EM");
    expect(screen.getByText("not provisional").tagName).toBe("DEL");
    expect(screen.getByText("inline code").tagName).toBe("CODE");
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(screen.getByLabelText("Code block").getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("region", { name: "Scrollable table" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("table")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "completed item" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: "incomplete item" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("opens web links safely and renders unsafe protocols as plain text", () => {
    const { container } = render(
      <AssistantMarkdown text={`[Official source](https://example.com/report?q=1) and [unsafe](javascript:alert(1))`} />,
    );

    const safe = screen.getByRole("link", { name: /Official source/ });
    expect(safe.getAttribute("href")).toBe("https://example.com/report?q=1");
    expect(safe.getAttribute("target")).toBe("_blank");
    expect(safe.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("unsafe").tagName).toBe("SPAN");
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("ignores raw HTML and never renders remote images", () => {
    const { container } = render(
      <AssistantMarkdown text={'Before <script>alert("x")</script> after\n\n![tracking pixel](https://example.com/pixel.png)'} />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("onerror");
  });

  it("renders an incomplete stopped stream without executing or throwing", () => {
    render(<AssistantMarkdown text={"## Partial\n\n**still arriving"} partial />);
    const root = screen.getByTestId("assistant-markdown");
    expect(root.getAttribute("data-partial")).toBe("true");
    expect(screen.getByRole("heading", { level: 3, name: "Partial" })).toBeTruthy();
    expect(root.textContent).toContain("still arriving");
  });

  it("accepts only absolute HTTP(S) destinations", () => {
    expect(safeMarkdownUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeMarkdownUrl("http://example.com/a")).toBe("http://example.com/a");
    expect(safeMarkdownUrl("javascript:alert(1)")).toBe("");
    expect(safeMarkdownUrl("data:text/html,unsafe")).toBe("");
    expect(safeMarkdownUrl("file:///C:/secret.txt")).toBe("");
    expect(safeMarkdownUrl("/api/private")).toBe("");
  });
});
