import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deletePort, updatePort } from "@/server/services/switching";
import { updatePortSchema } from "@/server/validation/switching";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ portId: string }> };

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { portId } = await (context as Context).params;
  const input = await readJson(request, updatePortSchema);
  return json(await updatePort(user, portId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { portId } = await (context as Context).params;
  return json(await deletePort(user, portId));
});
