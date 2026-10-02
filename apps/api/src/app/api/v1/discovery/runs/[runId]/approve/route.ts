import { requireUser } from "@/server/auth/context";
import { approveDiscoveryRun } from "@/server/services/discovery";
import { json, readJson, route } from "@/server/http";
import { approveDiscoverySchema } from "@/server/validation/discovery";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ runId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { runId } = await (context as Context).params;
  return json(await approveDiscoveryRun(user, runId, await readJson(request, approveDiscoverySchema)));
});
