import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { resolveDnsName } from "@/server/services/dns";
import { resolveDnsSchema } from "@/server/validation/dns";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ zoneId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { zoneId } = await (context as Context).params;
  const input = await readJson(request, resolveDnsSchema);
  return json(await resolveDnsName(user, zoneId, input));
});
