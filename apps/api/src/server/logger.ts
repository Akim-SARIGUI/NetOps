import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "netops-api" },
  redact: ["req.headers.authorization", "password", "passwordHash", "token"],
});
