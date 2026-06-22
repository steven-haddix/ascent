// The widget sandbox runtime — built standalone by `bun run build:widget-runtime`
// into public/widget-runtime.js (an IIFE bundling React) and inlined into each
// widget iframe's srcdoc by widgetFrame.ts. It runs inside
// <iframe sandbox="allow-scripts"> with an OPAQUE origin: no Tauri IPC, no app
// storage, postMessage is the only channel out.
//
// MUST NOT import from src/core or src/ui (different world — keep it standalone),
// and MUST NOT touch @tauri-apps/* (the whole point is that it can't).
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import * as d3Scale from "d3-scale";
import * as d3Shape from "d3-shape";
import * as d3Array from "d3-array";
import * as d3Force from "d3-force";

// A lean d3 namespace for sandbox widgets: math/layout helpers (scales, shapes, arrays,
// force). DOM stays React's job — avoids the d3-vs-React "two masters of the DOM" tension;
// this is for genuinely novel interaction only. Bundled into every widget srcdoc, so kept
// deliberately small (spike #4 measures the payload; trim or gate behind Sonnet if heavy).
const d3 = { ...d3Scale, ...d3Shape, ...d3Array, ...d3Force };

function post(msg: Record<string, unknown>) {
  window.parent.postMessage(msg, "*");
}

/** Spike #1 baked in as a hard guard: if Tauri's injected globals are reachable
 *  inside this frame the sandbox is NOT holding — refuse to run generated code. */
function exposedIpc(): string | null {
  const w = window as unknown as Record<string, unknown>;
  if (w.__TAURI_INTERNALS__) return "__TAURI_INTERNALS__";
  if (w.__TAURI__) return "__TAURI__";
  if (w.ipc) return "ipc";
  return null;
}

let root: Root | null = null;
// One error report per render — the boundary, window.onerror, and the catch
// below can all fire for the same failure.
let reported = false;

function fail(message: string) {
  if (reported) return;
  reported = true;
  post({ type: "ascent:error", message });
}

class Boundary extends React.Component<{ children?: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    fail(err instanceof Error ? err.message : String(err));
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function render(compiled: string, tokens: Record<string, string>, colorScheme?: string) {
  reported = false;
  try {
    // Theme tokens arrive from the parent (re-sent on theme switch) so generated
    // code can style with var(--color-…) and look native. color-scheme must track
    // the parent's too — a mismatch makes the host paint an opaque white canvas
    // behind this document.
    for (const [k, v] of Object.entries(tokens)) {
      if (k.startsWith("--")) document.documentElement.style.setProperty(k, v);
    }
    if (colorScheme === "dark" || colorScheme === "light") {
      document.documentElement.style.colorScheme = colorScheme;
    }
    const factory = new Function(
      "React",
      "d3",
      `"use strict";\n${compiled}\n;return typeof Widget === "function" ? Widget : null;`,
    );
    const Widget = factory(React, d3) as React.ComponentType | null;
    if (!Widget) throw new Error("the code must define `function Widget()` at the top level");
    root ??= createRoot(document.getElementById("root")!);
    root.render(React.createElement(Boundary, null, React.createElement(Widget)));
    // After a paint: if nothing failed synchronously, report success + height.
    requestAnimationFrame(() => {
      if (!reported) post({ type: "ascent:rendered", height: document.body.scrollHeight });
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

window.addEventListener("error", (e) => fail(e.message || "script error"));
window.addEventListener("unhandledrejection", (e) => fail(String(e.reason ?? "unhandled rejection")));
window.addEventListener("message", (e) => {
  if (e.source !== window.parent) return;
  const m = e.data as { type?: string; compiled?: string; tokens?: Record<string, string>; colorScheme?: string };
  if (m?.type === "ascent:render" && typeof m.compiled === "string") render(m.compiled, m.tokens ?? {}, m.colorScheme);
});

new ResizeObserver(() => {
  post({ type: "ascent:resize", height: document.body.scrollHeight });
}).observe(document.body);

const leak = exposedIpc();
if (leak) {
  fail(`sandbox breach: window.${leak} is reachable inside the widget frame — refusing to run generated code`);
} else {
  post({ type: "ascent:ready" });
}
