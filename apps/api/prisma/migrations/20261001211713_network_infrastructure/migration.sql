-- CreateEnum
CREATE TYPE "DeviceRole" AS ENUM ('ROUTER', 'SWITCH', 'FIREWALL', 'SERVER', 'ACCESS_POINT', 'CLIENT');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('PLANNED', 'ACTIVE', 'MAINTENANCE', 'OFFLINE', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "InterfaceStatus" AS ENUM ('UP', 'DOWN', 'ADMIN_DOWN');

-- CreateEnum
CREATE TYPE "Duplex" AS ENUM ('AUTO', 'FULL', 'HALF');

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "building_id" UUID,
    "room_id" UUID,
    "rack_id" UUID,
    "role" "DeviceRole" NOT NULL,
    "hostname" TEXT NOT NULL,
    "management_ip" TEXT,
    "vendor" TEXT,
    "model" TEXT,
    "os" TEXT,
    "os_version" TEXT,
    "serial_number" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'PLANNED',
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_interfaces" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ip_address" TEXT,
    "mac_address" TEXT,
    "speed_mbps" INTEGER,
    "duplex" "Duplex",
    "status" "InterfaceStatus" NOT NULL DEFAULT 'DOWN',
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "network_interfaces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "devices_organization_id_role_idx" ON "devices"("organization_id", "role");

-- CreateIndex
CREATE INDEX "devices_organization_id_status_idx" ON "devices"("organization_id", "status");

-- CreateIndex
CREATE INDEX "devices_site_id_idx" ON "devices"("site_id");

-- CreateIndex
CREATE INDEX "devices_rack_id_idx" ON "devices"("rack_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_organization_id_hostname_key" ON "devices"("organization_id", "hostname");

-- CreateIndex
CREATE UNIQUE INDEX "devices_organization_id_management_ip_key" ON "devices"("organization_id", "management_ip");

-- CreateIndex
CREATE UNIQUE INDEX "devices_organization_id_serial_number_key" ON "devices"("organization_id", "serial_number");

-- CreateIndex
CREATE INDEX "network_interfaces_device_id_idx" ON "network_interfaces"("device_id");

-- CreateIndex
CREATE INDEX "network_interfaces_mac_address_idx" ON "network_interfaces"("mac_address");

-- CreateIndex
CREATE UNIQUE INDEX "network_interfaces_device_id_name_key" ON "network_interfaces"("device_id", "name");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_rack_id_fkey" FOREIGN KEY ("rack_id") REFERENCES "racks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_interfaces" ADD CONSTRAINT "network_interfaces_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
