import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteOrganization, getOrganization, updateOrganization } from "@/server/services/organizations";
import { updateOrganizationSchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await getOrganization(user, organizationId));
});

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const input = await readJson(request, updateOrganizationSchema);
  return json(await updateOrganization(user, organizationId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await deleteOrganization(user, organizationId));
});
