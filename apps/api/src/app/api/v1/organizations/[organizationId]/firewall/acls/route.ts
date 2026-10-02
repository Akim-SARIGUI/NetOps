import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createAcl } from "@/server/services/firewall";
import { createAclSchema } from "@/server/validation/firewall";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await createAcl(user, organizationId, await readJson(request, createAclSchema)), 201);
});
