import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteDnsZone, getDnsZone, updateDnsZone } from "@/server/services/dns";
import { updateDnsZoneSchema } from "@/server/validation/dns";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ zoneId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { zoneId } = await (context as Context).params;
  return json(await getDnsZone(user, zoneId));
});

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { zoneId } = await (context as Context).params;
  const input = await readJson(request, updateDnsZoneSchema);
  return json(await updateDnsZone(user, zoneId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { zoneId } = await (context as Context).params;
  return json(await deleteDnsZone(user, zoneId));
});
