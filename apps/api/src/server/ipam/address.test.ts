import { describe, expect, it } from "vitest";
import { isUsable, nextUsable, parseAddress, parsePrefix, placement, rangesOverlap, rangeContains, summarize, utilizationGrid } from "./address";
import { planVlsm } from "./vlsm";

describe("adressage", () => {
  it("calcule un sous-réseau IPv4", () => {
    const parsed = parsePrefix("10.1.10.0/24");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const stats = summarize(parsed.prefix, 3n);
    expect(stats).toMatchObject({
      network: "10.1.10.0",
      netmask: "255.255.255.0",
      prefix: 24,
      firstUsable: "10.1.10.1",
      lastUsable: "10.1.10.254",
      broadcast: "10.1.10.255",
      total: "256",
      usable: "254",
      used: "3",
      available: "251",
    });
    expect(stats.utilization).toBeCloseTo(1.18, 2);
  });

  it("refuse un préfixe qui n'est pas l'adresse réseau", () => {
    expect(parsePrefix("10.1.10.5/24")).toEqual({ ok: false, reason: "HOST_BITS" });
  });

  it("traite un /31 sans broadcast et un /32 comme une seule adresse", () => {
    const pointToPoint = parsePrefix("10.0.0.0/31");
    const host = parsePrefix("10.0.0.8/32");
    expect(pointToPoint.ok && pointToPoint.prefix.usable === 2n && pointToPoint.prefix.broadcast === null).toBe(true);
    expect(host.ok && host.prefix.usable === 1n && host.prefix.firstUsable === "10.0.0.8").toBe(true);
  });

  it("calcule un préfixe IPv6", () => {
    const parsed = parsePrefix("fd00:10::/48");
    const child = parsePrefix("fd00:10:0:10::/64");
    expect(parsed.ok && child.ok).toBe(true);
    if (!parsed.ok || !child.ok) return;
    expect(rangeContains(parsed.prefix, child.prefix)).toBe(true);
    expect(child.prefix.network).toBe("fd00:10:0:10::");
    expect(child.prefix.firstUsable).toBe("fd00:10:0:10::1");
    expect(child.prefix.broadcast).toBeNull();
    expect(utilizationGrid(child.prefix, new Map())).toBeNull();
  });

  it("détecte un chevauchement et une adresse hors sous-réseau", () => {
    const left = parsePrefix("10.1.10.0/24");
    const right = parsePrefix("10.1.10.128/25");
    const outside = parseAddress("10.9.9.9");
    expect(left.ok && right.ok && outside).toBeTruthy();
    if (!left.ok || !right.ok || !outside) return;
    expect(rangesOverlap(left.prefix, right.prefix)).toBe(true);
    expect(placement(left.prefix, outside)).toBe("OUTSIDE");
    expect(isUsable(left.prefix, parseAddress("10.1.10.0")!)).toBe(false);
    expect(placement(left.prefix, parseAddress("10.1.10.255")!)).toBe("BROADCAST");
  });

  it("propose la prochaine adresse libre", () => {
    const prefix = parsePrefix("10.1.10.0/24");
    expect(prefix.ok).toBe(true);
    if (!prefix.ok) return;
    const gateway = parseAddress("10.1.10.1")!;
    expect(nextUsable(prefix.prefix, [gateway.value])?.toString()).toBe(parseAddress("10.1.10.2")!.value.toString());
  });

  it("découpe en VLSM et signale une allocation impossible", () => {
    const plan = planVlsm("10.1.0.0/24", [
      { name: "Utilisateurs", hosts: 50 },
      { name: "Voix", hosts: 20 },
      { name: "Serveurs", hosts: 10 },
    ]);
    expect(plan.feasible).toBe(true);
    expect(plan.subnets.map((subnet) => subnet.cidr)).toEqual(["10.1.0.0/26", "10.1.0.64/27", "10.1.0.96/28"]);
    const impossible = planVlsm("10.1.0.0/24", [
      { name: "A", hosts: 100 },
      { name: "B", hosts: 100 },
      { name: "C", hosts: 100 },
    ]);
    expect(impossible.feasible).toBe(false);
    expect(impossible.message).toContain("Allocation impossible");
  });

  it("dessine la grille d'un petit sous-réseau", () => {
    const prefix = parsePrefix("10.0.0.0/29");
    expect(prefix.ok).toBe(true);
    if (!prefix.ok) return;
    const grid = utilizationGrid(prefix.prefix, new Map([["10.0.0.1", "gateway"]]));
    expect(grid?.map((cell) => cell.kind)).toEqual(["network", "gateway", "free", "free", "free", "free", "free", "broadcast"]);
  });
});
