-- CreateEnum
CREATE TYPE "PolicyAction" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "PolicyProtocol" AS ENUM ('ANY', 'TCP', 'UDP', 'ICMP');

-- CreateEnum
CREATE TYPE "AclStatus" AS ENUM ('PLANNED', 'ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "firewall_zones" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "firewall_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firewall_zone_vlans" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "vlan_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firewall_zone_vlans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "priority" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "protocol" "PolicyProtocol" NOT NULL DEFAULT 'ANY',
    "source_port" TEXT,
    "destination_port" TEXT,
    "action" "PolicyAction" NOT NULL,
    "logging" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acls" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "device_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "AclStatus" NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acl_rules" (
    "id" UUID NOT NULL,
    "acl_id" UUID NOT NULL,
    "priority" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "protocol" "PolicyProtocol" NOT NULL DEFAULT 'ANY',
    "source_port" TEXT,
    "destination_port" TEXT,
    "action" "PolicyAction" NOT NULL,
    "logging" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acl_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "firewall_zones_organization_id_name_key" ON "firewall_zones"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "firewall_zone_vlans_vlan_id_key" ON "firewall_zone_vlans"("vlan_id");

-- CreateIndex
CREATE INDEX "firewall_zone_vlans_zone_id_idx" ON "firewall_zone_vlans"("zone_id");

-- CreateIndex
CREATE INDEX "flow_rules_organization_id_enabled_idx" ON "flow_rules"("organization_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "flow_rules_organization_id_priority_key" ON "flow_rules"("organization_id", "priority");

-- CreateIndex
CREATE INDEX "acls_device_id_idx" ON "acls"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "acls_organization_id_name_key" ON "acls"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "acl_rules_acl_id_priority_key" ON "acl_rules"("acl_id", "priority");

-- AddForeignKey
ALTER TABLE "firewall_zones" ADD CONSTRAINT "firewall_zones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firewall_zone_vlans" ADD CONSTRAINT "firewall_zone_vlans_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "firewall_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firewall_zone_vlans" ADD CONSTRAINT "firewall_zone_vlans_vlan_id_fkey" FOREIGN KEY ("vlan_id") REFERENCES "vlans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_rules" ADD CONSTRAINT "flow_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acls" ADD CONSTRAINT "acls_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acls" ADD CONSTRAINT "acls_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acl_rules" ADD CONSTRAINT "acl_rules_acl_id_fkey" FOREIGN KEY ("acl_id") REFERENCES "acls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

