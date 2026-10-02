import { requireUser } from "@/server/auth/context";
import { NotFoundError } from "@/server/errors";
import { json, readJson, route } from "@/server/http";
import { prisma } from "@/server/prisma";
import { assertPermission } from "@/server/rbac/guard";
import { attachSubnetToVlan } from "@/server/services/ipam";
import { attachVlanSubnetSchema } from "@/server/validation/switching";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ vlanId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { vlanId } = await (context as Context).params;
  const vlan = await prisma.vlan.findUnique({
    where: { id: vlanId },
    include: { site: { select: { organizationId: true } } },
  });
  if (!vlan) throw new NotFoundError("VLAN introuvable");
  assertPermission(user, vlan.site.organizationId, "inventory:write", "VLAN introuvable");
  const input = await readJson(request, attachVlanSubnetSchema);
  return json(await attachSubnetToVlan(user, vlan.site.organizationId, vlan, input), 201);
});
