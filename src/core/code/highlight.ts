// Singleton Shiki highlighter. Built on shiki/core with the JavaScript regex
// engine (no WASM grammar runtime) and a tight set of pre-bundled languages and
// themes, so the highlighter is small, fully offline, and shared across all code
// blocks in the app. Dual-theme (github-light + github-dark) → one render works
// across cream / paper / dark via the .dark class on <html>.
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import python from "shiki/langs/python.mjs";
import javascript from "shiki/langs/javascript.mjs";
import typescript from "shiki/langs/typescript.mjs";
import bash from "shiki/langs/bash.mjs";
import json from "shiki/langs/json.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import githubDark from "shiki/themes/github-dark.mjs";

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubLight, githubDark],
      langs: [python, javascript, typescript, bash, json],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

// Common aliases the model (or a learner) might supply; resolve to a loaded lang.
const LANG_ALIAS: Record<string, string> = {
  py: "python",
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
};

export async function highlightCode(code: string, lang: string): Promise<string> {
  const highlighter = await getHighlighter();
  const requested = (LANG_ALIAS[lang] ?? lang).toLowerCase();
  const loaded = highlighter.getLoadedLanguages();
  const language = loaded.includes(requested) ? requested : "text";
  return highlighter.codeToHtml(code, {
    lang: language,
    themes: { light: "github-light", dark: "github-dark" },
  });
}
