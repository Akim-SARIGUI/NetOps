import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createDnsServer } from "@/server/services/dns";
import { createDnsServerSchema } from "@/server/validation/dns";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const input = await readJson(request, createDnsServerSchema);
  return json(await createDnsServer(user, organizationId, input), 201);
});
