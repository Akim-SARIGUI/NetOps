-- CreateEnum
CREATE TYPE "VlanRole" AS ENUM ('DATA', 'VOICE', 'MANAGEMENT', 'GUEST', 'SERVER', 'TRANSIT', 'NATIVE');

-- CreateEnum
CREATE TYPE "SecurityZone" AS ENUM ('TRUST', 'UNTRUST', 'DMZ', 'GUEST', 'MANAGEMENT', 'INTERNAL');

-- CreateEnum
CREATE TYPE "VlanStatus" AS ENUM ('ACTIVE', 'PLANNED', 'RESERVED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "PortMode" AS ENUM ('ACCESS', 'TRUNK');

-- CreateEnum
CREATE TYPE "PortStatus" AS ENUM ('UP', 'DOWN', 'ADMIN_DOWN', 'ERR_DISABLED');

-- CreateEnum
CREATE TYPE "PoeStatus" AS ENUM ('OFF', 'ON', 'FAULT');

-- CreateTable
CREATE TABLE "vlans" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "vid" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "role" "VlanRole" NOT NULL,
    "security_zone" "SecurityZone" NOT NULL,
    "status" "VlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vlans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "switch_ports" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PortStatus" NOT NULL DEFAULT 'DOWN',
    "mode" "PortMode" NOT NULL,
    "access_vlan_id" UUID,
    "native_vlan_id" UUID,
    "speed_mbps" INTEGER,
    "duplex" "Duplex",
    "description" TEXT,
    "connected_device_id" UUID,
    "mac_address" TEXT,
    "poe" "PoeStatus" NOT NULL DEFAULT 'OFF',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "switch_ports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "switch_port_vlans" (
    "port_id" UUID NOT NULL,
    "vlan_id" UUID NOT NULL,

    CONSTRAINT "switch_port_vlans_pkey" PRIMARY KEY ("port_id","vlan_id")
);

-- CreateIndex
CREATE INDEX "vlans_site_id_status_idx" ON "vlans"("site_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vlans_site_id_vid_key" ON "vlans"("site_id", "vid");

-- CreateIndex
CREATE UNIQUE INDEX "vlans_site_id_name_key" ON "vlans"("site_id", "name");

-- CreateIndex
CREATE INDEX "switch_ports_device_id_idx" ON "switch_ports"("device_id");

-- CreateIndex
CREATE INDEX "switch_ports_access_vlan_id_idx" ON "switch_ports"("access_vlan_id");

-- CreateIndex
CREATE INDEX "switch_ports_native_vlan_id_idx" ON "switch_ports"("native_vlan_id");

-- CreateIndex
CREATE INDEX "switch_ports_mac_address_idx" ON "switch_ports"("mac_address");

-- CreateIndex
CREATE UNIQUE INDEX "switch_ports_device_id_name_key" ON "switch_ports"("device_id", "name");

-- CreateIndex
CREATE INDEX "switch_port_vlans_vlan_id_idx" ON "switch_port_vlans"("vlan_id");

-- AddForeignKey
ALTER TABLE "vlans" ADD CONSTRAINT "vlans_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "switch_ports" ADD CONSTRAINT "switch_ports_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "switch_ports" ADD CONSTRAINT "switch_ports_access_vlan_id_fkey" FOREIGN KEY ("access_vlan_id") REFERENCES "vlans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "switch_ports" ADD CONSTRAINT "switch_ports_native_vlan_id_fkey" FOREIGN KEY ("native_vlan_id") REFERENCES "vlans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "switch_ports" ADD CONSTRAINT "switch_ports_connected_device_id_fkey" FOREIGN KEY ("connected_device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "switch_port_vlans" ADD CONSTRAINT "switch_port_vlans_port_id_fkey" FOREIGN KEY ("port_id") REFERENCES "switch_ports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "switch_port_vlans" ADD CONSTRAINT "switch_port_vlans_vlan_id_fkey" FOREIGN KEY ("vlan_id") REFERENCES "vlans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
