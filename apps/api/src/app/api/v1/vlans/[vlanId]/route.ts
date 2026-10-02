import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteVlan, getVlanFabric, updateVlan } from "@/server/services/switching";
import { updateVlanSchema } from "@/server/validation/switching";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ vlanId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { vlanId } = await (context as Context).params;
  return json(await getVlanFabric(user, vlanId));
});

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { vlanId } = await (context as Context).params;
  const input = await readJson(request, updateVlanSchema);
  return json(await updateVlan(user, vlanId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { vlanId } = await (context as Context).params;
  return json(await deleteVlan(user, vlanId));
});
