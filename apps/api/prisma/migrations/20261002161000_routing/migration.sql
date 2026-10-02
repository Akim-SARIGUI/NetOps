-- CreateEnum
CREATE TYPE "Layer3Kind" AS ENUM ('PHYSICAL', 'SVI', 'SUBINTERFACE');

-- CreateEnum
CREATE TYPE "Layer3Status" AS ENUM ('PLANNED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "RouteProtocol" AS ENUM ('CONNECTED', 'STATIC', 'DEFAULT', 'OSPF');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('ACTIVE', 'PLANNED', 'DISABLED');

-- CreateTable
CREATE TABLE "layer3_interfaces" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "Layer3Kind" NOT NULL,
    "vlan_id" UUID,
    "parent_interface_id" UUID,
    "address" TEXT NOT NULL,
    "subnet_id" UUID NOT NULL,
    "status" "Layer3Status" NOT NULL DEFAULT 'PLANNED',
    "description" TEXT,
    "ospf_area_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "layer3_interfaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "destination" TEXT NOT NULL,
    "prefix_length" INTEGER NOT NULL,
    "cidr" TEXT NOT NULL,
    "gateway" TEXT,
    "layer3_interface_id" UUID,
    "metric" INTEGER NOT NULL,
    "protocol" "RouteProtocol" NOT NULL,
    "status" "RouteStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ospf_processes" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "process_id" INTEGER NOT NULL,
    "router_id" TEXT NOT NULL,
    "status" "Layer3Status" NOT NULL DEFAULT 'PLANNED',
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ospf_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ospf_areas" (
    "id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "area_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ospf_areas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "layer3_interfaces_vlan_id_idx" ON "layer3_interfaces"("vlan_id");

-- CreateIndex
CREATE INDEX "layer3_interfaces_subnet_id_idx" ON "layer3_interfaces"("subnet_id");

-- CreateIndex
CREATE INDEX "layer3_interfaces_parent_interface_id_idx" ON "layer3_interfaces"("parent_interface_id");

-- CreateIndex
CREATE INDEX "layer3_interfaces_ospf_area_id_idx" ON "layer3_interfaces"("ospf_area_id");

-- CreateIndex
CREATE UNIQUE INDEX "layer3_interfaces_device_id_name_key" ON "layer3_interfaces"("device_id", "name");

-- CreateIndex
CREATE INDEX "routes_layer3_interface_id_idx" ON "routes"("layer3_interface_id");

-- CreateIndex
CREATE INDEX "routes_device_id_protocol_idx" ON "routes"("device_id", "protocol");

-- CreateIndex
CREATE UNIQUE INDEX "routes_device_id_cidr_key" ON "routes"("device_id", "cidr");

-- CreateIndex
CREATE UNIQUE INDEX "ospf_processes_device_id_key" ON "ospf_processes"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "ospf_areas_process_id_area_id_key" ON "ospf_areas"("process_id", "area_id");

-- AddForeignKey
ALTER TABLE "layer3_interfaces" ADD CONSTRAINT "layer3_interfaces_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layer3_interfaces" ADD CONSTRAINT "layer3_interfaces_vlan_id_fkey" FOREIGN KEY ("vlan_id") REFERENCES "vlans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layer3_interfaces" ADD CONSTRAINT "layer3_interfaces_parent_interface_id_fkey" FOREIGN KEY ("parent_interface_id") REFERENCES "network_interfaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layer3_interfaces" ADD CONSTRAINT "layer3_interfaces_subnet_id_fkey" FOREIGN KEY ("subnet_id") REFERENCES "ip_subnets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layer3_interfaces" ADD CONSTRAINT "layer3_interfaces_ospf_area_id_fkey" FOREIGN KEY ("ospf_area_id") REFERENCES "ospf_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_layer3_interface_id_fkey" FOREIGN KEY ("layer3_interface_id") REFERENCES "layer3_interfaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ospf_processes" ADD CONSTRAINT "ospf_processes_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ospf_areas" ADD CONSTRAINT "ospf_areas_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "ospf_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
