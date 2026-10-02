import { requireUser } from "@/server/auth/context";
import { json, readJson, readSearchParams, route } from "@/server/http";
import { createDevice, listDevices } from "@/server/services/inventory";
import { createDeviceSchema, deviceListQuerySchema } from "@/server/validation/network";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const query = readSearchParams(request, deviceListQuerySchema);
  return json(await listDevices(user, organizationId, query));
});

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const input = await readJson(request, createDeviceSchema);
  return json(await createDevice(user, organizationId, input), 201);
});
