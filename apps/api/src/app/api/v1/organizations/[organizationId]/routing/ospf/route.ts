import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createOspfProcess } from "@/server/services/routing";
import { createOspfSchema } from "@/server/validation/routing";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await createOspfProcess(user, organizationId, await readJson(request, createOspfSchema)), 201);
});
