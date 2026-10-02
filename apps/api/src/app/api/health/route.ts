import { prisma } from "@/server/prisma";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await prisma.$queryRaw`SELECT 1`;
  return json({ status: "ok", service: "netops-api", database: "ok" });
});
