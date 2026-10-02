import { requireUser } from "@/server/auth/context";
import { createAutomationTemplate } from "@/server/services/automation";
import { json, readJson, route } from "@/server/http";
import { createAutomationTemplateSchema } from "@/server/validation/automation";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await createAutomationTemplate(user, organizationId, await readJson(request, createAutomationTemplateSchema)), 201);
});
