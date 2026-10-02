import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteSubnet, getSubnet, updateSubnet } from "@/server/services/ipam";
import { updateSubnetSchema } from "@/server/validation/ipam";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ subnetId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { subnetId } = await (context as Context).params;
  return json(await getSubnet(user, subnetId));
});

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { subnetId } = await (context as Context).params;
  const input = await readJson(request, updateSubnetSchema);
  return json(await updateSubnet(user, subnetId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { subnetId } = await (context as Context).params;
  return json(await deleteSubnet(user, subnetId));
});
