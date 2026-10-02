import { describe, expect, it } from "vitest";
import { isHostname, isIpAddress, normalizeHostname, normalizeMac } from "./network";

describe("validation réseau", () => {
  it("normalise le nom d'hôte", () => {
    expect(normalizeHostname(" Core-Paris ")).toBe("core-paris");
    expect(isHostname("sw-access-a.paris")).toBe(true);
    expect(isHostname("-mauvais")).toBe(false);
    expect(isHostname("a b")).toBe(false);
  });

  it("accepte IPv4 et IPv6", () => {
    expect(isIpAddress("10.0.0.1")).toBe(true);
    expect(isIpAddress("2001:db8::1")).toBe(true);
    expect(isIpAddress("10.0.0")).toBe(false);
    expect(isIpAddress("pas-une-ip")).toBe(false);
  });

  it("normalise les adresses MAC", () => {
    expect(normalizeMac("AA-BB-CC-DD-EE-FF")).toBe("aa:bb:cc:dd:ee:ff");
    expect(normalizeMac("aa:bb:cc:dd:ee:ff")).toBe("aa:bb:cc:dd:ee:ff");
    expect(normalizeMac("aabbccddeeff")).toBe("aa:bb:cc:dd:ee:ff");
    expect(normalizeMac("zz:bb:cc:dd:ee:ff")).toBe(null);
    expect(normalizeMac("aa:bb")).toBe(null);
  });
});
