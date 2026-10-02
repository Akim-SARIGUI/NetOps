import { describe, expect, it } from "vitest";
import { DOCUMENTATION_NOTICE, SECTIONS, moduleRelations, toCsv, toJsonDocument, toPdf, type DocSection } from "./evaluate";

const sample: DocSection[] = [
  {
    id: "INVENTORY",
    title: "Inventaire",
    description: "Équipements",
    columns: ["hostname", "role"],
    rows: [{ hostname: "core-paris", role: "ROUTER" }],
  },
];

describe("documentation plateforme", () => {
  it("couvre les sections attendues et les formats", () => {
    expect(SECTIONS).toContain("IP_PLAN");
    expect(SECTIONS).toContain("FIREWALL_MATRIX");
    expect(SECTIONS).toContain("CONFIGURATION_HISTORY");
    expect(DOCUMENTATION_NOTICE).toContain("Aucun équipement réel");
    expect(moduleRelations().some((item) => item.from === "VLAN" && item.to === "IPAM")).toBe(true);
    const csv = toCsv(sample);
    expect(csv).toContain("hostname");
    expect(csv).toContain("core-paris");
    const json = toJsonDocument({
      notice: DOCUMENTATION_NOTICE,
      organization: { id: "1", name: "Demo", slug: "demo" },
      generatedAt: "2026-10-02T00:00:00.000Z",
      siteId: null,
      sections: sample,
      relations: moduleRelations(),
    });
    expect(json).toContain("core-paris");
    const pdf = toPdf({
      title: "NetOps",
      notice: DOCUMENTATION_NOTICE,
      generatedAt: "2026-10-02T00:00:00.000Z",
      organizationName: "Demo",
      sections: sample,
    });
    expect(pdf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(pdf.toString("utf8")).toContain("core-paris");
  });
});
