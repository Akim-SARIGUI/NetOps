import { requireUser } from "@/server/auth/context";
import { exportDocumentation } from "@/server/services/documentation";
import { json, readSearchParams, route } from "@/server/http";
import { documentationExportSchema } from "@/server/validation/documentation";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await exportDocumentation(user, organizationId, readSearchParams(request, documentationExportSchema)));
});
