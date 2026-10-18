import { test, expect } from "bun:test";
import {
  compareVersions,
  cpeMatchApplies,
  formatCves,
  parseNvdCves,
  selectCves,
} from "@/agent/tools";

/** A trimmed-down NVD 2.0 response, shaped like the real one. */
const payload = {
  resultsPerPage: 2,
  totalResults: 2,
  vulnerabilities: [
    {
      cve: {
        id: "CVE-2024-0001",
        published: "2024-03-01T12:00:00.000",
        descriptions: [
          { lang: "es", value: "descripcion" },
          { lang: "en", value: "nginx 1.24.0  allows   request smuggling." },
        ],
        metrics: {
          cvssMetricV31: [
            {
              cvssData: {
                baseScore: 9.8,
                baseSeverity: "CRITICAL",
                vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
              },
            },
          ],
        },
        references: [
          { url: "https://example.test/a" },
          { url: "https://example.test/b" },
          { url: "https://example.test/c" },
          { url: "https://example.test/d" },
        ],
      },
    },
    {
      cve: {
        id: "CVE-2023-0002",
        descriptions: [{ lang: "en", value: "Older issue" }],
        metrics: { cvssMetricV2: [{ cvssData: { baseScore: 5.0 }, baseSeverity: "MEDIUM" }] },
        references: [],
      },
    },
  ],
};

test("parseNvdCves reads ids, CVSS and concise evidence", () => {
  const rows = parseNvdCves(payload, 10);
  expect(rows).toHaveLength(2);

  expect(rows[0]).toEqual({
    id: "CVE-2024-0001",
    severity: "CRITICAL",
    score: 9.8,
    vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    published: "2024-03-01",
    summary: "nginx 1.24.0 allows request smuggling.",
    references: ["https://example.test/a", "https://example.test/b", "https://example.test/c"],
  });

  // Falls back to CVSS v2, and keeps only the fields that exist.
  expect(rows[1]!.severity).toBe("MEDIUM");
  expect(rows[1]!.score).toBe(5);
  expect(rows[1]!.vector).toBeUndefined();

  expect(parseNvdCves(payload, 1)).toHaveLength(1);
});

test("parseNvdCves tolerates junk payloads", () => {
  expect(parseNvdCves(null, 5)).toEqual([]);
  expect(parseNvdCves("nope", 5)).toEqual([]);
  expect(parseNvdCves({ vulnerabilities: "nope" }, 5)).toEqual([]);
  expect(parseNvdCves({ vulnerabilities: [{}, { cve: {} }] }, 5)).toEqual([]);
});

test("formatCves renders a readable block and handles the empty case", () => {
  const text = formatCves(parseNvdCves(payload, 1), "NVD · nginx 1.24.0");
  expect(text).toContain("NVD · nginx 1.24.0");
  expect(text).toContain("CVE-2024-0001  [9.8 CRITICAL]  2024-03-01");
  expect(text).toContain("vector: CVSS:3.1/");
  expect(text).toContain("refs: https://example.test/a");
  expect(text).not.toContain("CVE-2023-0002");

  expect(formatCves([], "NVD · nothing")).toContain("(no CVEs found)");
});

test("compareVersions orders releases the way CPE ranges need", () => {
  expect(compareVersions("1.24.0", "1.24.0")).toBe(0);
  // A missing component counts as zero, so "1.24" and "1.24.0" compare equal.
  expect(compareVersions("1.24.0", "1.24")).toBe(0);
  expect(compareVersions("1.9.0", "1.10.0")).toBeLessThan(0);
  expect(compareVersions("2.4.49", "2.4.0")).toBeGreaterThan(0);
  expect(compareVersions("1.25.2", "1.25.10")).toBeLessThan(0);
});

test("cpeMatchApplies honours NVD version ranges", () => {
  const nginx = { product: "nginx", version: "1.24.0" };

  expect(
    cpeMatchApplies(
      { criteria: "cpe:2.3:a:nginx:nginx:1.24.0:*:*:*:*:*:*:*", vulnerable: true },
      nginx,
    ),
  ).toBe("=1.24.0");

  expect(
    cpeMatchApplies(
      {
        criteria: "cpe:2.3:a:nginx:nginx:*:*:*:*:*:*:*:*",
        vulnerable: true,
        versionEndIncluding: "1.25.2",
      },
      nginx,
    ),
  ).toBe("<=1.25.2");

  // Range that starts above the version we observed.
  expect(
    cpeMatchApplies(
      {
        criteria: "cpe:2.3:a:nginx:nginx:*:*:*:*:*:*:*:*",
        vulnerable: true,
        versionStartIncluding: "1.26.0",
      },
      nginx,
    ),
  ).toBeUndefined();

  // Same range but exclusive at the observed version.
  expect(
    cpeMatchApplies(
      {
        criteria: "cpe:2.3:a:nginx:nginx:*:*:*:*:*:*:*:*",
        vulnerable: true,
        versionEndExcluding: "1.24.0",
      },
      nginx,
    ),
  ).toBeUndefined();

  // A different product, and a non-vulnerable platform entry.
  expect(
    cpeMatchApplies(
      { criteria: "cpe:2.3:a:apache:http_server:*:*:*:*:*:*:*:*", vulnerable: true },
      nginx,
    ),
  ).toBeUndefined();
  expect(
    cpeMatchApplies(
      { criteria: "cpe:2.3:a:nginx:nginx:1.24.0:*:*:*:*:*:*:*", vulnerable: false },
      nginx,
    ),
  ).toBeUndefined();
});

/** Wrap a CVE the way NVD returns it, with a single configuration node. */
function wrap(id: string, cpeMatch: Record<string, unknown>[]) {
  return {
    cve: {
      id,
      published: "2024-01-01T00:00:00.000",
      vulnStatus: "Analyzed",
      descriptions: [{ lang: "en", value: `${id} affects nginx` }],
      metrics: { cvssMetricV31: [{ cvssData: { baseScore: 7.5, baseSeverity: "HIGH" } }] },
      references: [],
      configurations: [{ nodes: [{ operator: "OR", cpeMatch }] }],
    },
  };
}

const rangedPayload = {
  vulnerabilities: [
    wrap("CVE-2023-44487", [
      {
        vulnerable: true,
        criteria: "cpe:2.3:a:nginx:nginx:*:*:*:*:*:*:*:*",
        versionEndIncluding: "1.25.2",
      },
    ]),
    wrap("CVE-2030-0001", [
      {
        vulnerable: true,
        criteria: "cpe:2.3:a:nginx:nginx:*:*:*:*:*:*:*:*",
        versionStartIncluding: "9.0.0",
      },
    ]),
    { cve: { id: "CVE-2020-9999", vulnStatus: "Rejected", descriptions: [] } },
  ],
};

test("selectCves keeps only the CVEs that affect the requested version", () => {
  const rows = selectCves(rangedPayload, { product: "nginx", version: "1.24.0" }, 10);
  expect(rows.map((r) => r.id)).toEqual(["CVE-2023-44487"]);
  expect(rows[0]!.match).toBe("<=1.25.2");

  // Without a version filter there is nothing to apply, but rejected CVEs still go away.
  expect(parseNvdCves(rangedPayload, 10).map((r) => r.id)).toEqual([
    "CVE-2023-44487",
    "CVE-2030-0001",
  ]);
});
