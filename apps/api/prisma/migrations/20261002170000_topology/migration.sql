-- CreateEnum
CREATE TYPE "TopologyMarkerKind" AS ENUM ('INTERNET');

-- CreateEnum
CREATE TYPE "TopologyLinkStatus" AS ENUM ('UP', 'DOWN', 'ADMIN_DOWN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TopologyOrigin" AS ENUM ('MANUAL', 'SIMULATION');

-- CreateEnum
CREATE TYPE "DiscoveryProtocol" AS ENUM ('LLDP', 'CDP');

-- CreateEnum
CREATE TYPE "DiscoveryStatus" AS ENUM ('PLANNED');

-- CreateTable
CREATE TABLE "topology_placements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topology_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topology_markers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "kind" "TopologyMarkerKind" NOT NULL,
    "label" TEXT NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topology_markers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topology_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source_device_id" UUID,
    "target_device_id" UUID,
    "source_marker_id" UUID,
    "target_marker_id" UUID,
    "source_port" TEXT,
    "target_port" TEXT,
    "speed_mbps" INTEGER,
    "status" "TopologyLinkStatus" NOT NULL DEFAULT 'UNKNOWN',
    "vlan_id" UUID,
    "traffic_bps" INTEGER,
    "origin" "TopologyOrigin" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topology_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topology_discoveries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "protocol" "DiscoveryProtocol" NOT NULL,
    "status" "DiscoveryStatus" NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topology_discoveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "topology_placements_device_id_key" ON "topology_placements"("device_id");

-- CreateIndex
CREATE INDEX "topology_placements_organization_id_idx" ON "topology_placements"("organization_id");

-- CreateIndex
CREATE INDEX "topology_markers_organization_id_idx" ON "topology_markers"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "topology_markers_site_id_kind_key" ON "topology_markers"("site_id", "kind");

-- CreateIndex
CREATE INDEX "topology_links_organization_id_idx" ON "topology_links"("organization_id");

-- CreateIndex
CREATE INDEX "topology_links_source_device_id_idx" ON "topology_links"("source_device_id");

-- CreateIndex
CREATE INDEX "topology_links_target_device_id_idx" ON "topology_links"("target_device_id");

-- CreateIndex
CREATE INDEX "topology_links_vlan_id_idx" ON "topology_links"("vlan_id");

-- CreateIndex
CREATE UNIQUE INDEX "topology_discoveries_organization_id_protocol_key" ON "topology_discoveries"("organization_id", "protocol");

-- AddForeignKey
ALTER TABLE "topology_placements" ADD CONSTRAINT "topology_placements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_placements" ADD CONSTRAINT "topology_placements_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_markers" ADD CONSTRAINT "topology_markers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_markers" ADD CONSTRAINT "topology_markers_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_links" ADD CONSTRAINT "topology_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_links" ADD CONSTRAINT "topology_links_source_device_id_fkey" FOREIGN KEY ("source_device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_links" ADD CONSTRAINT "topology_links_target_device_id_fkey" FOREIGN KEY ("target_device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_links" ADD CONSTRAINT "topology_links_source_marker_id_fkey" FOREIGN KEY ("source_marker_id") REFERENCES "topology_markers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_links" ADD CONSTRAINT "topology_links_target_marker_id_fkey" FOREIGN KEY ("target_marker_id") REFERENCES "topology_markers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_links" ADD CONSTRAINT "topology_links_vlan_id_fkey" FOREIGN KEY ("vlan_id") REFERENCES "vlans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_discoveries" ADD CONSTRAINT "topology_discoveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

