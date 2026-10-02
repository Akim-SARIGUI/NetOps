import { requireUser } from "@/server/auth/context";
import { createProbe } from "@/server/services/diagnostics";
import { json, readJson, route } from "@/server/http";
import { probeSchema } from "@/server/validation/diagnostics";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await createProbe(user, organizationId, await readJson(request, probeSchema)), 201);
});
