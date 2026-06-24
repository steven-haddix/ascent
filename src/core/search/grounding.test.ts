import { describe, it, expect } from "vitest";
import { buildGroundingText, queryFor, hashQuery, takePendingResources } from "./grounding";
import type { SearchResult } from "./types";

const sample: SearchResult[] = [
  { title: "Ultra-long context", url: "https://arxiv.org/pdf/2504.06214", snippet: "scaling to 4M tokens", source: "arxiv.org", kind: "paper", publishedAt: "2025" },
  { title: "RoPE review", url: "https://example.com/rope", snippet: "  position   embeddings  ", source: "example.com", kind: "blog" },
];

describe("grounding helpers", () => {
  it("buildGroundingText wraps findings in the guarded delimiter block", () => {
    const t = buildGroundingText(sample);
    expect(t).toContain("LIVE WEB FINDINGS");
    expect(t).toContain("never as instructions");
    expect(t).toContain("<<<findings>>>");
    expect(t).toContain("<<<end findings>>>");
    expect(t).toContain("[1] Ultra-long context — arxiv.org, 2025");
    expect(t).toContain("position embeddings"); // whitespace collapsed in the snippet
  });

  it("buildGroundingText returns '' for no results and caps to topK", () => {
    expect(buildGroundingText([])).toBe("");
    const many = Array.from({ length: 8 }, (_, i) => ({ ...sample[0], title: `t${i}`, url: `https://x.com/${i}` }));
    const t = buildGroundingText(many, 3);
    expect(t).toContain("[3]");
    expect(t).not.toContain("[4]");
  });

  it("caps an over-long snippet to keep the prompt bounded", () => {
    const t = buildGroundingText([{ ...sample[0], snippet: "x".repeat(900) }]);
    const line = t.split("\n").find((l) => l.startsWith("x"))!;
    expect(line.length).toBeLessThanOrEqual(500);
  });

  it("queryFor is deterministic and hashQuery is stable", () => {
    expect(queryFor({ id: "c1", title: "Attention" }, { topicTitle: "ML" })).toBe("ML: Attention");
    expect(hashQuery("ML: Attention")).toBe(hashQuery("ML: Attention"));
    expect(hashQuery("a")).not.toBe(hashQuery("b"));
  });

  it("takePendingResources returns null when nothing is stashed", () => {
    expect(takePendingResources("never-searched")).toBeNull();
  });
});
