-- CreateEnum
CREATE TYPE "AutomationKind" AS ENUM ('BANNER', 'INTERFACE', 'VLAN', 'ROUTING', 'FIREWALL');

-- CreateEnum
CREATE TYPE "AutomationIntegration" AS ENUM ('SIMULATION', 'SSH', 'ANSIBLE', 'VENDOR_API', 'SNMP');

-- CreateEnum
CREATE TYPE "AutomationStage" AS ENUM ('DESIRED', 'VALIDATION', 'GENERATE', 'DIFF', 'DRY_RUN', 'APPROVAL', 'BACKUP', 'DEPLOYMENT', 'VERIFICATION');

-- CreateEnum
CREATE TYPE "AutomationAuthorization" AS ENUM ('NONE', 'EXPLICIT', 'POLICY', 'WORKFLOW');

-- CreateTable
CREATE TABLE "automation_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "automatic_critical" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AutomationKind" NOT NULL,
    "body" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "integration" "AutomationIntegration" NOT NULL,
    "stage" "AutomationStage" NOT NULL DEFAULT 'DESIRED',
    "desired_state" JSONB NOT NULL,
    "variables" JSONB NOT NULL,
    "generated_config" TEXT,
    "diff_text" TEXT,
    "changed" BOOLEAN NOT NULL DEFAULT false,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "authorization" "AutomationAuthorization" NOT NULL DEFAULT 'NONE',
    "dry_run_report" TEXT,
    "backup_report" TEXT,
    "execution_report" TEXT,
    "verification_report" TEXT,
    "pushed" BOOLEAN NOT NULL DEFAULT false,
    "stored" BOOLEAN NOT NULL DEFAULT false,
    "verified" BOOLEAN,
    "device_queried" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automation_policies_organization_id_key" ON "automation_policies"("organization_id");

-- CreateIndex
CREATE INDEX "automation_templates_organization_id_idx" ON "automation_templates"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_templates_organization_id_name_key" ON "automation_templates"("organization_id", "name");

-- CreateIndex
CREATE INDEX "automation_jobs_organization_id_created_at_idx" ON "automation_jobs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "automation_jobs_device_id_idx" ON "automation_jobs"("device_id");

-- AddForeignKey
ALTER TABLE "automation_policies" ADD CONSTRAINT "automation_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_templates" ADD CONSTRAINT "automation_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_jobs" ADD CONSTRAINT "automation_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_jobs" ADD CONSTRAINT "automation_jobs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_jobs" ADD CONSTRAINT "automation_jobs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "automation_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

