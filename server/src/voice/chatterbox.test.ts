import { describe, it, expect, vi } from "vitest";
import { chatterboxUrl, chatterboxSpeak, DEFAULT_CHATTERBOX_TTS_URL } from "./chatterbox.js";

describe("chatterboxUrl", () => {
  it("defaults to the local server when unset", () => {
    expect(chatterboxUrl({})).toBe(DEFAULT_CHATTERBOX_TTS_URL);
    expect(chatterboxUrl({ CHATTERBOX_TTS_URL: "" })).toBe(DEFAULT_CHATTERBOX_TTS_URL);
  });
  it("honors CHATTERBOX_TTS_URL when set", () => {
    expect(chatterboxUrl({ CHATTERBOX_TTS_URL: "http://host:9/speak" })).toBe("http://host:9/speak");
  });
});

describe("chatterboxSpeak", () => {
  it("POSTs {text} as JSON and returns the WAV bytes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
    );
    const buf = await chatterboxSpeak("hi", { url: "http://x/speak", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(Array.from(buf)).toEqual([1, 2, 3]);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://x/speak");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ text: "hi" });
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(
      chatterboxSpeak("hi", { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/500/);
  });

  it("throws (aborts) when the request exceeds the timeout", async () => {
    // fetch that respects the abort signal and never resolves otherwise.
    const fetchImpl = (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    await expect(
      chatterboxSpeak("hi", { timeoutMs: 10, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow();
  });
});
