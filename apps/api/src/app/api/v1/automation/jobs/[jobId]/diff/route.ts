import { requireUser } from "@/server/auth/context";
import { diffAutomationJob } from "@/server/services/automation";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ jobId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { jobId } = await (context as Context).params;
  return json(await diffAutomationJob(user, jobId));
});
