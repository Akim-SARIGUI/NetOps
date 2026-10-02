import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteDevice, getDevice, updateDevice } from "@/server/services/inventory";
import { updateDeviceSchema } from "@/server/validation/network";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ deviceId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { deviceId } = await (context as Context).params;
  return json(await getDevice(user, deviceId));
});

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { deviceId } = await (context as Context).params;
  const input = await readJson(request, updateDeviceSchema);
  return json(await updateDevice(user, deviceId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { deviceId } = await (context as Context).params;
  return json(await deleteDevice(user, deviceId));
});
