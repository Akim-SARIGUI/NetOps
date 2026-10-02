import { requireUser } from "@/server/auth/context";
import { clientAddress } from "@/server/changes/evaluate";
import { changeOverview, createChangeRequest } from "@/server/services/changes";
import { json, readJson, route } from "@/server/http";
import { createChangeSchema } from "@/server/validation/changes";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await changeOverview(user, organizationId));
});

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const sourceAddress = clientAddress(request.headers.get("x-forwarded-for"));
  return json(await createChangeRequest(user, organizationId, await readJson(request, createChangeSchema), sourceAddress), 201);
});
