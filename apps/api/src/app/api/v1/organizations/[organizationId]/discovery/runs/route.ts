import { requireUser } from "@/server/auth/context";
import { createDiscoveryRun } from "@/server/services/discovery";
import { json, readJson, route } from "@/server/http";
import { createDiscoveryRunSchema } from "@/server/validation/discovery";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await createDiscoveryRun(user, organizationId, await readJson(request, createDiscoveryRunSchema)), 201);
});
