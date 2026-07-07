import { describe, expect, it } from "vitest";
import { CHUNK_MIN_CHARS, CHUNK_OVERLAP_CHARS, CHUNK_TARGET_CHARS, chunkSections } from "./chunk";
import { sectionsFromMarkdown } from "./extract/localText";

const sentence = "The gradient tells the model which way is downhill on the loss surface. ";

describe("chunkSections", () => {
  it("keeps a short section as one chunk with its locator", () => {
    const chunks = chunkSections([{ locator: "p.1", text: sentence }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ seq: 0, locator: "p.1" });
  });

  it("splits a long section on sentence boundaries with tail overlap", () => {
    const long = sentence.repeat(200); // ~14k chars
    const chunks = chunkSections([{ locator: "p.2", text: long }]);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS + CHUNK_OVERLAP_CHARS + sentence.length);
      expect(c.locator).toBe("p.2");
    }
    // overlap: the head of chunk 2 repeats the tail of chunk 1
    const tail = chunks[0].text.slice(-80);
    expect(chunks[1].text.slice(0, CHUNK_OVERLAP_CHARS + 80)).toContain(tail.slice(0, 40));
  });

  it("never spans two sections in one chunk (locators stay truthful)", () => {
    const a = sentence.repeat(30);
    const b = sentence.repeat(30);
    const chunks = chunkSections([
      { locator: "Intro", text: a },
      { locator: "Method", text: b },
    ]);
    const locators = new Set(chunks.map((c) => c.locator));
    expect(locators).toEqual(new Set(["Intro", "Method"]));
  });

  it("merges runt sections only when their locator remains truthful", () => {
    const chunks = chunkSections([
      { locator: "Heading", text: "One line." },
      { locator: "Heading", text: sentence.repeat(10) },
    ]);
    expect(chunks[0].text.length).toBeGreaterThanOrEqual(CHUNK_MIN_CHARS);
    expect(chunks[0].locator).toBe("Heading");
  });

  it("does not merge a short PDF page into a different page locator", () => {
    const chunks = chunkSections([
      { locator: "p.1", text: "Short cover." },
      { locator: "p.2", text: sentence.repeat(10) },
    ]);
    expect(chunks.map((chunk) => chunk.locator)).toEqual(["p.1", "p.2"]);
  });

  it("drops empty sections and normalizes whitespace", () => {
    const chunks = chunkSections([
      { locator: null, text: "   \n\t " },
      { locator: null, text: "a  b\n\nc" },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("a b c");
  });

  it("assigns contiguous seq across sections", () => {
    const chunks = chunkSections([
      { locator: "A", text: sentence.repeat(100) },
      { locator: "B", text: sentence.repeat(100) },
    ]);
    expect(chunks.map((c) => c.seq)).toEqual([...chunks.keys()]);
  });
});

describe("sectionsFromMarkdown", () => {
  it("sections by markdown headings", () => {
    const md = "intro line\n\n# Setup\ninstall things\n\n## Config\nset the flag\n";
    const sections = sectionsFromMarkdown(md);
    expect(sections.map((s) => s.locator)).toEqual([null, "Setup", "Config"]);
    expect(sections[1].text).toContain("install things");
  });
});
