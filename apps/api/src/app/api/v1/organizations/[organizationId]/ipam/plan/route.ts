import { requireUser } from "@/server/auth/context";
import { NotFoundError } from "@/server/errors";
import { json, readJson, route } from "@/server/http";
import { prisma } from "@/server/prisma";
import { assertPermission } from "@/server/rbac/guard";
import { calculateVlsm } from "@/server/services/ipam";
import { vlsmSchema } from "@/server/validation/ipam";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, "inventory:read", "Organisation introuvable");
  const input = await readJson(request, vlsmSchema);
  return json(calculateVlsm(input));
});
