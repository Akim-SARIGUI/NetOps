import { Prisma } from "../../../generated/prisma/client";
import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  LAB_NOTICE,
  PROMOTION_NOTICE,
  environmentsCatalog,
  fabricEnvironmentError,
  nodeCatalog,
  preparePromotionError,
  promoteError,
  renderConfiguration,
  scenarioCatalog,
  validatePromotionError,
  type EnvironmentId,
} from "../lab/evaluate";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";

const fabricInclude = {
  site: { select: { id: true, name: true, code: true, environment: true } },
  nodes: { orderBy: { hostname: "asc" as const } },
  scenarios: { orderBy: { kind: "asc" as const } },
  promotions: {
    orderBy: { createdAt: "desc" as const },
    include: {
      targetSite: { select: { id: true, name: true, code: true, environment: true } },
      sourcePromotion: { select: { id: true, phase: true, targetEnvironment: true } },
    },
  },
} satisfies Prisma.LabFabricInclude;

type FabricRecord = Prisma.LabFabricGetPayload<{ include: typeof fabricInclude }>;

function rethrowUnique(error: unknown, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictError(message);
  throw error;
}

async function requireOrganization(user: AuthUser, organizationId: string, permission: "inventory:read" | "inventory:write" | "inventory:delete") {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, permission, "Organisation introuvable");
}

export async function labOverview(user: AuthUser, organizationId: string) {
  await requireOrganization(user, organizationId, "inventory:read");
  const [fabrics, sites] = await Promise.all([
    prisma.labFabric.findMany({ where: { organizationId }, include: fabricInclude, orderBy: { createdAt: "desc" } }),
    prisma.site.findMany({
      where: { organizationId },
      select: { id: true, name: true, code: true, environment: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    notice: LAB_NOTICE,
    promotionNotice: PROMOTION_NOTICE,
    environments: environmentsCatalog(),
    sites,
    fabrics: fabrics.map(presentFabric),
  };
}

export async function createLabFabric(user: AuthUser, organizationId: string, input: { siteId: string }) {
  await requireOrganization(user, organizationId, "inventory:write");
  const site = await prisma.site.findFirst({
    where: { id: input.siteId, organizationId },
    select: { id: true, environment: true, name: true, code: true },
  });
  if (!site) throw new NotFoundError("Site introuvable");
  const refusal = fabricEnvironmentError(site.environment as EnvironmentId);
  if (refusal) throw new ValidationError({ siteId: [refusal] });
  const existing = await prisma.labFabric.findUnique({ where: { siteId: site.id } });
  if (existing) throw new ConflictError("Ce site LAB a déjà une fabrique isolée.");

  const nodes = nodeCatalog();
  const scenarios = scenarioCatalog();
  try {
    const fabric = await prisma.labFabric.create({
      data: {
        organizationId,
        siteId: site.id,
        nodes: { create: nodes },
        scenarios: { create: scenarios },
      },
      include: fabricInclude,
    });
    await recordAudit({
      actor: user,
      organizationId,
      action: "lab.create",
      resourceType: "LabFabric",
      resourceId: fabric.id,
      metadata: { siteId: site.id, environment: site.environment },
    });
    return presentFabric(fabric);
  } catch (error) {
    rethrowUnique(error, "Cette fabrique LAB existe déjà");
  }
}

export async function preparePromotion(
  user: AuthUser,
  fabricId: string,
  input: { targetSiteId: string; sourcePromotionId?: string },
) {
  const fabric = await prisma.labFabric.findUnique({
    where: { id: fabricId },
    include: {
      site: { select: { id: true, environment: true } },
      nodes: true,
      scenarios: true,
    },
  });
  if (!fabric) throw new NotFoundError("Fabrique LAB introuvable");
  assertPermission(user, fabric.organizationId, "inventory:write", "Fabrique LAB introuvable");

  const target = await prisma.site.findFirst({
    where: { id: input.targetSiteId, organizationId: fabric.organizationId },
    select: { id: true, environment: true, name: true, code: true },
  });
  if (!target) throw new NotFoundError("Site cible introuvable");
  if (target.id === fabric.siteId) throw new ValidationError({ targetSiteId: ["Le site cible doit être distinct du LAB."] });

  let sourcePromotion: { id: string; phase: "PREPARED" | "VALIDATED" | "PROMOTED"; targetEnvironment: EnvironmentId; fabricId: string } | null = null;
  if (input.sourcePromotionId) {
    const found = await prisma.labPromotion.findFirst({
      where: { id: input.sourcePromotionId, organizationId: fabric.organizationId },
      select: { id: true, phase: true, targetEnvironment: true, fabricId: true },
    });
    if (!found) throw new NotFoundError("Promotion source introuvable");
    if (found.fabricId !== fabric.id) throw new ValidationError({ sourcePromotionId: ["La promotion source doit appartenir à cette fabrique."] });
    sourcePromotion = {
      id: found.id,
      phase: found.phase,
      targetEnvironment: found.targetEnvironment as EnvironmentId,
      fabricId: found.fabricId,
    };
  }

  const refusal = preparePromotionError({
    fabricEnvironment: fabric.site.environment as EnvironmentId,
    targetEnvironment: target.environment as EnvironmentId,
    sourcePromotion,
    scenariosReady: fabric.scenarios.length > 0 && fabric.scenarios.every((item) => item.ready),
  });
  if (refusal) throw new ValidationError({ targetSiteId: [refusal] });

  const sourceEnvironment = (sourcePromotion ? sourcePromotion.targetEnvironment : "LAB") as EnvironmentId;
  const configuration = renderConfiguration(
    fabric.nodes.map((node) => ({ role: node.role, hostname: node.hostname, address: node.address })),
    fabric.scenarios.map((item) => ({
      kind: item.kind,
      label: item.label,
      ready: item.ready,
      plan: item.plan,
      observation: item.observation,
    })),
  );

  try {
    const promotion = await prisma.labPromotion.create({
      data: {
        organizationId: fabric.organizationId,
        fabricId: fabric.id,
        actorId: user.id,
        sourcePromotionId: sourcePromotion?.id ?? null,
        sourceEnvironment,
        targetEnvironment: target.environment,
        targetSiteId: target.id,
        phase: "PREPARED",
        configuration,
        applied: false,
        pushed: false,
        confirmProduction: false,
      },
    });
    await recordAudit({
      actor: user,
      organizationId: fabric.organizationId,
      action: "lab.promotion.prepare",
      resourceType: "LabPromotion",
      resourceId: promotion.id,
      metadata: { fabricId: fabric.id, sourceEnvironment, targetEnvironment: target.environment, targetSiteId: target.id },
    });
    return presentPromotion(await loadPromotion(promotion.id));
  } catch (error) {
    rethrowUnique(error, "Cette promotion existe déjà");
  }
}

export async function validatePromotion(user: AuthUser, promotionId: string) {
  const current = await prisma.labPromotion.findUnique({
    where: { id: promotionId },
    select: { id: true, organizationId: true, phase: true, fabricId: true },
  });
  if (!current) throw new NotFoundError("Promotion introuvable");
  assertPermission(user, current.organizationId, "inventory:write", "Promotion introuvable");
  const refusal = validatePromotionError(current.phase);
  if (refusal) throw new ValidationError({ phase: [refusal] });
  await prisma.labPromotion.update({
    where: { id: current.id },
    data: { phase: "VALIDATED", validatedAt: new Date() },
  });
  await recordAudit({
    actor: user,
    organizationId: current.organizationId,
    action: "lab.promotion.validate",
    resourceType: "LabPromotion",
    resourceId: current.id,
    metadata: { fabricId: current.fabricId },
  });
  return presentPromotion(await loadPromotion(current.id));
}

export async function promoteLab(user: AuthUser, promotionId: string, input: { confirmProduction?: boolean }) {
  const current = await prisma.labPromotion.findUnique({
    where: { id: promotionId },
    select: { id: true, organizationId: true, phase: true, targetEnvironment: true, fabricId: true },
  });
  if (!current) throw new NotFoundError("Promotion introuvable");
  assertPermission(user, current.organizationId, "inventory:write", "Promotion introuvable");
  const confirmProduction = Boolean(input.confirmProduction);
  const refusal = promoteError({
    phase: current.phase,
    targetEnvironment: current.targetEnvironment as EnvironmentId,
    confirmProduction,
  });
  if (refusal) throw new ValidationError({ confirmProduction: [refusal] });
  await prisma.labPromotion.update({
    where: { id: current.id },
    data: {
      phase: "PROMOTED",
      promotedAt: new Date(),
      confirmProduction,
      applied: false,
      pushed: false,
    },
  });
  await recordAudit({
    actor: user,
    organizationId: current.organizationId,
    action: "lab.promotion.promote",
    resourceType: "LabPromotion",
    resourceId: current.id,
    metadata: {
      fabricId: current.fabricId,
      targetEnvironment: current.targetEnvironment,
      applied: false,
      pushed: false,
      confirmProduction,
    },
  });
  return presentPromotion(await loadPromotion(current.id));
}

export async function deleteLabFabric(user: AuthUser, fabricId: string) {
  const current = await prisma.labFabric.findUnique({
    where: { id: fabricId },
    select: { id: true, organizationId: true, siteId: true, _count: { select: { promotions: true } } },
  });
  if (!current) throw new NotFoundError("Fabrique LAB introuvable");
  assertPermission(user, current.organizationId, "inventory:delete", "Fabrique LAB introuvable");
  if (current._count.promotions > 0) {
    throw new ConflictError("Cette fabrique a une promotion. Retirez-la avant de supprimer la fabrique.");
  }
  await prisma.labFabric.delete({ where: { id: fabricId } });
  await recordAudit({
    actor: user,
    organizationId: current.organizationId,
    action: "lab.delete",
    resourceType: "LabFabric",
    resourceId: current.id,
    metadata: { siteId: current.siteId },
  });
  return { ok: true };
}

export async function deletePromotion(user: AuthUser, promotionId: string) {
  const current = await prisma.labPromotion.findUnique({
    where: { id: promotionId },
    include: { followUp: { select: { id: true } } },
  });
  if (!current) throw new NotFoundError("Promotion introuvable");
  assertPermission(user, current.organizationId, "inventory:delete", "Promotion introuvable");
  if (current.followUp) {
    throw new ConflictError("Cette promotion a une suite. Retirez la promotion suivante d'abord.");
  }
  await prisma.labPromotion.delete({ where: { id: promotionId } });
  await recordAudit({
    actor: user,
    organizationId: current.organizationId,
    action: "lab.promotion.delete",
    resourceType: "LabPromotion",
    resourceId: current.id,
    metadata: { fabricId: current.fabricId, phase: current.phase },
  });
  return { ok: true };
}

async function loadPromotion(id: string) {
  return prisma.labPromotion.findUniqueOrThrow({
    where: { id },
    include: {
      targetSite: { select: { id: true, name: true, code: true, environment: true } },
      sourcePromotion: { select: { id: true, phase: true, targetEnvironment: true } },
      fabric: { select: { id: true, site: { select: { id: true, name: true, code: true, environment: true } } } },
    },
  });
}

function presentFabric(fabric: FabricRecord) {
  return {
    id: fabric.id,
    notice: LAB_NOTICE,
    createdAt: fabric.createdAt.toISOString(),
    site: fabric.site,
    nodes: fabric.nodes.map((node) => ({
      id: node.id,
      role: node.role,
      hostname: node.hostname,
      address: node.address,
    })),
    scenarios: fabric.scenarios.map((item) => ({
      id: item.id,
      kind: item.kind,
      label: item.label,
      ready: item.ready,
      plan: item.plan,
      observation: item.observation,
    })),
    promotions: fabric.promotions.map((item) => ({
      id: item.id,
      sourceEnvironment: item.sourceEnvironment,
      targetEnvironment: item.targetEnvironment,
      phase: item.phase,
      applied: item.applied,
      pushed: item.pushed,
      confirmProduction: item.confirmProduction,
      validatedAt: item.validatedAt?.toISOString() ?? null,
      promotedAt: item.promotedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      targetSite: item.targetSite,
      sourcePromotion: item.sourcePromotion,
      configuration: item.configuration,
      notice: PROMOTION_NOTICE,
    })),
  };
}

function presentPromotion(promotion: Awaited<ReturnType<typeof loadPromotion>>) {
  return {
    id: promotion.id,
    notice: PROMOTION_NOTICE,
    sourceEnvironment: promotion.sourceEnvironment,
    targetEnvironment: promotion.targetEnvironment,
    phase: promotion.phase,
    applied: promotion.applied,
    pushed: promotion.pushed,
    confirmProduction: promotion.confirmProduction,
    configuration: promotion.configuration,
    validatedAt: promotion.validatedAt?.toISOString() ?? null,
    promotedAt: promotion.promotedAt?.toISOString() ?? null,
    createdAt: promotion.createdAt.toISOString(),
    targetSite: promotion.targetSite,
    sourcePromotion: promotion.sourcePromotion,
    fabric: { id: promotion.fabric.id, site: promotion.fabric.site },
  };
}
