// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { visualFixture } from "./fixtures.test-helper.js";
import { buildSceneMermaid, sanitizeRenderedSvg } from "./render.js";

describe("visual explanation rendering boundaries", () => {
  it("projects only the active scene from canonical topology", () => {
    const source = buildSceneMermaid(visualFixture, visualFixture.storyboard.scenes[0]!);
    expect(source).toContain('request(["Niko asks AVA"])');
    expect(source).toContain("class route avaFocus");
    expect(source).not.toContain('verify{"Verified?"}');
    expect(source).not.toContain("tool --> verify");
  });

  it("strips scripts, links, event handlers, external URLs and foreign content", () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" onclick="alert(1)">
      <script>alert(1)</script><a href="https://evil.example"><text>Unsafe link</text></a>
      <foreignObject><div>HTML</div></foreignObject>
      <g style="fill:url(https://evil.example/x)"><rect width="10" height="10" onmouseover="x" /></g>
      <path marker-end="url(#safe-marker)" d="M0 0L1 1" />
    </svg>`;
    const safe = sanitizeRenderedSvg(raw, "Safe title", "Safe description");
    expect(safe).not.toMatch(/<script|<foreignObject|onclick=|onmouseover=|evil\.example|\shref=/i);
    expect(safe).toContain("url(#safe-marker)");
    expect(safe).toContain('role="img"');
    expect(safe).toContain("Safe description");
  });

  it("assigns unique accessible SVG labels for multiple inline visuals", () => {
    const first = sanitizeRenderedSvg("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", "One", "First", "message_one");
    const second = sanitizeRenderedSvg("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", "Two", "Second", "message_two");
    expect(first).toContain("ava-visual-title-message_one");
    expect(second).toContain("ava-visual-title-message_two");
    expect(second).not.toContain("ava-visual-title-message_one");
  });
});
