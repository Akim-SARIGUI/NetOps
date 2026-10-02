import { requireUser } from "@/server/auth/context";
import { deleteDiagnosticSession } from "@/server/services/diagnostics";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sessionId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { sessionId } = await (context as Context).params;
  return json(await deleteDiagnosticSession(user, sessionId));
});
