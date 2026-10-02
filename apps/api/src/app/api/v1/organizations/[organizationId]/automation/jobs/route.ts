import { requireUser } from "@/server/auth/context";
import { createAutomationJob } from "@/server/services/automation";
import { json, readJson, route } from "@/server/http";
import { createAutomationJobSchema } from "@/server/validation/automation";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await createAutomationJob(user, organizationId, await readJson(request, createAutomationJobSchema)), 201);
});
