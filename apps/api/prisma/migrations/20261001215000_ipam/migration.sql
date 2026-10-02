-- CreateEnum
CREATE TYPE "IpFamily" AS ENUM ('IPV4', 'IPV6');

-- CreateEnum
CREATE TYPE "IpAddressRole" AS ENUM ('GATEWAY', 'ALLOCATED', 'RESERVED');

-- CreateTable
CREATE TABLE "ip_networks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cidr" TEXT NOT NULL,
    "family" "IpFamily" NOT NULL,
    "prefix_length" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ip_networks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ip_subnets" (
    "id" UUID NOT NULL,
    "network_id" UUID NOT NULL,
    "vlan_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cidr" TEXT NOT NULL,
    "family" "IpFamily" NOT NULL,
    "prefix_length" INTEGER NOT NULL,
    "gateway_address_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ip_subnets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ip_addresses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subnet_id" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "role" "IpAddressRole" NOT NULL,
    "interface_id" UUID,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ip_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ip_networks_organization_id_family_idx" ON "ip_networks"("organization_id", "family");

-- CreateIndex
CREATE UNIQUE INDEX "ip_networks_site_id_cidr_key" ON "ip_networks"("site_id", "cidr");

-- CreateIndex
CREATE UNIQUE INDEX "ip_networks_site_id_name_key" ON "ip_networks"("site_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ip_subnets_gateway_address_id_key" ON "ip_subnets"("gateway_address_id");

-- CreateIndex
CREATE INDEX "ip_subnets_vlan_id_idx" ON "ip_subnets"("vlan_id");

-- CreateIndex
CREATE UNIQUE INDEX "ip_subnets_network_id_cidr_key" ON "ip_subnets"("network_id", "cidr");

-- CreateIndex
CREATE UNIQUE INDEX "ip_subnets_network_id_name_key" ON "ip_subnets"("network_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ip_addresses_interface_id_key" ON "ip_addresses"("interface_id");

-- CreateIndex
CREATE INDEX "ip_addresses_subnet_id_role_idx" ON "ip_addresses"("subnet_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ip_addresses_organization_id_address_key" ON "ip_addresses"("organization_id", "address");

-- AddForeignKey
ALTER TABLE "ip_networks" ADD CONSTRAINT "ip_networks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ip_networks" ADD CONSTRAINT "ip_networks_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ip_subnets" ADD CONSTRAINT "ip_subnets_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "ip_networks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ip_subnets" ADD CONSTRAINT "ip_subnets_vlan_id_fkey" FOREIGN KEY ("vlan_id") REFERENCES "vlans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ip_subnets" ADD CONSTRAINT "ip_subnets_gateway_address_id_fkey" FOREIGN KEY ("gateway_address_id") REFERENCES "ip_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ip_addresses" ADD CONSTRAINT "ip_addresses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ip_addresses" ADD CONSTRAINT "ip_addresses_subnet_id_fkey" FOREIGN KEY ("subnet_id") REFERENCES "ip_subnets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ip_addresses" ADD CONSTRAINT "ip_addresses_interface_id_fkey" FOREIGN KEY ("interface_id") REFERENCES "network_interfaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
