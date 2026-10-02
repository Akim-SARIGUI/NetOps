-- CreateEnum
CREATE TYPE "DnsServerStatus" AS ENUM ('PLANNED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DnsZoneKind" AS ENUM ('FORWARD', 'REVERSE');

-- CreateEnum
CREATE TYPE "DnsRecordType" AS ENUM ('A', 'AAAA', 'CNAME', 'MX', 'NS', 'PTR', 'TXT', 'SRV');

-- CreateTable
CREATE TABLE "dns_servers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "device_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT,
    "status" "DnsServerStatus" NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dns_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dns_zones" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "subnet_id" UUID,
    "kind" "DnsZoneKind" NOT NULL,
    "name" TEXT NOT NULL,
    "ttl" INTEGER NOT NULL DEFAULT 3600,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dns_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dns_records" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DnsRecordType" NOT NULL,
    "ttl" INTEGER,
    "rdata" TEXT NOT NULL,
    "priority" INTEGER,
    "weight" INTEGER,
    "port" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dns_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dns_changes" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dns_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dns_servers_organization_id_idx" ON "dns_servers"("organization_id");

-- CreateIndex
CREATE INDEX "dns_servers_device_id_idx" ON "dns_servers"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "dns_servers_site_id_name_key" ON "dns_servers"("site_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "dns_zones_subnet_id_key" ON "dns_zones"("subnet_id");

-- CreateIndex
CREATE INDEX "dns_zones_server_id_idx" ON "dns_zones"("server_id");

-- CreateIndex
CREATE UNIQUE INDEX "dns_zones_organization_id_name_key" ON "dns_zones"("organization_id", "name");

-- CreateIndex
CREATE INDEX "dns_records_zone_id_name_idx" ON "dns_records"("zone_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "dns_records_zone_id_name_type_rdata_key" ON "dns_records"("zone_id", "name", "type", "rdata");

-- CreateIndex
CREATE INDEX "dns_changes_zone_id_created_at_idx" ON "dns_changes"("zone_id", "created_at");

-- AddForeignKey
ALTER TABLE "dns_servers" ADD CONSTRAINT "dns_servers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dns_servers" ADD CONSTRAINT "dns_servers_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dns_servers" ADD CONSTRAINT "dns_servers_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dns_zones" ADD CONSTRAINT "dns_zones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dns_zones" ADD CONSTRAINT "dns_zones_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "dns_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dns_zones" ADD CONSTRAINT "dns_zones_subnet_id_fkey" FOREIGN KEY ("subnet_id") REFERENCES "ip_subnets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dns_records" ADD CONSTRAINT "dns_records_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "dns_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dns_changes" ADD CONSTRAINT "dns_changes_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "dns_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dns_changes" ADD CONSTRAINT "dns_changes_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
