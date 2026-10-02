-- CreateEnum
CREATE TYPE "DiscoveryConnectorKind" AS ENUM ('SIMULATION', 'ICMP', 'ARP', 'SNMP', 'LLDP', 'CDP', 'SSH');

-- CreateEnum
CREATE TYPE "DiscoveryRunStatus" AS ENUM ('DISCOVERY', 'REVIEW', 'APPROVED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "DiscoveryVerdict" AS ENUM ('DISCOVERED', 'UNKNOWN', 'MATCHED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "DiscoveryDecision" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "discovery_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID,
    "label" TEXT NOT NULL,
    "status" "DiscoveryRunStatus" NOT NULL DEFAULT 'DISCOVERY',
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_probes" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "connector" "DiscoveryConnectorKind" NOT NULL,
    "available" BOOLEAN NOT NULL,
    "message" TEXT NOT NULL,

    CONSTRAINT "discovery_probes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_findings" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "verdict" "DiscoveryVerdict" NOT NULL,
    "decision" "DiscoveryDecision" NOT NULL DEFAULT 'PENDING',
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    "hostname" TEXT,
    "ip_address" TEXT,
    "mac_address" TEXT,
    "role" "DeviceRole",
    "interfaces" JSONB NOT NULL,
    "ports" JSONB NOT NULL,
    "vlans" JSONB NOT NULL,
    "neighbors" JSONB NOT NULL,
    "conflict_reason" TEXT,
    "matched_device_id" UUID,
    "imported_device_id" UUID,

    CONSTRAINT "discovery_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discovery_runs_organization_id_created_at_idx" ON "discovery_runs"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_probes_run_id_connector_key" ON "discovery_probes"("run_id", "connector");

-- CreateIndex
CREATE INDEX "discovery_findings_run_id_position_idx" ON "discovery_findings"("run_id", "position");

-- CreateIndex
CREATE INDEX "discovery_findings_matched_device_id_idx" ON "discovery_findings"("matched_device_id");

-- CreateIndex
CREATE INDEX "discovery_findings_imported_device_id_idx" ON "discovery_findings"("imported_device_id");

-- AddForeignKey
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_probes" ADD CONSTRAINT "discovery_probes_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "discovery_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_findings" ADD CONSTRAINT "discovery_findings_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "discovery_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_findings" ADD CONSTRAINT "discovery_findings_matched_device_id_fkey" FOREIGN KEY ("matched_device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_findings" ADD CONSTRAINT "discovery_findings_imported_device_id_fkey" FOREIGN KEY ("imported_device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

