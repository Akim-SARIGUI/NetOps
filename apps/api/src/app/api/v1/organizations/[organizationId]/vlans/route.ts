import { requireUser } from "@/server/auth/context";
import { json, readJson, readSearchParams, route } from "@/server/http";
import { createVlan, listVlans } from "@/server/services/switching";
import { createVlanSchema, vlanListQuerySchema } from "@/server/validation/switching";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const query = readSearchParams(request, vlanListQuerySchema);
  return json(await listVlans(user, organizationId, query));
});

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const input = await readJson(request, createVlanSchema);
  return json(await createVlan(user, organizationId, input), 201);
});
