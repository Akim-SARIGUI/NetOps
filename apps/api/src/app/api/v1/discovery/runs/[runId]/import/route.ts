import { requireUser } from "@/server/auth/context";
import { importDiscoveryRun } from "@/server/services/discovery";
import { json, readJson, route } from "@/server/http";
import { importDiscoverySchema } from "@/server/validation/discovery";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ runId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { runId } = await (context as Context).params;
  return json(await importDiscoveryRun(user, runId, await readJson(request, importDiscoverySchema)));
});
