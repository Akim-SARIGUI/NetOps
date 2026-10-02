import { describe, expect, it } from "vitest";
import { parsePrefix } from "../ipam/address";
import { addressFromPtr, collectIssues, prepareRecord, ptrRelativeName, resolveLocal, reverseZoneName, type ZoneSnapshot } from "./records";

const prefix = parsePrefix("10.1.10.0/24");
if (!prefix.ok) throw new Error("préfixe");

const zone = { name: "entreprise.local", kind: "FORWARD" as const, cidr: null };

describe("enregistrements DNS", () => {
  it("nomme la zone inverse et le PTR d'une adresse du sous-réseau", () => {
    expect(reverseZoneName(prefix.prefix)).toBe("10.1.10.in-addr.arpa");
    expect(ptrRelativeName(prefix.prefix, "10.1.10.25")).toBe("25");
    expect(addressFromPtr(prefix.prefix, "25")).toBe("10.1.10.25");
  });

  it("prépare les noms demandés et refuse un A invalide ou un conflit", () => {
    const intranet = prepareRecord(zone, { name: "intranet", type: "A", value: "10.1.10.25" }, []);
    expect(intranet.ok && intranet.record).toMatchObject({ name: "intranet", rdata: "10.1.10.25" });
    expect(prepareRecord(zone, { name: "dns.entreprise.local", type: "AAAA", value: "10.0.0.10" }, []).ok).toBe(false);
    const existing = intranet.ok ? [intranet.record] : [];
    expect(prepareRecord(zone, { name: "intranet", type: "CNAME", value: "dns" }, existing).ok).toBe(false);
    expect(prepareRecord(zone, { name: "intranet", type: "A", value: "10.1.10.25" }, existing).ok).toBe(false);
  });

  it("résout localement et signale un PTR incohérent", () => {
    const zones: ZoneSnapshot[] = [
      {
        id: "forward",
        name: "entreprise.local",
        kind: "FORWARD",
        enabled: true,
        cidr: null,
        records: [
          { name: "@", type: "NS", rdata: "dns.entreprise.local", ttl: 3600, priority: null, weight: null, port: null },
          { name: "dns", type: "A", rdata: "10.0.0.10", ttl: null, priority: null, weight: null, port: null },
          { name: "dhcp", type: "A", rdata: "10.0.0.10", ttl: null, priority: null, weight: null, port: null },
          { name: "intranet", type: "A", rdata: "10.1.10.25", ttl: null, priority: null, weight: null, port: null },
          { name: "monitoring", type: "CNAME", rdata: "dns.entreprise.local", ttl: null, priority: null, weight: null, port: null },
        ],
      },
      {
        id: "reverse",
        name: "10.1.10.in-addr.arpa",
        kind: "REVERSE",
        enabled: true,
        cidr: "10.1.10.0/24",
        records: [{ name: "25", type: "PTR", rdata: "autre.entreprise.local", ttl: null, priority: null, weight: null, port: null }],
      },
      {
        id: "admin-reverse",
        name: "0.0.10.in-addr.arpa",
        kind: "REVERSE",
        enabled: true,
        cidr: "10.0.0.0/24",
        records: [],
      },
    ];
    const resolved = resolveLocal(zones, "monitoring.entreprise.local");
    expect(resolved.found).toBe(true);
    expect(resolved.answers.map((answer) => answer.rdata)).toEqual(["10.0.0.10"]);
    const issues = collectIssues(zones, ["10.0.0.0/24", "10.1.10.0/24"]);
    expect(issues.map((issue) => issue.code)).toContain("PTR_MISMATCH");
    expect(issues.map((issue) => issue.code)).toContain("REVERSE_MISSING");
  });
});
