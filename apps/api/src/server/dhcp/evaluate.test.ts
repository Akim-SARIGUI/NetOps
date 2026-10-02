import { describe, expect, it } from "vitest";
import { parsePrefix } from "../ipam/address";
import { describeScope, poolIssue, selectLeaseAddress } from "./evaluate";

const prefix = parsePrefix("192.168.20.0/24");
if (!prefix.ok) throw new Error("préfixe");
const network = prefix.prefix;
const future = new Date("2026-10-03T00:00:00Z");
const past = new Date("2026-10-01T00:00:00Z");

describe("scope DHCP", () => {
  it("accepte le pool de l'exemple et compte les adresses libres", () => {
    const stats = describeScope({
      cidr: "192.168.20.0/24",
      gateway: "192.168.20.1",
      ipamGateway: "192.168.20.1",
      pools: [{ startAddress: "192.168.20.100", endAddress: "192.168.20.200" }],
      exclusions: [],
      reservations: [],
      leases: [],
      now: future,
    });
    expect(stats.issues).toEqual([]);
    expect(stats.capacity).toBe("101");
    expect(stats.available).toBe("101");
  });

  it("signale un pool hors subnet, un chevauchement, une passerelle invalide, un pool épuisé et une réservation en conflit", () => {
    expect(poolIssue(network, [], "192.168.21.10", "192.168.21.20").ok).toBe(false);
    expect(poolIssue(network, [{ startAddress: "192.168.20.100", endAddress: "192.168.20.200" }], "192.168.20.150", "192.168.20.180").ok).toBe(false);
    const stats = describeScope({
      cidr: "192.168.20.0/24",
      gateway: "10.0.0.1",
      ipamGateway: "192.168.20.1",
      pools: [
        { startAddress: "192.168.20.100", endAddress: "192.168.20.100" },
        { startAddress: "192.168.20.100", endAddress: "192.168.20.101" },
      ],
      exclusions: [{ startAddress: "192.168.20.50", endAddress: "192.168.20.50" }],
      reservations: [{ address: "192.168.20.50", macAddress: "00:1a:2b:3c:4d:20" }],
      leases: [
        { address: "192.168.20.100", macAddress: "00:1a:2b:3c:4d:21", state: "ACTIVE", expiresAt: future },
        { address: "192.168.20.101", macAddress: "00:1a:2b:3c:4d:22", state: "ACTIVE", expiresAt: future },
      ],
      now: past,
    });
    expect(stats.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["GATEWAY_INVALID", "POOL_OVERLAP", "RESERVATION_CONFLICT", "POOL_EXHAUSTED"]),
    );
  });

  it("attribue la réservation puis refuse quand le pool est épuisé", () => {
    const reserved = selectLeaseAddress({
      prefix: network,
      gateway: "192.168.20.1",
      pools: [{ startAddress: "192.168.20.100", endAddress: "192.168.20.101" }],
      exclusions: [],
      reservations: [{ address: "192.168.20.40", macAddress: "00:1a:2b:3c:4d:20" }],
      leases: [],
      macAddress: "00:1a:2b:3c:4d:20",
      now: future,
    });
    expect(reserved).toEqual({ ok: true, address: "192.168.20.40" });
    const exhausted = selectLeaseAddress({
      prefix: network,
      gateway: "192.168.20.1",
      pools: [{ startAddress: "192.168.20.100", endAddress: "192.168.20.100" }],
      exclusions: [],
      reservations: [],
      leases: [{ address: "192.168.20.100", macAddress: "00:1a:2b:3c:4d:21", state: "ACTIVE", expiresAt: future }],
      macAddress: "00:1a:2b:3c:4d:22",
      now: past,
    });
    expect(exhausted.ok).toBe(false);
  });
});
