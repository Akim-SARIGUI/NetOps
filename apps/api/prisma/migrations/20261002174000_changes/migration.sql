-- CreateEnum
CREATE TYPE "ChangePhase" AS ENUM ('OPEN', 'BACKED_UP', 'DEPLOYED', 'VERIFIED', 'FAILED', 'ROLLED_BACK', 'ROLLBACK_VERIFIED', 'INCIDENT');

-- CreateEnum
CREATE TYPE "ChangeResult" AS ENUM ('RECORDED', 'STORED', 'FAILED', 'VERIFIED', 'ROLLED_BACK', 'INCIDENT');

-- CreateEnum
CREATE TYPE "ConfigOrigin" AS ENUM ('BACKUP', 'CHANGE', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "DeploymentKind" AS ENUM ('CHANGE', 'ROLLBACK');

-- CreateTable
CREATE TABLE "change_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "important" BOOLEAN NOT NULL DEFAULT true,
    "integration" "AutomationIntegration" NOT NULL,
    "phase" "ChangePhase" NOT NULL DEFAULT 'OPEN',
    "proposed_content" TEXT NOT NULL,
    "diff_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "change_request_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "origin" "ConfigOrigin" NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_backups" (
    "id" UUID NOT NULL,
    "change_request_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "device_read" BOOLEAN NOT NULL DEFAULT false,
    "notice" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_backups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_deployments" (
    "id" UUID NOT NULL,
    "change_request_id" UUID NOT NULL,
    "kind" "DeploymentKind" NOT NULL,
    "from_version_id" UUID,
    "to_version_id" UUID,
    "result" "ChangeResult" NOT NULL,
    "pushed" BOOLEAN NOT NULL DEFAULT false,
    "report" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_incidents" (
    "id" UUID NOT NULL,
    "change_request_id" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "change_request_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "old_config" TEXT NOT NULL DEFAULT '',
    "new_config" TEXT NOT NULL DEFAULT '',
    "result" "ChangeResult" NOT NULL,
    "source_address" TEXT NOT NULL,

    CONSTRAINT "change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "change_requests_organization_id_created_at_idx" ON "change_requests"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "change_requests_device_id_idx" ON "change_requests"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "change_requests_organization_id_title_key" ON "change_requests"("organization_id", "title");

-- CreateIndex
CREATE INDEX "config_versions_change_request_id_idx" ON "config_versions"("change_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "config_versions_device_id_number_key" ON "config_versions"("device_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "config_backups_change_request_id_key" ON "config_backups"("change_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "config_backups_version_id_key" ON "config_backups"("version_id");

-- CreateIndex
CREATE INDEX "change_deployments_change_request_id_idx" ON "change_deployments"("change_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "change_incidents_change_request_id_key" ON "change_incidents"("change_request_id");

-- CreateIndex
CREATE INDEX "change_logs_change_request_id_occurred_at_idx" ON "change_logs"("change_request_id", "occurred_at");

-- CreateIndex
CREATE INDEX "change_logs_device_id_idx" ON "change_logs"("device_id");

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_versions" ADD CONSTRAINT "config_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_versions" ADD CONSTRAINT "config_versions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_versions" ADD CONSTRAINT "config_versions_change_request_id_fkey" FOREIGN KEY ("change_request_id") REFERENCES "change_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_backups" ADD CONSTRAINT "config_backups_change_request_id_fkey" FOREIGN KEY ("change_request_id") REFERENCES "change_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_backups" ADD CONSTRAINT "config_backups_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "config_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_deployments" ADD CONSTRAINT "change_deployments_change_request_id_fkey" FOREIGN KEY ("change_request_id") REFERENCES "change_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_deployments" ADD CONSTRAINT "change_deployments_from_version_id_fkey" FOREIGN KEY ("from_version_id") REFERENCES "config_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_deployments" ADD CONSTRAINT "change_deployments_to_version_id_fkey" FOREIGN KEY ("to_version_id") REFERENCES "config_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_incidents" ADD CONSTRAINT "change_incidents_change_request_id_fkey" FOREIGN KEY ("change_request_id") REFERENCES "change_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_logs" ADD CONSTRAINT "change_logs_change_request_id_fkey" FOREIGN KEY ("change_request_id") REFERENCES "change_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_logs" ADD CONSTRAINT "change_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_logs" ADD CONSTRAINT "change_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_logs" ADD CONSTRAINT "change_logs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

