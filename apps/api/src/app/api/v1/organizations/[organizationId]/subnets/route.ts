import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createSubnet } from "@/server/services/ipam";
import { createSubnetSchema } from "@/server/validation/ipam";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const input = await readJson(request, createSubnetSchema);
  return json(await createSubnet(user, organizationId, input), 201);
});
