-- CreateEnum
CREATE TYPE "CollectorMode" AS ENUM ('SIMULATION', 'ICMP', 'SNMP');

-- CreateEnum
CREATE TYPE "MetricKind" AS ENUM ('AVAILABILITY', 'CPU', 'RAM', 'INTERFACE', 'TRAFFIC', 'LATENCY', 'PACKET_LOSS', 'UPTIME', 'ERRORS');

-- CreateEnum
CREATE TYPE "MetricOrigin" AS ENUM ('SIMULATION', 'INVENTORY', 'MEASURED');

-- CreateTable
CREATE TABLE "monitoring_targets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "mode" "CollectorMode" NOT NULL DEFAULT 'SIMULATION',
    "packet_loss_threshold" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitoring_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_samples" (
    "id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "kind" "MetricKind" NOT NULL,
    "interface_name" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "origin" "MetricOrigin" NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "monitoring_targets_device_id_key" ON "monitoring_targets"("device_id");

-- CreateIndex
CREATE INDEX "monitoring_targets_organization_id_idx" ON "monitoring_targets"("organization_id");

-- CreateIndex
CREATE INDEX "metric_samples_target_id_kind_observed_at_idx" ON "metric_samples"("target_id", "kind", "observed_at");

-- AddForeignKey
ALTER TABLE "monitoring_targets" ADD CONSTRAINT "monitoring_targets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoring_targets" ADD CONSTRAINT "monitoring_targets_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_samples" ADD CONSTRAINT "metric_samples_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "monitoring_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

