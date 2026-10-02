import { requireUser } from "@/server/auth/context";
import { diagnosticOverview, createGuide } from "@/server/services/diagnostics";
import { json, readJson, readSearchParams, route } from "@/server/http";
import { diagnosticQuerySchema, guideSchema } from "@/server/validation/diagnostics";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await diagnosticOverview(user, organizationId, readSearchParams(request, diagnosticQuerySchema)));
});

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await createGuide(user, organizationId, await readJson(request, guideSchema)), 201);
});
