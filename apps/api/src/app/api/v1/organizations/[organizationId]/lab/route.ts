import { requireUser } from "@/server/auth/context";
import { createLabFabric, labOverview } from "@/server/services/lab";
import { json, readJson, route } from "@/server/http";
import { createLabSchema } from "@/server/validation/lab";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await labOverview(user, organizationId));
});

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await createLabFabric(user, organizationId, await readJson(request, createLabSchema)), 201);
});
