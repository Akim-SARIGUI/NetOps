import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createDnsZone } from "@/server/services/dns";
import { createDnsZoneSchema } from "@/server/validation/dns";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const input = await readJson(request, createDnsZoneSchema);
  return json(await createDnsZone(user, organizationId, input), 201);
});
