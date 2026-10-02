import type { Permission, Session } from "~/types/api";

export function useSession() {
  return useState<Session | null>("netops-session", () => null);
}

export function can(session: Session | null, organizationId: string, permission: Permission) {
  if (!session) return false;
  if (session.user.isSuperAdmin) return true;
  return session.memberships.some(
    (membership) =>
      membership.organization.id === organizationId && membership.permissions.includes(permission),
  );
}

export function canAudit(session: Session | null) {
  if (!session) return false;
  if (session.user.isSuperAdmin) return true;
  return session.memberships.some((membership) => membership.permissions.includes("audit:read"));
}

export function roleLabel(session: Session | null) {
  if (!session) return "";
  if (session.user.isSuperAdmin) return "SUPER_ADMIN";
  return session.memberships.map((membership) => membership.role).join(", ") || "AUCUN RÔLE";
}
