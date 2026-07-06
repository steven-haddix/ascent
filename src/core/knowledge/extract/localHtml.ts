// local-html extractor — Readability article extraction (K0-spiked on Wikipedia +
// a blog), sectioned by headings so chunks carry a citable locator. DOMParser is
// native in the webview; Readability mutates its input, so it gets its own parse.
import { Readability } from "@mozilla/readability";
import type { DocumentExtractor, ExtractedSection } from "../types";

/** Walk the article's cleaned HTML, grouping text under the most recent heading. */
export function sectionsFromArticleHtml(html: string): ExtractedSection[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const sections: ExtractedSection[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join(" ").replace(/\s+/g, " ").trim();
    if (text) sections.push({ locator: heading, text });
    buf = [];
  };
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (/^H[1-6]$/.test(child.tagName)) {
        flush();
        heading = child.textContent?.replace(/\s+/g, " ").trim() || heading;
      } else if (child.children.length && !/^(P|LI|PRE|BLOCKQUOTE|TABLE|FIGURE)$/.test(child.tagName)) {
        walk(child); // container — recurse for nested headings
      } else {
        const text = child.textContent?.trim();
        if (text) buf.push(text);
      }
    }
  };
  walk(doc.body);
  flush();
  return sections;
}

export const localHtml: DocumentExtractor = {
  id: "local-html",
  label: "Built-in article reader",
  tier: "local",
  accepts: (mime) => mime === "text/html" || mime === "application/xhtml+xml",
  async extract({ bytes, title }) {
    const html = new TextDecoder().decode(bytes);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const article = new Readability(doc).parse();
    if (!article?.content) throw new Error("no readable article content found");
    const sections = sectionsFromArticleHtml(article.content);
    if (!sections.length && article.textContent?.trim()) {
      sections.push({ locator: null, text: article.textContent.replace(/\s+/g, " ").trim() });
    }
    if (!sections.length) throw new Error("no readable article content found");
    return { title: article.title?.trim() || title, sections };
  },
};
