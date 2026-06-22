import { describe, it, expect } from "vitest";
import { wikimedia, isPermissive } from "./wikimedia";

// A trimmed but realistic Commons `generator=search` + `imageinfo` response.
const FIXTURE = {
  query: {
    pages: {
      "123": {
        title: "File:Trench warfare WWI.jpg",
        imageinfo: [
          {
            url: "https://upload.wikimedia.org/full.jpg",
            thumburl: "https://upload.wikimedia.org/thumb_800.jpg",
            thumbwidth: 800,
            thumbheight: 533,
            width: 4000,
            height: 2667,
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Trench_warfare_WWI.jpg",
            extmetadata: {
              LicenseShortName: { value: "CC BY-SA 4.0" },
              License: { value: "cc-by-sa-4.0" },
              LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
              Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Someone">Jane Photographer</a>' },
            },
          },
        ],
      },
      "456": {
        title: "File:Public domain map.png",
        imageinfo: [
          {
            url: "https://upload.wikimedia.org/pd.png",
            thumburl: "https://upload.wikimedia.org/pd_800.png",
            extmetadata: {
              LicenseShortName: { value: "Public domain" },
              License: { value: "pd" },
            },
          },
        ],
      },
    },
  },
};

describe("wikimedia adapter", () => {
  it("buildSearch produces a Commons API GET descriptor with the query", () => {
    const d = wikimedia.buildSearch({ kind: "image", query: "trench warfare" });
    expect(d.method).toBe("GET");
    expect(d.url).toContain("commons.wikimedia.org/w/api.php");
    expect(d.url).toContain("gsrsearch=trench+warfare");
    expect(d.url).toContain("iiprop=url");
  });

  it("parseSearch extracts results with license + attribution", () => {
    const results = wikimedia.parseSearch(FIXTURE);
    expect(results).toHaveLength(2);
    const first = results.find((r) => r.attribution.title === "Trench warfare WWI.jpg")!;
    expect(first.kind).toBe("image");
    expect(first.providerId).toBe("wikimedia");
    expect(first.payload.kind).toBe("image");
    if (first.payload.kind === "image") expect(first.payload.url).toBe("https://upload.wikimedia.org/thumb_800.jpg");
    expect(first.license.name).toBe("CC BY-SA 4.0");
    expect(first.license.requiresAttribution).toBe(true);
    expect(first.attribution.author).toBe("Jane Photographer"); // HTML stripped
    expect(first.attribution.sourceUrl).toContain("commons.wikimedia.org/wiki/File");
  });

  it("public-domain results do not require attribution", () => {
    const results = wikimedia.parseSearch(FIXTURE);
    const pd = results.find((r) => r.license.name === "Public domain")!;
    expect(pd.license.requiresAttribution).toBe(false);
  });

  it("parseSearch tolerates an empty/garbage body", () => {
    expect(wikimedia.parseSearch({})).toEqual([]);
    expect(wikimedia.parseSearch(null)).toEqual([]);
  });

  it("isPermissive accepts CC/PD licenses", () => {
    expect(isPermissive({ id: "cc-by-sa-4.0", name: "CC BY-SA 4.0", requiresAttribution: true })).toBe(true);
    expect(isPermissive({ id: "pd", name: "Public domain", requiresAttribution: false })).toBe(true);
    expect(isPermissive({ id: "arr", name: "All rights reserved", requiresAttribution: true })).toBe(false);
  });

  it("buildFetch points at the chosen asset url", () => {
    const [first] = wikimedia.parseSearch(FIXTURE);
    const d = wikimedia.buildFetch(first);
    expect(d.method).toBe("GET");
    expect(d.url).toContain("upload.wikimedia.org");
  });
});
