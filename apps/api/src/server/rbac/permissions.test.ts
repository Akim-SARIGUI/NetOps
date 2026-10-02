import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, userHasPermission, type Permission } from "./permissions";

const ORG = "org-1";

describe("permissions des rôles", () => {
  it("donne tous les droits au super administrateur de plateforme", () => {
    const user = { isSuperAdmin: true, memberships: [] };
    for (const permission of Object.values(ROLE_PERMISSIONS.SUPER_ADMIN)) {
      expect(userHasPermission(user, ORG, permission)).toBe(true);
    }
  });

  it("laisse l'opérateur modifier la hiérarchie sans la supprimer", () => {
    const user = {
      isSuperAdmin: false,
      memberships: [{ organizationId: ORG, role: "NETWORK_OPERATOR" as const }],
    };
    expect(userHasPermission(user, ORG, "hierarchy:write")).toBe(true);
    expect(userHasPermission(user, ORG, "inventory:write")).toBe(true);
    expect(userHasPermission(user, ORG, "inventory:delete")).toBe(false);
    expect(userHasPermission(user, ORG, "hierarchy:delete")).toBe(false);
    expect(userHasPermission(user, ORG, "members:write")).toBe(false);
    expect(userHasPermission(user, ORG, "audit:read")).toBe(false);
  });

  it("autorise l'auditeur à lire la hiérarchie et le journal, pas à écrire", () => {
    const user = {
      isSuperAdmin: false,
      memberships: [{ organizationId: ORG, role: "AUDITOR" as const }],
    };
    expect(userHasPermission(user, ORG, "hierarchy:read")).toBe(true);
    expect(userHasPermission(user, ORG, "audit:read")).toBe(true);
    expect(userHasPermission(user, ORG, "inventory:read")).toBe(true);
    expect(userHasPermission(user, ORG, "inventory:write")).toBe(false);
    expect(userHasPermission(user, ORG, "hierarchy:write")).toBe(false);
  });

  it("limite le lecteur à la consultation", () => {
    const user = {
      isSuperAdmin: false,
      memberships: [{ organizationId: ORG, role: "VIEWER" as const }],
    };
    const allowed = new Set<Permission>(["hierarchy:read", "inventory:read"]);
    for (const permission of ROLE_PERMISSIONS.SUPER_ADMIN) {
      expect(userHasPermission(user, ORG, permission)).toBe(allowed.has(permission));
    }
  });

  it("refuse une organisation dont l'utilisateur n'est pas membre", () => {
    const user = {
      isSuperAdmin: false,
      memberships: [{ organizationId: ORG, role: "NETWORK_ADMIN" as const }],
    };
    expect(userHasPermission(user, "autre-org", "hierarchy:read")).toBe(false);
  });
});
