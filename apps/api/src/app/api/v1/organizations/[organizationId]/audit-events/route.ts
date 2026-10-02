import { requireUser } from "@/server/auth/context";
import { json, readSearchParams, route } from "@/server/http";
import { listAuditEvents } from "@/server/services/members";
import { auditQuerySchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const query = readSearchParams(request, auditQuerySchema);
  return json(await listAuditEvents(user, organizationId, query));
});
