import { login } from "@/server/auth/login";
import { json, readJson, route } from "@/server/http";
import { loginSchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const input = await readJson(request, loginSchema);
  return json(await login(input.email, input.password));
});
