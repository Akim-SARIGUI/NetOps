-- CreateEnum
CREATE TYPE "DiagnosticTool" AS ENUM ('GUIDE', 'PING', 'TRACEROUTE', 'DNS', 'TCP', 'ARP', 'ROUTE', 'HTTP', 'PORT');

-- CreateEnum
CREATE TYPE "DiagnosticMode" AS ENUM ('INVENTORY', 'LIVE');

-- CreateTable
CREATE TABLE "diagnostic_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "tool" "DiagnosticTool" NOT NULL,
    "mode" "DiagnosticMode" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnostic_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnostic_checks" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "step" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "fact" TEXT NOT NULL,
    "observation" TEXT NOT NULL,
    "possible_cause" TEXT NOT NULL,
    "recommended_check" TEXT NOT NULL,

    CONSTRAINT "diagnostic_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "diagnostic_sessions_organization_id_created_at_idx" ON "diagnostic_sessions"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "diagnostic_sessions_device_id_idx" ON "diagnostic_sessions"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "diagnostic_checks_session_id_rank_key" ON "diagnostic_checks"("session_id", "rank");

-- AddForeignKey
ALTER TABLE "diagnostic_sessions" ADD CONSTRAINT "diagnostic_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_sessions" ADD CONSTRAINT "diagnostic_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_sessions" ADD CONSTRAINT "diagnostic_sessions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_checks" ADD CONSTRAINT "diagnostic_checks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "diagnostic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
