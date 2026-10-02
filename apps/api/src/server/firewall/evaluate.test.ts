import { describe, expect, it } from "vitest";
import { collectIssues, flowMatrix, prepareRule, type NormalizedRule } from "./evaluate";

const zones = ["GUEST", "INTERNET", "INTERNAL", "IT", "SERVERS", "MANAGEMENT"];

function rule(priority: number, source: string, destination: string, action: "ALLOW" | "DENY" = "ALLOW", protocol: NormalizedRule["protocol"] = "ANY") {
  const prepared = prepareRule({ priority, source, destination, action, protocol }, { mode: "flow", zones, existing: [] });
  if (!prepared.ok) throw new Error(prepared.message);
  return prepared.rule;
}

describe("politique de pare-feu", () => {
  it("accepte les flux de l'exemple et construit la matrice VLAN", () => {
    const flows = [
      rule(100, "GUEST", "INTERNET", "ALLOW"),
      rule(110, "GUEST", "INTERNAL", "DENY"),
      rule(200, "IT", "SERVERS", "ALLOW"),
      rule(210, "IT", "MANAGEMENT", "ALLOW"),
    ];
    expect(flows.map((item) => `${item.source} → ${item.destination} ${item.action}`)).toEqual([
      "GUEST → INTERNET ALLOW",
      "GUEST → INTERNAL DENY",
      "IT → SERVERS ALLOW",
      "IT → MANAGEMENT ALLOW",
    ]);
    const cells = flowMatrix([
      { id: "users", vid: 10, name: "Utilisateurs", zone: "IT" },
      { id: "servers", vid: 30, name: "Serveurs", zone: "SERVERS" },
      { id: "mgmt", vid: 99, name: "Management", zone: "MANAGEMENT" },
    ], flows);
    expect(cells.find((cell) => cell.source.vid === 10 && cell.destination.vid === 30)?.action).toBe("ALLOW");
    expect(cells.find((cell) => cell.source.vid === 10 && cell.destination.vid === 99)?.action).toBe("ALLOW");
    expect(cells.find((cell) => cell.source.vid === 30 && cell.destination.vid === 10)?.implicit).toBe(true);
  });

  it("refuse une règle impossible, un doublon et une priorité déjà prise", () => {
    const existing = [{ priority: 100, signature: rule(100, "GUEST", "INTERNET").signature, action: "ALLOW" as const }];
    const icmp = prepareRule({ priority: 120, source: "GUEST", destination: "INTERNET", protocol: "ICMP", destinationPort: "80", action: "ALLOW" }, { mode: "flow", zones, existing });
    const duplicate = prepareRule({ priority: 130, source: "GUEST", destination: "INTERNET", action: "ALLOW" }, { mode: "flow", zones, existing });
    const priority = prepareRule({ priority: 100, source: "IT", destination: "SERVERS", action: "ALLOW" }, { mode: "flow", zones, existing });
    const hostBits = prepareRule({ priority: 140, source: "10.1.10.5/24", destination: "ANY", protocol: "TCP", destinationPort: "443", action: "DENY" }, { mode: "acl", zones, existing: [] });
    expect(icmp).toMatchObject({ ok: false, status: 422 });
    expect(duplicate).toMatchObject({ ok: false, status: 409 });
    expect(priority).toMatchObject({ ok: false, status: 409 });
    expect(hostBits).toMatchObject({ ok: false, status: 422 });
  });

  it("signale une contradiction et une règle couverte", () => {
    const allow = { ...rule(100, "GUEST", "INTERNET", "ALLOW"), id: "allow" };
    const deny = prepareRule({ priority: 120, source: "GUEST", destination: "INTERNET", action: "DENY" }, { mode: "flow", zones, existing: [{ priority: allow.priority, signature: allow.signature, action: allow.action }] });
    expect(deny.ok).toBe(true);
    if (!deny.ok) return;
    const contradiction = collectIssues([allow, { ...deny.rule, id: "deny" }]);
    expect(contradiction.some((issue) => issue.code === "CONTRADICTION")).toBe(true);
    const broadPrepared = prepareRule({ priority: 10, source: "10.1.0.0/16", destination: "ANY", action: "DENY" }, { mode: "acl", zones, existing: [] });
    expect(broadPrepared.ok).toBe(true);
    if (!broadPrepared.ok) return;
    const broader = { ...broadPrepared.rule, id: "broad" };
    const prepared = prepareRule(
      { priority: 20, source: "10.1.10.0/24", destination: "10.1.30.0/24", protocol: "TCP", destinationPort: "443", action: "ALLOW" },
      { mode: "acl", zones, existing: [{ priority: broader.priority, signature: broader.signature, action: broader.action }] },
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const impossible = collectIssues([broader, { ...prepared.rule, id: "narrow" }]);
    expect(impossible).toEqual([expect.objectContaining({ ruleId: "narrow", code: "IMPOSSIBLE" })]);
  });
});
