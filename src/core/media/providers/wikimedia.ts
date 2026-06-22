// Wikimedia Commons — the v1 media provider (image kind only). Pure TypeScript: it
// builds Commons API request descriptors and parses the JSON the Rust executor returns.
// No network I/O here. License + attribution are extracted from `extmetadata` so the
// resolve job can license-filter and the renderer can show required attribution (§6e).
import type {
  License,
  MediaQuery,
  MediaResult,
  RequestDescriptor,
  SearchableMediaProvider,
} from "../types";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

function stripHtml(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const text = s
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

interface ExtValue {
  value?: string;
}
interface ImageInfo {
  url?: string;
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  width?: number;
  height?: number;
  descriptionurl?: string;
  extmetadata?: Record<string, ExtValue>;
}
interface Page {
  title?: string;
  imageinfo?: ImageInfo[];
}
interface CommonsResponse {
  query?: { pages?: Record<string, Page> };
}

const PERMISSIVE = /public domain|^cc[ -]?(0|by|by[ -]?sa)/i;

function licenseOf(ext: Record<string, ExtValue> | undefined): License {
  const name = ext?.LicenseShortName?.value ?? "Unknown";
  const id = ext?.License?.value ?? name.toLowerCase();
  const url = ext?.LicenseUrl?.value;
  // CC0 / public-domain don't require attribution; everything else does, to be safe.
  const requiresAttribution = !/^(cc0|public domain)/i.test(name) && !/^cc0/i.test(id);
  return { id, name, url, requiresAttribution };
}

export const wikimedia: SearchableMediaProvider = {
  id: "wikimedia",
  label: "Wikimedia Commons",
  kinds: ["image"],
  needsKey: false,
  licenseDefault: "cc-by-sa",

  buildSearch(q: MediaQuery): RequestDescriptor {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "search",
      gsrnamespace: "6", // File: namespace
      gsrsearch: q.query,
      gsrlimit: "12",
      prop: "imageinfo",
      iiprop: "url|size|extmetadata",
      iiurlwidth: "800",
    });
    return { url: `${COMMONS_API}?${params.toString()}`, method: "GET" };
  },

  parseSearch(body: unknown): MediaResult[] {
    const pages = (body as CommonsResponse)?.query?.pages;
    if (!pages) return [];
    const out: MediaResult[] = [];
    for (const page of Object.values(pages)) {
      const info = page.imageinfo?.[0];
      if (!info?.url) continue;
      const ext = info.extmetadata;
      const license = licenseOf(ext);
      // prefer the rescaled thumb for display; keep the full url for fetch
      out.push({
        kind: "image",
        providerId: "wikimedia",
        payload: {
          kind: "image",
          url: info.thumburl ?? info.url,
          thumbUrl: info.thumburl,
          width: info.thumbwidth ?? info.width,
          height: info.thumbheight ?? info.height,
        },
        license,
        attribution: {
          author: stripHtml(ext?.Artist?.value),
          sourceUrl: info.descriptionurl ?? info.url,
          title: page.title?.replace(/^File:/, ""),
        },
      });
    }
    return out;
  },

  buildFetch(r: MediaResult): RequestDescriptor {
    const url = r.payload.kind === "image" ? r.payload.url : "";
    return { url, method: "GET" };
  },
};

/** True when a license is permissive enough to use by default (public-domain / CC). */
export function isPermissive(license: License): boolean {
  return PERMISSIVE.test(license.name) || PERMISSIVE.test(license.id);
}
