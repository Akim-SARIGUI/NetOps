import { requireUser } from "@/server/auth/context";
import { deleteAutomationTemplate } from "@/server/services/automation";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ templateId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { templateId } = await (context as Context).params;
  return json(await deleteAutomationTemplate(user, templateId));
});
