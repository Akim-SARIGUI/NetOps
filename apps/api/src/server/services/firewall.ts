import { Prisma } from "../../../generated/prisma/client";
import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";
import {
  FIREWALL_NOTICE,
  collectIssues,
  flowMatrix,
  prepareRule,
  type NormalizedRule,
  type PolicyAction,
  type PolicyProtocol,
} from "../firewall/evaluate";
import { blankToNull } from "../validation/network";

type RuleInput = {
  priority: number;
  source: string;
  destination: string;
  protocol?: PolicyProtocol;
  sourcePort?: string | null;
  destinationPort?: string | null;
  action: PolicyAction;
  logging?: boolean;
  enabled?: boolean;
};

function rethrowUnique(error: unknown, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictError(message);
  throw error;
}

async function requireOrganization(user: AuthUser, organizationId: string, permission: "inventory:read" | "inventory:write" | "inventory:delete") {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, permission, "Organisation introuvable");
}

function storedRule(rule: {
  id: string;
  priority: number;
  source: string;
  destination: string;
  protocol: PolicyProtocol;
  sourcePort: string | null;
  destinationPort: string | null;
  action: PolicyAction;
  logging: boolean;
  enabled: boolean;
}): NormalizedRule & { id: string } {
  return {
    id: rule.id,
    priority: rule.priority,
    source: rule.source,
    destination: rule.destination,
    protocol: rule.protocol,
    sourcePort: rule.sourcePort,
    destinationPort: rule.destinationPort,
    action: rule.action,
    logging: rule.logging,
    enabled: rule.enabled,
    signature: `${rule.source}|${rule.destination}|${rule.protocol}|${rule.sourcePort ?? "*"}|${rule.destinationPort ?? "*"}`,
  };
}

function rejectPrepared(prepared: { ok: false; status: 422 | 409; message: string }): never {
  if (prepared.status === 409) throw new ConflictError(prepared.message);
  throw new ValidationError([{ path: "priority", message: prepared.message }]);
}

export async function firewallOverview(user: AuthUser, organizationId: string, query: { siteId?: string }) {
  await requireOrganization(user, organizationId, "inventory:read");
  const [zones, flows, acls, vlans] = await Promise.all([
    prisma.firewallZone.findMany({
      where: { organizationId },
      include: { vlans: { include: { vlan: { select: { id: true, vid: true, name: true, siteId: true } } } } },
      orderBy: { name: "asc" },
    }),
    prisma.flowRule.findMany({ where: { organizationId }, orderBy: { priority: "asc" } }),
    prisma.acl.findMany({
      where: { organizationId, ...(query.siteId ? { OR: [{ deviceId: null }, { device: { siteId: query.siteId } }] } : {}) },
      include: { device: { select: { id: true, hostname: true, siteId: true } }, rules: { orderBy: { priority: "asc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.vlan.findMany({
      where: { site: { organizationId }, siteId: query.siteId },
      include: { zoneMembership: { include: { zone: { select: { name: true } } } } },
      orderBy: { vid: "asc" },
    }),
  ]);
  const flowIssues = collectIssues(flows.map(storedRule));
  const annotatedFlows = flows.map((rule) => ({ ...rule, issues: flowIssues.filter((issue) => issue.ruleId === rule.id).map(({ code, message }) => ({ code, message })) }));
  const annotatedAcls = acls.map((acl) => {
    const issues = collectIssues(acl.rules.map(storedRule));
    return {
      id: acl.id,
      name: acl.name,
      description: acl.description,
      status: acl.status,
      device: acl.device,
      rules: acl.rules.map((rule) => ({ ...rule, issues: issues.filter((issue) => issue.ruleId === rule.id).map(({ code, message }) => ({ code, message })) })),
    };
  });
  const matrixVlans = vlans.map((vlan) => ({ id: vlan.id, vid: vlan.vid, name: vlan.name, zone: vlan.zoneMembership?.zone.name ?? null }));
  const alerts = annotatedFlows.reduce((sum, rule) => sum + rule.issues.length, 0) + annotatedAcls.reduce((sum, acl) => sum + acl.rules.reduce((inner, rule) => inner + rule.issues.length, 0), 0);
  return {
    mode: "PLANNED" as const,
    notice: FIREWALL_NOTICE,
    organizationId,
    totals: { zones: zones.length, flows: flows.length, acls: acls.length, alerts },
    zones: zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      description: zone.description,
      vlans: zone.vlans.map((link) => link.vlan).filter((vlan) => !query.siteId || vlan.siteId === query.siteId),
    })),
    flows: annotatedFlows,
    acls: annotatedAcls,
    matrix: flowMatrix(matrixVlans, flows.map(storedRule)),
  };
}

export async function createFirewallZone(user: AuthUser, organizationId: string, input: { name: string; description?: string | null; vlanIds?: string[] }) {
  await requireOrganization(user, organizationId, "inventory:write");
  const name = input.name.trim().toUpperCase();
  const vlanIds = [...new Set(input.vlanIds ?? [])];
  try {
    const zone = await prisma.$transaction(async (tx) => {
      const created = await tx.firewallZone.create({
        data: { organizationId, name, description: blankToNull(input.description) ?? null },
      });
      for (const vlanId of vlanIds) {
        const vlan = await tx.vlan.findUnique({ where: { id: vlanId }, include: { site: { select: { organizationId: true } }, zoneMembership: { include: { zone: { select: { name: true } } } } } });
        if (!vlan || vlan.site.organizationId !== organizationId) throw new NotFoundError("VLAN introuvable");
        if (vlan.zoneMembership) throw new ConflictError(`Ce VLAN est déjà dans la zone ${vlan.zoneMembership.zone.name}`);
        await tx.firewallZoneVlan.create({ data: { zoneId: created.id, vlanId } });
      }
      return created;
    });
    await recordAudit({ actor: user, organizationId, action: "firewall.zone.create", resourceType: "FirewallZone", resourceId: zone.id, metadata: { name, mode: "PLANNED" } });
    return { ...zone, mode: "PLANNED" as const, notice: FIREWALL_NOTICE };
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ConflictError) throw error;
    rethrowUnique(error, "Cette zone de sécurité existe déjà");
  }
}

export async function deleteFirewallZone(user: AuthUser, zoneId: string) {
  const zone = await prisma.firewallZone.findUnique({ where: { id: zoneId } });
  if (!zone) throw new NotFoundError("Zone de sécurité introuvable");
  assertPermission(user, zone.organizationId, "inventory:delete", "Zone de sécurité introuvable");
  const [flows, rules] = await Promise.all([
    prisma.flowRule.count({ where: { organizationId: zone.organizationId, OR: [{ source: zone.name }, { destination: zone.name }] } }),
    prisma.aclRule.count({ where: { acl: { organizationId: zone.organizationId }, OR: [{ source: zone.name }, { destination: zone.name }] } }),
  ]);
  if (flows > 0 || rules > 0) throw new ConflictError("Cette zone est utilisée par une règle. Retirez la règle avant de supprimer la zone.");
  await recordAudit({ actor: user, organizationId: zone.organizationId, action: "firewall.zone.delete", resourceType: "FirewallZone", resourceId: zone.id, metadata: { name: zone.name } });
  await prisma.firewallZone.delete({ where: { id: zone.id } });
  return { ok: true };
}

export async function createFlowRule(user: AuthUser, organizationId: string, input: RuleInput) {
  await requireOrganization(user, organizationId, "inventory:write");
  const [zones, existing] = await Promise.all([
    prisma.firewallZone.findMany({ where: { organizationId }, select: { name: true } }),
    prisma.flowRule.findMany({ where: { organizationId } }),
  ]);
  const prepared = prepareRule(input, { mode: "flow", zones: zones.map((zone) => zone.name), existing: existing.map(storedRule) });
  if (!prepared.ok) rejectPrepared(prepared);
  try {
    const { signature: _signature, ...data } = prepared.rule;
    const rule = await prisma.flowRule.create({ data: { organizationId, ...data } });
    await recordAudit({ actor: user, organizationId, action: "firewall.flow.create", resourceType: "FlowRule", resourceId: rule.id, metadata: { source: rule.source, destination: rule.destination, action: rule.action, priority: rule.priority, mode: "PLANNED" } });
    const issues = collectIssues([...existing.map(storedRule), storedRule(rule)]).filter((issue) => issue.ruleId === rule.id).map(({ code, message }) => ({ code, message }));
    return { ...rule, mode: "PLANNED" as const, notice: FIREWALL_NOTICE, issues };
  } catch (error) {
    rethrowUnique(error, "Cette priorité est déjà utilisée");
  }
}

export async function deleteFlowRule(user: AuthUser, flowId: string) {
  const current = await prisma.flowRule.findUnique({ where: { id: flowId } });
  if (!current) throw new NotFoundError("Règle de flux introuvable");
  assertPermission(user, current.organizationId, "inventory:delete", "Règle de flux introuvable");
  await recordAudit({ actor: user, organizationId: current.organizationId, action: "firewall.flow.delete", resourceType: "FlowRule", resourceId: current.id, metadata: { source: current.source, destination: current.destination, priority: current.priority } });
  await prisma.flowRule.delete({ where: { id: current.id } });
  return { ok: true };
}

export async function createAcl(user: AuthUser, organizationId: string, input: { name: string; deviceId?: string; description?: string | null }) {
  await requireOrganization(user, organizationId, "inventory:write");
  let deviceId: string | null = null;
  if (input.deviceId) {
    const device = await prisma.device.findFirst({ where: { id: input.deviceId, organizationId }, select: { id: true, role: true } });
    if (!device) throw new NotFoundError("Équipement introuvable");
    if (device.role !== "FIREWALL") throw new ValidationError([{ path: "deviceId", message: "L'ACL se rattache à un pare-feu de l'inventaire" }]);
    deviceId = device.id;
  }
  try {
    const acl = await prisma.acl.create({
      data: { organizationId, deviceId, name: input.name.trim(), description: blankToNull(input.description) ?? null, status: "PLANNED" },
    });
    await recordAudit({ actor: user, organizationId, action: "firewall.acl.create", resourceType: "Acl", resourceId: acl.id, metadata: { name: acl.name, mode: "PLANNED" } });
    return { ...acl, mode: "PLANNED" as const, notice: FIREWALL_NOTICE };
  } catch (error) {
    rethrowUnique(error, "Cette ACL existe déjà");
  }
}

export async function deleteAcl(user: AuthUser, aclId: string) {
  const current = await prisma.acl.findUnique({ where: { id: aclId } });
  if (!current) throw new NotFoundError("ACL introuvable");
  assertPermission(user, current.organizationId, "inventory:delete", "ACL introuvable");
  await recordAudit({ actor: user, organizationId: current.organizationId, action: "firewall.acl.delete", resourceType: "Acl", resourceId: current.id, metadata: { name: current.name } });
  await prisma.acl.delete({ where: { id: current.id } });
  return { ok: true };
}

export async function createAclRule(user: AuthUser, aclId: string, input: RuleInput) {
  const acl = await prisma.acl.findUnique({ where: { id: aclId }, include: { rules: true } });
  if (!acl) throw new NotFoundError("ACL introuvable");
  assertPermission(user, acl.organizationId, "inventory:write", "ACL introuvable");
  const zones = await prisma.firewallZone.findMany({ where: { organizationId: acl.organizationId }, select: { name: true } });
  const prepared = prepareRule(input, { mode: "acl", zones: zones.map((zone) => zone.name), existing: acl.rules.map(storedRule) });
  if (!prepared.ok) rejectPrepared(prepared);
  try {
    const { signature: _signature, ...data } = prepared.rule;
    const rule = await prisma.aclRule.create({ data: { aclId: acl.id, ...data } });
    await recordAudit({ actor: user, organizationId: acl.organizationId, action: "firewall.rule.create", resourceType: "AclRule", resourceId: rule.id, metadata: { acl: acl.name, source: rule.source, destination: rule.destination, action: rule.action, priority: rule.priority, mode: "PLANNED" } });
    const issues = collectIssues([...acl.rules.map(storedRule), storedRule(rule)]).filter((issue) => issue.ruleId === rule.id).map(({ code, message }) => ({ code, message }));
    return { ...rule, mode: "PLANNED" as const, notice: FIREWALL_NOTICE, issues };
  } catch (error) {
    rethrowUnique(error, "Cette priorité est déjà utilisée dans l'ACL");
  }
}

export async function deleteAclRule(user: AuthUser, ruleId: string) {
  const current = await prisma.aclRule.findUnique({ where: { id: ruleId }, include: { acl: { select: { name: true, organizationId: true } } } });
  if (!current) throw new NotFoundError("Règle d'ACL introuvable");
  assertPermission(user, current.acl.organizationId, "inventory:delete", "Règle d'ACL introuvable");
  await recordAudit({ actor: user, organizationId: current.acl.organizationId, action: "firewall.rule.delete", resourceType: "AclRule", resourceId: current.id, metadata: { acl: current.acl.name, priority: current.priority } });
  await prisma.aclRule.delete({ where: { id: current.id } });
  return { ok: true };
}
