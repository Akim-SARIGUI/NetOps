import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createOrganization, listOrganizations } from "@/server/services/organizations";
import { createOrganizationSchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const user = await requireUser(request);
  return json(await listOrganizations(user));
});

export const POST = route(async (request) => {
  const user = await requireUser(request);
  const input = await readJson(request, createOrganizationSchema);
  return json(await createOrganization(user, input), 201);
});
