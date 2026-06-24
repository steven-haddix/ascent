import { describe, it, expect } from "vitest";
import { tavily } from "./tavily";

describe("tavily provider", () => {
  it("buildSearch → POST descriptor, bearer-by-default secret, query body", () => {
    const d = tavily.buildSearch({ query: "rope scaling", topK: 7, freshness: "recent" });
    expect(d.url).toBe("https://api.tavily.com/search");
    expect(d.method).toBe("POST");
    expect(d.secretAccount).toBe("provider:tavily");
    expect(d.auth).toBeUndefined(); // default bearer — works with the current executor, no Rust change
    const body = JSON.parse(d.body!);
    expect(body.query).toBe("rope scaling");
    expect(body.max_results).toBe(7);
    expect(body.topic).toBe("news"); // freshness "recent" → news topic
  });

  it("parseSearch maps content→snippet, infers kind, drops non-http(s) urls", () => {
    const results = tavily.parseSearch({
      results: [
        { title: "A paper", url: "https://arxiv.org/abs/2504.06214", content: "long ctx", score: 0.9, published_date: "2025-04-01" },
        { title: "Vid", url: "https://youtube.com/watch?v=x", content: "talk" },
        { title: "bad", url: "javascript:alert(1)", content: "nope" },
      ],
    });
    expect(results).toHaveLength(2); // javascript: dropped
    expect(results[0].kind).toBe("paper");
    expect(results[0].snippet).toBe("long ctx");
    expect(results[0].source).toBe("arxiv.org");
    expect(results[0].publishedAt).toBe("2025-04-01");
    expect(results[1].kind).toBe("video");
  });

  it("parseSearch tolerates an empty/odd body", () => {
    expect(tavily.parseSearch({})).toEqual([]);
    expect(tavily.parseSearch(null)).toEqual([]);
  });
});
