import { requireUser } from "@/server/auth/context";
import { clientAddress } from "@/server/changes/evaluate";
import { openIncident } from "@/server/services/changes";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ changeId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { changeId } = await (context as Context).params;
  return json(await openIncident(user, changeId, clientAddress(request.headers.get("x-forwarded-for"))));
});