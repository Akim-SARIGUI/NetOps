import { Prisma } from "../../../generated/prisma/client";
import type { IntegrationId } from "../automation/evaluate";
import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import {
  BACKUP_NOTICE,
  CHANGE_NOTICE,
  INCIDENT_SUMMARY,
  baseline,
  configurationDiff,
  deploymentOutcome,
  gate,
  verifyStored,
  type ChangeAction,
  type Phase,
} from "../changes/evaluate";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const requestInclude = {
  device: { select: { id: true, hostname: true } },
  backup: { include: { version: true } },
  versions: { orderBy: { number: "asc" as const } },
  deployments: { orderBy: { createdAt: "asc" as const } },
  incident: true,
  logs: {
    orderBy: { occurredAt: "asc" as const },
    include: {
      actor: { select: { id: true, name: true } },
      device: { select: { id: true, hostname: true } },
    },
  },
} satisfies Prisma.ChangeRequestInclude;

type RequestRecord = Prisma.ChangeRequestGetPayload<{ include: typeof requestInclude }>;

function rethrowUnique(error: unknown, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictError(message);
  throw error;
}

async function requireOrganization(user: AuthUser, organizationId: string, permission: "inventory:read" | "inventory:write" | "inventory:delete") {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, permission, "Organisation introuvable");
}

function present(request: RequestRecord) {
  return {
    id: request.id,
    title: request.title,
    important: request.important,
    integration: request.integration,
    phase: request.phase,
    proposedContent: request.proposedContent,
    diffText: request.diffText,
    createdAt: request.createdAt.toISOString(),
    device: request.device,
    notice: CHANGE_NOTICE,
    backup: request.backup
      ? {
          id: request.backup.id,
          deviceRead: request.backup.deviceRead,
          notice: request.backup.notice,
          createdAt: request.backup.createdAt.toISOString(),
          version: { id: request.backup.version.id, number: request.backup.version.number, content: request.backup.version.content, origin: request.backup.version.origin },
        }
      : null,
    versions: request.versions.map((version) => ({
      id: version.id,
      number: version.number,
      origin: version.origin,
      content: version.content,
      simulated: version.simulated,
      createdAt: version.createdAt.toISOString(),
    })),
    deployments: request.deployments.map((deployment) => ({
      id: deployment.id,
      kind: deployment.kind,
      result: deployment.result,
      pushed: deployment.pushed,
      report: deployment.report,
      createdAt: deployment.createdAt.toISOString(),
    })),
    incident: request.incident ? { id: request.incident.id, summary: request.incident.summary, createdAt: request.incident.createdAt.toISOString() } : null,
    logs: request.logs.map((entry) => ({
      id: entry.id,
      action: entry.action,
      occurredAt: entry.occurredAt.toISOString(),
      actor: entry.actor,
      device: entry.device,
      oldConfig: entry.oldConfig,
      newConfig: entry.newConfig,
      result: entry.result,
      sourceAddress: entry.sourceAddress,
    })),
  };
}

async function loadRequest(id: string) {
  if (!UUID.test(id)) throw new NotFoundError("Demande de changement introuvable");
  const request = await prisma.changeRequest.findUnique({ where: { id }, include: requestInclude });
  if (!request) throw new NotFoundError("Demande de changement introuvable");
  return request;
}

function assertGate(current: Phase, action: ChangeAction) {
  const message = gate(current, action);
  if (message) throw new ValidationError([{ path: "phase", message }]);
}

async function nextNumber(tx: Prisma.TransactionClient, deviceId: string) {
  const count = await tx.configVersion.count({ where: { deviceId } });
  return count + 1;
}

async function trace(
  tx: Prisma.TransactionClient,
  input: {
    user: AuthUser;
    request: { id: string; organizationId: string; deviceId: string };
    action: string;
    oldConfig: string;
    newConfig: string;
    result: "RECORDED" | "STORED" | "FAILED" | "VERIFIED" | "ROLLED_BACK" | "INCIDENT";
    sourceAddress: string;
  },
) {
  await tx.changeLog.create({
    data: {
      organizationId: input.request.organizationId,
      changeRequestId: input.request.id,
      actorId: input.user.id,
      deviceId: input.request.deviceId,
      action: input.action,
      oldConfig: input.oldConfig,
      newConfig: input.newConfig,
      result: input.result,
      sourceAddress: input.sourceAddress,
    },
  });
}

async function audit(user: AuthUser, request: { id: string; organizationId: string; deviceId: string }, action: string, result: string, sourceAddress: string) {
  await recordAudit({
    actor: user,
    organizationId: request.organizationId,
    action,
    resourceType: "ChangeRequest",
    resourceId: request.id,
    metadata: { deviceId: request.deviceId, result, sourceAddress },
  });
}

export async function changeOverview(user: AuthUser, organizationId: string) {
  await requireOrganization(user, organizationId, "inventory:read");
  const requests = await prisma.changeRequest.findMany({
    where: { organizationId },
    include: requestInclude,
    orderBy: { createdAt: "desc" },
  });
  return { notice: CHANGE_NOTICE, organizationId, requests: requests.map(present) };
}

export async function createChangeRequest(
  user: AuthUser,
  organizationId: string,
  input: { deviceId: string; title: string; integration: IntegrationId; proposedContent: string },
  sourceAddress: string,
) {
  await requireOrganization(user, organizationId, "inventory:write");
  const device = await prisma.device.findFirst({ where: { id: input.deviceId, organizationId }, select: { id: true } });
  if (!device) throw new NotFoundError("Équipement introuvable");
  const previous = await prisma.configVersion.findFirst({ where: { deviceId: device.id }, orderBy: { number: "desc" }, select: { content: true } });
  try {
    const request = await prisma.$transaction(async (tx) => {
      const created = await tx.changeRequest.create({
        data: {
          organizationId,
          deviceId: device.id,
          title: input.title.trim(),
          important: true,
          integration: input.integration,
          phase: "OPEN",
          proposedContent: input.proposedContent.trim(),
        },
      });
      await trace(tx, {
        user,
        request: created,
        action: "request",
        oldConfig: previous?.content ?? "",
        newConfig: created.proposedContent,
        result: "RECORDED",
        sourceAddress,
      });
      return tx.changeRequest.findUniqueOrThrow({ where: { id: created.id }, include: requestInclude });
    });
    await audit(user, request, "change.request", "RECORDED", sourceAddress);
    return present(request);
  } catch (error) {
    rethrowUnique(error, "Cette demande existe déjà");
  }
}

export async function backupChange(user: AuthUser, requestId: string, sourceAddress: string) {
  const current = await loadRequest(requestId);
  assertPermission(user, current.organizationId, "inventory:write", "Demande de changement introuvable");
  assertGate(current.phase, "backup");
  const previous = await prisma.configVersion.findFirst({
    where: { deviceId: current.deviceId, changeRequestId: { not: current.id } },
    orderBy: { number: "desc" },
    select: { content: true },
  });
  const content = baseline(previous?.content ?? "");
  const request = await prisma.$transaction(async (tx) => {
    const version = await tx.configVersion.create({
      data: {
        organizationId: current.organizationId,
        deviceId: current.deviceId,
        changeRequestId: current.id,
        number: await nextNumber(tx, current.deviceId),
        content,
        origin: "BACKUP",
        simulated: true,
      },
    });
    await tx.configBackup.create({ data: { changeRequestId: current.id, versionId: version.id, deviceRead: false, notice: BACKUP_NOTICE } });
    await trace(tx, { user, request: current, action: "backup", oldConfig: previous?.content ?? "", newConfig: content, result: "STORED", sourceAddress });
    return tx.changeRequest.update({
      where: { id: current.id },
      data: { phase: "BACKED_UP", diffText: configurationDiff(content, current.proposedContent) },
      include: requestInclude,
    });
  });
  await audit(user, current, "change.backup", "STORED", sourceAddress);
  return present(request);
}

export async function deployChange(user: AuthUser, requestId: string, sourceAddress: string) {
  const current = await loadRequest(requestId);
  assertPermission(user, current.organizationId, "inventory:write", "Demande de changement introuvable");
  assertGate(current.phase, "deploy");
  if (!current.backup) throw new ValidationError([{ path: "backup", message: "Le changement exige une sauvegarde préalable." }]);
  const outcome = deploymentOutcome(current.integration);
  const oldConfig = current.backup.version.content;
  const request = await prisma.$transaction(async (tx) => {
    let toVersionId: string | null = null;
    if (outcome.phase === "DEPLOYED") {
      const version = await tx.configVersion.create({
        data: {
          organizationId: current.organizationId,
          deviceId: current.deviceId,
          changeRequestId: current.id,
          number: await nextNumber(tx, current.deviceId),
          content: current.proposedContent,
          origin: "CHANGE",
          simulated: true,
        },
      });
      toVersionId = version.id;
    }
    await tx.changeDeployment.create({
      data: {
        changeRequestId: current.id,
        kind: "CHANGE",
        fromVersionId: current.backup!.versionId,
        toVersionId,
        result: outcome.result,
        pushed: false,
        report: outcome.report,
      },
    });
    await trace(tx, { user, request: current, action: "deployment", oldConfig, newConfig: current.proposedContent, result: outcome.result, sourceAddress });
    return tx.changeRequest.update({ where: { id: current.id }, data: { phase: outcome.phase }, include: requestInclude });
  });
  await audit(user, current, "change.deployment", outcome.result, sourceAddress);
  return present(request);
}

export async function verifyChange(user: AuthUser, requestId: string, sourceAddress: string) {
  const current = await loadRequest(requestId);
  assertPermission(user, current.organizationId, "inventory:write", "Demande de changement introuvable");
  assertGate(current.phase, "verify");
  const applied = current.versions.find((version) => version.origin === "CHANGE");
  const check = verifyStored(applied?.content ?? "", current.proposedContent);
  if (!check.ok) throw new ValidationError([{ path: "verification", message: check.report }]);
  const request = await prisma.$transaction(async (tx) => {
    await trace(tx, {
      user,
      request: current,
      action: "verification",
      oldConfig: current.backup?.version.content ?? "",
      newConfig: current.proposedContent,
      result: "VERIFIED",
      sourceAddress,
    });
    return tx.changeRequest.update({ where: { id: current.id }, data: { phase: "VERIFIED" }, include: requestInclude });
  });
  await audit(user, current, "change.verification", "VERIFIED", sourceAddress);
  return present(request);
}

export async function rollbackChange(user: AuthUser, requestId: string, sourceAddress: string) {
  const current = await loadRequest(requestId);
  assertPermission(user, current.organizationId, "inventory:write", "Demande de changement introuvable");
  assertGate(current.phase, "rollback");
  if (!current.backup) throw new ValidationError([{ path: "backup", message: "Le rollback exige la sauvegarde du changement." }]);
  const restored = current.backup.version.content;
  const request = await prisma.$transaction(async (tx) => {
    const version = await tx.configVersion.create({
      data: {
        organizationId: current.organizationId,
        deviceId: current.deviceId,
        changeRequestId: current.id,
        number: await nextNumber(tx, current.deviceId),
        content: restored,
        origin: "ROLLBACK",
        simulated: true,
      },
    });
    await tx.changeDeployment.create({
      data: {
        changeRequestId: current.id,
        kind: "ROLLBACK",
        fromVersionId: current.backup!.versionId,
        toVersionId: version.id,
        result: "ROLLED_BACK",
        pushed: false,
        report: "Rollback local vers la sauvegarde. Aucune configuration n'est envoyée à l'équipement.",
      },
    });
    await trace(tx, { user, request: current, action: "rollback", oldConfig: current.proposedContent, newConfig: restored, result: "ROLLED_BACK", sourceAddress });
    return tx.changeRequest.update({ where: { id: current.id }, data: { phase: "ROLLED_BACK" }, include: requestInclude });
  });
  await audit(user, current, "change.rollback", "ROLLED_BACK", sourceAddress);
  return present(request);
}

export async function verifyRollback(user: AuthUser, requestId: string, sourceAddress: string) {
  const current = await loadRequest(requestId);
  assertPermission(user, current.organizationId, "inventory:write", "Demande de changement introuvable");
  assertGate(current.phase, "verifyRollback");
  const restored = [...current.versions].reverse().find((version) => version.origin === "ROLLBACK");
  const check = verifyStored(restored?.content ?? "", current.backup?.version.content ?? "");
  if (!check.ok) throw new ValidationError([{ path: "verification", message: check.report }]);
  const request = await prisma.$transaction(async (tx) => {
    await trace(tx, {
      user,
      request: current,
      action: "rollback-verification",
      oldConfig: current.proposedContent,
      newConfig: current.backup?.version.content ?? "",
      result: "VERIFIED",
      sourceAddress,
    });
    return tx.changeRequest.update({ where: { id: current.id }, data: { phase: "ROLLBACK_VERIFIED" }, include: requestInclude });
  });
  await audit(user, current, "change.rollback-verification", "VERIFIED", sourceAddress);
  return present(request);
}

export async function openIncident(user: AuthUser, requestId: string, sourceAddress: string) {
  const current = await loadRequest(requestId);
  assertPermission(user, current.organizationId, "inventory:write", "Demande de changement introuvable");
  assertGate(current.phase, "incident");
  const request = await prisma.$transaction(async (tx) => {
    await tx.changeIncident.create({ data: { changeRequestId: current.id, summary: INCIDENT_SUMMARY } });
    await trace(tx, {
      user,
      request: current,
      action: "incident",
      oldConfig: current.proposedContent,
      newConfig: current.backup?.version.content ?? "",
      result: "INCIDENT",
      sourceAddress,
    });
    return tx.changeRequest.update({ where: { id: current.id }, data: { phase: "INCIDENT" }, include: requestInclude });
  });
  await audit(user, current, "change.incident", "INCIDENT", sourceAddress);
  return present(request);
}

export async function deleteChangeRequest(user: AuthUser, requestId: string, sourceAddress: string) {
  const current = await loadRequest(requestId);
  assertPermission(user, current.organizationId, "inventory:delete", "Demande de changement introuvable");
  await audit(user, current, "change.delete", current.phase, sourceAddress);
  await prisma.changeRequest.delete({ where: { id: current.id } });
  return { ok: true };
}
