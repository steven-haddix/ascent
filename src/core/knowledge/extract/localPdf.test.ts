import { describe, expect, it, vi } from "vitest";
import { textFromPdfPage } from "./localPdf";

describe("textFromPdfPage", () => {
  it("reads PDF.js text chunks without requiring ReadableStream async iteration", async () => {
    const releaseLock = vi.fn();
    const chunks = [
      { items: [{ str: "First" }, { str: "  page" }, {}] },
      { items: [{ str: "line\n two" }] },
    ];
    const stream = {
      // Deliberately no Symbol.asyncIterator: this matches affected WKWebViews.
      getReader: () => ({
        read: async () =>
          chunks.length ? { done: false as const, value: chunks.shift()! } : { done: true as const, value: undefined },
        releaseLock,
      }),
    };

    await expect(
      textFromPdfPage({ streamTextContent: () => stream as unknown as ReadableStream<{ items: Array<{ str?: string }> }> }),
    ).resolves.toBe("First page line two");
    expect(releaseLock).toHaveBeenCalledOnce();
  });
});
