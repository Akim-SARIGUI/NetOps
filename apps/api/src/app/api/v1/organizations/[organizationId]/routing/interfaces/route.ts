import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createLayer3Interface } from "@/server/services/routing";
import { createLayer3Schema } from "@/server/validation/routing";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await createLayer3Interface(user, organizationId, await readJson(request, createLayer3Schema)), 201);
});
