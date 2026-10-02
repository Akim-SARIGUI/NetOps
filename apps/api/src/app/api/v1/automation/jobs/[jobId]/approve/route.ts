import { requireUser } from "@/server/auth/context";
import { approveAutomationJob } from "@/server/services/automation";
import { json, readJson, route } from "@/server/http";
import { approveAutomationSchema } from "@/server/validation/automation";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ jobId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { jobId } = await (context as Context).params;
  return json(await approveAutomationJob(user, jobId, await readJson(request, approveAutomationSchema)));
});
