import { requireUser } from "@/server/auth/context";
import { deleteDiscoveryRun } from "@/server/services/discovery";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ runId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { runId } = await (context as Context).params;
  return json(await deleteDiscoveryRun(user, runId));
});
