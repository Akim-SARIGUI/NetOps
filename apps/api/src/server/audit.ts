import type { Prisma } from "../../generated/prisma/client";
import type { AuthUser } from "./auth/context";
import { prisma } from "./prisma";

type AuditInput = {
  actor: AuthUser;
  organizationId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export async function recordAudit(input: AuditInput) {
  await prisma.auditEvent.create({
    data: {
      actorId: input.actor.id,
      organizationId: input.organizationId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata,
    },
  });
}
