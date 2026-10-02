import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteInterface, getInterface, updateInterface } from "@/server/services/inventory";
import { updateInterfaceSchema } from "@/server/validation/network";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ interfaceId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { interfaceId } = await (context as Context).params;
  return json(await getInterface(user, interfaceId));
});

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { interfaceId } = await (context as Context).params;
  const input = await readJson(request, updateInterfaceSchema);
  return json(await updateInterface(user, interfaceId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { interfaceId } = await (context as Context).params;
  return json(await deleteInterface(user, interfaceId));
});
