// Visual Registry — the catalog facet (Visual Learning System §2). Pure metadata: which
// visual kinds exist, which subjects they serve (drives the Planner's domain budget §3a),
// and how they're produced. No UI or AI deps — src/core stays UI-free.

/** Closed set of subject domains — the single source of truth. The outline/fork LLM calls
 *  classify a concept's domains against this list (validated via `z.enum(DOMAINS)`). */
export const DOMAINS = [
  "science",
  "math",
  "programming",
  "history",
  "biography",
  "arts",
  "music",
  "language",
  "law",
  "business",
  "geography",
  "general",
] as const;
export type Domain = (typeof DOMAINS)[number];

export type VisualKind =
  | "timeline"
  | "figure"
  | "graph"
  | "spectrum"
  | "map"
  | "media"
  | "chart"
  | "diagram"
  | "widget";

export interface VisualKindDefinition {
  id: VisualKind;
  label: string;
  /** subjects this kind serves well — drives the domain-aware visual budget (§3a) */
  affinity: Domain[];
  /** inline = emitted in the lesson stream; job = filled async after the stream */
  production: "inline" | "job";
  requiresAltText: true;
}

/** Registered visual kinds. Only kinds with a renderer (plus existing chart/diagram/
 *  widget) appear here; figure/graph/map/media register in later waves as they land. */
export const visualCatalog: Record<string, VisualKindDefinition> = {
  chart: {
    id: "chart",
    label: "Chart",
    affinity: ["science", "math", "business", "programming"],
    production: "inline",
    requiresAltText: true,
  },
  diagram: {
    id: "diagram",
    label: "Diagram",
    affinity: ["programming", "science", "business", "general"],
    production: "inline",
    requiresAltText: true,
  },
  widget: {
    id: "widget",
    label: "Widget",
    affinity: ["math", "science", "programming"],
    production: "job",
    requiresAltText: true,
  },
  timeline: {
    id: "timeline",
    label: "Timeline",
    affinity: ["history", "biography", "arts", "music", "law", "general"],
    production: "inline",
    requiresAltText: true,
  },
  spectrum: {
    id: "spectrum",
    label: "Spectrum",
    affinity: ["history", "law", "business", "arts", "language", "general"],
    production: "inline",
    requiresAltText: true,
  },
  figure: {
    id: "figure",
    label: "Figure",
    affinity: ["biography", "arts", "music", "science", "history", "geography", "general"],
    production: "inline",
    requiresAltText: true,
  },
  graph: {
    id: "graph",
    label: "Graph",
    affinity: ["history", "business", "science", "programming", "biography", "general"],
    production: "inline",
    requiresAltText: true,
  },
  map: {
    id: "map",
    label: "Map",
    affinity: ["geography", "history", "business", "general"],
    production: "inline",
    requiresAltText: true,
  },
  media: {
    id: "media",
    label: "Image",
    affinity: ["history", "biography", "arts", "music", "geography", "science", "general"],
    production: "job",
    requiresAltText: true,
  },
};

/** Visual kinds whose affinity includes a domain — drives the Planner budget (§3a). */
export function kindsForDomain(domain: Domain): VisualKindDefinition[] {
  return Object.values(visualCatalog).filter((d) => d.affinity.includes(domain));
}

/** Union of visual kinds across a concept's (multi-tag) domains, deduped — the budget for a
 *  concept that spans domains (e.g. "History of Calculus" → history + math). */
export function kindsForDomains(domains: Domain[]): VisualKindDefinition[] {
  const seen = new Set<string>();
  const out: VisualKindDefinition[] = [];
  for (const d of domains) {
    for (const def of kindsForDomain(d)) {
      if (!seen.has(def.id)) {
        seen.add(def.id);
        out.push(def);
      }
    }
  }
  return out;
}

/** Cheap keyword inference of a concept/topic's Domain — NOT a model call (the topic
 *  already implies it). Reused, not per-lesson. Falls back to "general". */
export function inferDomain(text: string): Domain {
  const t = ` ${text.toLowerCase()} `;
  const has = (...kw: string[]) => kw.some((k) => t.includes(k));
  if (has("histor", " war", "empire", "revolution", "ancient", "medieval", "dynasty", "century", "treaty")) return "history";
  if (has("biograph", "life of", " poet", " painter", " composer", " novelist")) return "biography";
  if (has("paint", "sculpt", "architect", " art ", " arts", "aesthetic", "renaissance", "literature", "poetry")) return "arts";
  if (has("music", "harmony", "rhythm", "melod", "compos", " chord", "sonata", "scale")) return "music";
  if (has("language", "grammar", "linguist", "syntax", "vocabulary", "phonet", "tense")) return "language";
  if (has(" law", "legal", "constitution", " court", "statute", "justice", " rights")) return "law";
  if (has("geograph", " map", "region", "climate", "terrain", "country", "continent", "border")) return "geography";
  if (has("business", "market", "econom", "finance", "manage", "strategy", "startup", "pricing")) return "business";
  if (has("program", " code", "software", "algorithm", " function", " api", "data structure", "compiler")) return "programming";
  if (has(" math", "theorem", "equation", "calculus", "algebra", " proof", "geometry", "probability", "matrix")) return "math";
  if (has("biolog", "physic", "chemist", "science", " cell", "molecul", "neuron", " gene", "quantum", "gradient", "entrop")) return "science";
  return "general";
}
