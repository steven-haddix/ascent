// local-text extractor — markdown / plain text passthrough, sectioned by markdown
// headings when present so uploads like notes.md keep citable locators.
import type { DocumentExtractor, ExtractedSection } from "../types";

const TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);

export function sectionsFromMarkdown(raw: string): ExtractedSection[] {
  const sections: ExtractedSection[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join("\n").replace(/\s+/g, " ").trim();
    if (text) sections.push({ locator: heading, text });
    buf = [];
  };
  for (const line of raw.split(/\r?\n/)) {
    const m = /^#{1,6}\s+(.+)$/.exec(line);
    if (m) {
      flush();
      heading = m[1].trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

export const localText: DocumentExtractor = {
  id: "local-text",
  label: "Built-in text/markdown",
  tier: "local",
  accepts: (mime) => TEXT_MIMES.has(mime),
  async extract({ bytes }) {
    const sections = sectionsFromMarkdown(new TextDecoder().decode(bytes));
    if (!sections.length) throw new Error("document is empty");
    return { sections };
  },
};
