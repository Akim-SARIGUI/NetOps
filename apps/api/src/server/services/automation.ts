import { Prisma } from "../../../generated/prisma/client";
import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import {
  AUTOMATION_NOTICE,
  INTEGRATION_NOTICE,
  backupReport,
  buildDiff,
  decideApproval,
  deploymentAllowed,
  dryRunReport,
  evaluateCritical,
  executionPlan,
  integrationCatalog,
  kindIsCritical,
  placeholders,
  renderTemplate,
  stageError,
  verificationPlan,
  type Authorization,
  type IntegrationId,
  type Stage,
  type TemplateKind,
} from "../automation/evaluate";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESERVED = new Set(["hostname", "managementIp", "role", "managementInterface", "label"]);

const jobInclude = {
  device: { select: { id: true, hostname: true, status: true } },
  template: { select: { id: true, name: true, kind: true, critical: true, body: true } },
} satisfies Prisma.AutomationJobInclude;

type JobRecord = Prisma.AutomationJobGetPayload<{ include: typeof jobInclude }>;

function rethrowUnique(error: unknown, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictError(message);
  throw error;
}

async function requireOrganization(user: AuthUser, organizationId: string, permission: "inventory:read" | "inventory:write" | "inventory:delete") {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, permission, "Organisation introuvable");
}

function asRecord(value: Prisma.JsonValue): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => (typeof item === "string" ? [[key, item]] : [])));
}

function present(job: JobRecord) {
  return {
    id: job.id,
    label: job.label,
    integration: job.integration,
    stage: job.stage,
    critical: job.critical,
    changed: job.changed,
    authorization: job.authorization,
    pushed: job.pushed,
    stored: job.stored,
    verified: job.verified,
    deviceQueried: job.deviceQueried,
    desiredState: asRecord(job.desiredState),
    variables: asRecord(job.variables),
    generatedConfig: job.generatedConfig,
    diffText: job.diffText,
    dryRunReport: job.dryRunReport,
    backupReport: job.backupReport,
    executionReport: job.executionReport,
    verificationReport: job.verificationReport,
    device: job.device,
    template: { id: job.template.id, name: job.template.name, kind: job.template.kind, critical: job.template.critical },
    notice: AUTOMATION_NOTICE,
  };
}

async function loadJob(jobId: string) {
  if (!UUID.test(jobId)) throw new NotFoundError("Travail introuvable");
  const job = await prisma.automationJob.findUnique({ where: { id: jobId }, include: jobInclude });
  if (!job) throw new NotFoundError("Travail introuvable");
  return job;
}

async function policyFor(organizationId: string) {
  return prisma.automationPolicy.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId, automaticCritical: false },
  });
}

function facts(job: JobRecord) {
  return { ...asRecord(job.desiredState), ...asRecord(job.variables) };
}

function assertStage(job: JobRecord, target: Exclude<Stage, "DESIRED">) {
  const message = stageError(job.stage, target);
  if (message) throw new ValidationError([{ path: "stage", message }]);
}

export async function automationOverview(user: AuthUser, organizationId: string) {
  await requireOrganization(user, organizationId, "inventory:read");
  const [policy, templates, jobs] = await Promise.all([
    policyFor(organizationId),
    prisma.automationTemplate.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    prisma.automationJob.findMany({ where: { organizationId }, include: jobInclude, orderBy: { createdAt: "desc" } }),
  ]);
  return {
    notice: AUTOMATION_NOTICE,
    integrationNotice: INTEGRATION_NOTICE,
    organizationId,
    integrations: integrationCatalog(),
    policy: { automaticCritical: policy.automaticCritical },
    templates: templates.map((template) => ({
      id: template.id,
      name: template.name,
      kind: template.kind,
      body: template.body,
      critical: template.critical,
      enabled: template.enabled,
    })),
    jobs: jobs.map(present),
  };
}

export async function updateAutomationPolicy(user: AuthUser, organizationId: string, input: { automaticCritical: boolean }) {
  await requireOrganization(user, organizationId, "inventory:write");
  const policy = await prisma.automationPolicy.upsert({
    where: { organizationId },
    update: { automaticCritical: input.automaticCritical },
    create: { organizationId, automaticCritical: input.automaticCritical },
  });
  await recordAudit({
    actor: user,
    organizationId,
    action: "automation.policy.update",
    resourceType: "AutomationPolicy",
    resourceId: policy.id,
    metadata: { automaticCritical: policy.automaticCritical },
  });
  return { automaticCritical: policy.automaticCritical, notice: AUTOMATION_NOTICE };
}

export async function createAutomationTemplate(user: AuthUser, organizationId: string, input: { name: string; kind: TemplateKind; body: string }) {
  await requireOrganization(user, organizationId, "inventory:write");
  const parsed = placeholders(input.body);
  if (!parsed.ok) throw new ValidationError([{ path: "body", message: parsed.message }]);
  try {
    const template = await prisma.automationTemplate.create({
      data: {
        organizationId,
        name: input.name.trim(),
        kind: input.kind,
        body: input.body.trim(),
        critical: kindIsCritical(input.kind),
      },
    });
    await recordAudit({
      actor: user,
      organizationId,
      action: "automation.template.create",
      resourceType: "AutomationTemplate",
      resourceId: template.id,
      metadata: { name: template.name, kind: template.kind, critical: template.critical },
    });
    return template;
  } catch (error) {
    rethrowUnique(error, "Ce modèle existe déjà");
  }
}

export async function deleteAutomationTemplate(user: AuthUser, templateId: string) {
  if (!UUID.test(templateId)) throw new NotFoundError("Modèle introuvable");
  const current = await prisma.automationTemplate.findUnique({ where: { id: templateId }, include: { _count: { select: { jobs: true } } } });
  if (!current) throw new NotFoundError("Modèle introuvable");
  assertPermission(user, current.organizationId, "inventory:delete", "Modèle introuvable");
  if (current._count.jobs > 0) throw new ConflictError("Ce modèle est utilisé par un travail. Retirez le travail avant de supprimer le modèle.");
  await recordAudit({ actor: user, organizationId: current.organizationId, action: "automation.template.delete", resourceType: "AutomationTemplate", resourceId: current.id, metadata: { name: current.name } });
  await prisma.automationTemplate.delete({ where: { id: current.id } });
  return { ok: true };
}

export async function createAutomationJob(
  user: AuthUser,
  organizationId: string,
  input: { deviceId: string; templateId: string; integration: IntegrationId; label?: string; variables?: Record<string, string> },
) {
  await requireOrganization(user, organizationId, "inventory:write");
  const [device, template] = await Promise.all([
    prisma.device.findFirst({
      where: { id: input.deviceId, organizationId },
      include: { interfaces: { orderBy: { name: "asc" }, select: { name: true }, take: 1 } },
    }),
    prisma.automationTemplate.findFirst({ where: { id: input.templateId, organizationId } }),
  ]);
  if (!device) throw new NotFoundError("Équipement introuvable");
  if (!template) throw new NotFoundError("Modèle introuvable");
  if (!template.enabled) throw new ValidationError([{ path: "templateId", message: "Ce modèle est désactivé." }]);
  const variables = Object.fromEntries(Object.entries(input.variables ?? {}).filter(([key]) => !RESERVED.has(key)));
  const label = input.label?.trim() || template.name;
  const desiredState = {
    hostname: device.hostname,
    managementIp: device.managementIp ?? "",
    role: device.role,
    managementInterface: device.interfaces[0]?.name ?? "",
    label,
  };
  const job = await prisma.automationJob.create({
    data: {
      organizationId,
      deviceId: device.id,
      templateId: template.id,
      label,
      integration: input.integration,
      stage: "DESIRED",
      desiredState,
      variables,
    },
    include: jobInclude,
  });
  await recordAudit({
    actor: user,
    organizationId,
    action: "automation.job.create",
    resourceType: "AutomationJob",
    resourceId: job.id,
    metadata: { label, integration: input.integration, template: template.name },
  });
  return present(job);
}

export async function validateAutomationJob(user: AuthUser, jobId: string) {
  const job = await loadJob(jobId);
  assertPermission(user, job.organizationId, "inventory:write", "Travail introuvable");
  assertStage(job, "VALIDATION");
  const rendered = renderTemplate(job.template.body, facts(job));
  if (!rendered.ok) throw new ValidationError([{ path: "desiredState", message: rendered.message }]);
  return advance(user, job, "VALIDATION", {});
}

export async function generateAutomationJob(user: AuthUser, jobId: string) {
  const job = await loadJob(jobId);
  assertPermission(user, job.organizationId, "inventory:write", "Travail introuvable");
  assertStage(job, "GENERATE");
  const rendered = renderTemplate(job.template.body, facts(job));
  if (!rendered.ok) throw new ValidationError([{ path: "template", message: rendered.message }]);
  return advance(user, job, "GENERATE", { generatedConfig: rendered.config });
}

export async function diffAutomationJob(user: AuthUser, jobId: string) {
  const job = await loadJob(jobId);
  assertPermission(user, job.organizationId, "inventory:write", "Travail introuvable");
  assertStage(job, "DIFF");
  if (!job.generatedConfig) throw new ValidationError([{ path: "generatedConfig", message: "La configuration n'a pas été générée." }]);
  const previous = await prisma.automationJob.findFirst({
    where: { deviceId: job.deviceId, stored: true, id: { not: job.id } },
    orderBy: { updatedAt: "desc" },
    select: { generatedConfig: true },
  });
  const diff = buildDiff(previous?.generatedConfig ?? "", job.generatedConfig);
  return advance(user, job, "DIFF", {
    diffText: diff.text,
    changed: diff.changed,
    critical: evaluateCritical(job.template.critical, diff.changed),
  });
}

export async function dryRunAutomationJob(user: AuthUser, jobId: string) {
  const job = await loadJob(jobId);
  assertPermission(user, job.organizationId, "inventory:write", "Travail introuvable");
  assertStage(job, "DRY_RUN");
  return advance(user, job, "DRY_RUN", { dryRunReport: dryRunReport(job.integration, job.changed) });
}

export async function approveAutomationJob(user: AuthUser, jobId: string, input: { authorize?: boolean }) {
  const job = await loadJob(jobId);
  assertPermission(user, job.organizationId, "inventory:write", "Travail introuvable");
  assertStage(job, "APPROVAL");
  const policy = await policyFor(job.organizationId);
  const decision = decideApproval({ critical: job.critical, authorize: input.authorize === true, automaticCritical: policy.automaticCritical });
  if (!decision.ok) throw new ValidationError([{ path: "authorize", message: decision.message }]);
  return advance(user, job, "APPROVAL", { authorization: decision.authorization });
}

export async function backupAutomationJob(user: AuthUser, jobId: string) {
  const job = await loadJob(jobId);
  assertPermission(user, job.organizationId, "inventory:write", "Travail introuvable");
  assertStage(job, "BACKUP");
  const previous = await prisma.automationJob.findFirst({
    where: { deviceId: job.deviceId, stored: true, id: { not: job.id } },
    orderBy: { updatedAt: "desc" },
    select: { generatedConfig: true },
  });
  return advance(user, job, "BACKUP", { backupReport: backupReport(previous?.generatedConfig ?? "") });
}

export async function deployAutomationJob(user: AuthUser, jobId: string) {
  const job = await loadJob(jobId);
  assertPermission(user, job.organizationId, "inventory:write", "Travail introuvable");
  assertStage(job, "DEPLOYMENT");
  if (!deploymentAllowed(job.critical, job.authorization)) {
    throw new ValidationError([{ path: "authorization", message: "Une modification critique exige une autorisation explicite ou une politique d'automatisation." }]);
  }
  const plan = executionPlan(job.integration);
  return advance(user, job, "DEPLOYMENT", {
    executionReport: plan.report,
    pushed: false,
    stored: plan.stored,
    deviceQueried: false,
  });
}

export async function verifyAutomationJob(user: AuthUser, jobId: string) {
  const job = await loadJob(jobId);
  assertPermission(user, job.organizationId, "inventory:write", "Travail introuvable");
  assertStage(job, "VERIFICATION");
  const plan = verificationPlan({ stored: job.stored, generated: job.generatedConfig, integration: job.integration });
  return advance(user, job, "VERIFICATION", {
    verificationReport: plan.report,
    verified: plan.verified,
    deviceQueried: false,
    pushed: false,
  });
}

export async function deleteAutomationJob(user: AuthUser, jobId: string) {
  const job = await loadJob(jobId);
  assertPermission(user, job.organizationId, "inventory:delete", "Travail introuvable");
  await recordAudit({ actor: user, organizationId: job.organizationId, action: "automation.job.delete", resourceType: "AutomationJob", resourceId: job.id, metadata: { label: job.label } });
  await prisma.automationJob.delete({ where: { id: job.id } });
  return { ok: true };
}

async function advance(user: AuthUser, job: JobRecord, stage: Exclude<Stage, "DESIRED">, data: Prisma.AutomationJobUpdateInput) {
  const updated = await prisma.automationJob.update({ where: { id: job.id }, data: { ...data, stage }, include: jobInclude });
  await recordAudit({
    actor: user,
    organizationId: job.organizationId,
    action: "automation.job.advance",
    resourceType: "AutomationJob",
    resourceId: job.id,
    metadata: { stage, authorization: (data.authorization as Authorization | undefined) ?? job.authorization, pushed: false },
  });
  return present(updated);
}
