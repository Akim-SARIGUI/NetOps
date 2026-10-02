-- CreateEnum
CREATE TYPE "DhcpServerStatus" AS ENUM ('PLANNED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DhcpLeaseState" AS ENUM ('ACTIVE', 'EXPIRED', 'RELEASED');

-- CreateEnum
CREATE TYPE "DhcpLeaseOrigin" AS ENUM ('SIMULATION');

-- CreateTable
CREATE TABLE "dhcp_servers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "device_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT,
    "status" "DhcpServerStatus" NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dhcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dhcp_scopes" (
    "id" UUID NOT NULL,
    "subnet_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "gateway" TEXT NOT NULL,
    "dns_servers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "domain" TEXT,
    "lease_seconds" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dhcp_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dhcp_pools" (
    "id" UUID NOT NULL,
    "scope_id" UUID NOT NULL,
    "start_address" TEXT NOT NULL,
    "end_address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dhcp_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dhcp_exclusions" (
    "id" UUID NOT NULL,
    "scope_id" UUID NOT NULL,
    "start_address" TEXT NOT NULL,
    "end_address" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dhcp_exclusions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dhcp_reservations" (
    "id" UUID NOT NULL,
    "scope_id" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "mac_address" TEXT NOT NULL,
    "hostname" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dhcp_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dhcp_leases" (
    "id" UUID NOT NULL,
    "scope_id" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "mac_address" TEXT NOT NULL,
    "hostname" TEXT,
    "state" "DhcpLeaseState" NOT NULL DEFAULT 'ACTIVE',
    "origin" "DhcpLeaseOrigin" NOT NULL DEFAULT 'SIMULATION',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dhcp_leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dhcp_relays" (
    "id" UUID NOT NULL,
    "subnet_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "interface_id" UUID,
    "helper_address" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dhcp_relays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dhcp_servers_organization_id_idx" ON "dhcp_servers"("organization_id");

-- CreateIndex
CREATE INDEX "dhcp_servers_device_id_idx" ON "dhcp_servers"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "dhcp_servers_site_id_name_key" ON "dhcp_servers"("site_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "dhcp_scopes_subnet_id_key" ON "dhcp_scopes"("subnet_id");

-- CreateIndex
CREATE INDEX "dhcp_scopes_server_id_idx" ON "dhcp_scopes"("server_id");

-- CreateIndex
CREATE INDEX "dhcp_pools_scope_id_idx" ON "dhcp_pools"("scope_id");

-- CreateIndex
CREATE INDEX "dhcp_exclusions_scope_id_idx" ON "dhcp_exclusions"("scope_id");

-- CreateIndex
CREATE INDEX "dhcp_reservations_scope_id_idx" ON "dhcp_reservations"("scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "dhcp_reservations_scope_id_address_key" ON "dhcp_reservations"("scope_id", "address");

-- CreateIndex
CREATE UNIQUE INDEX "dhcp_reservations_scope_id_mac_address_key" ON "dhcp_reservations"("scope_id", "mac_address");

-- CreateIndex
CREATE INDEX "dhcp_leases_scope_id_state_idx" ON "dhcp_leases"("scope_id", "state");

-- CreateIndex
CREATE INDEX "dhcp_leases_mac_address_idx" ON "dhcp_leases"("mac_address");

-- CreateIndex
CREATE UNIQUE INDEX "dhcp_leases_scope_id_address_key" ON "dhcp_leases"("scope_id", "address");

-- CreateIndex
CREATE INDEX "dhcp_relays_server_id_idx" ON "dhcp_relays"("server_id");

-- CreateIndex
CREATE INDEX "dhcp_relays_interface_id_idx" ON "dhcp_relays"("interface_id");

-- CreateIndex
CREATE UNIQUE INDEX "dhcp_relays_subnet_id_server_id_key" ON "dhcp_relays"("subnet_id", "server_id");

-- AddForeignKey
ALTER TABLE "dhcp_servers" ADD CONSTRAINT "dhcp_servers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dhcp_servers" ADD CONSTRAINT "dhcp_servers_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dhcp_servers" ADD CONSTRAINT "dhcp_servers_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dhcp_scopes" ADD CONSTRAINT "dhcp_scopes_subnet_id_fkey" FOREIGN KEY ("subnet_id") REFERENCES "ip_subnets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dhcp_scopes" ADD CONSTRAINT "dhcp_scopes_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "dhcp_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dhcp_pools" ADD CONSTRAINT "dhcp_pools_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "dhcp_scopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dhcp_exclusions" ADD CONSTRAINT "dhcp_exclusions_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "dhcp_scopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dhcp_reservations" ADD CONSTRAINT "dhcp_reservations_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "dhcp_scopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dhcp_leases" ADD CONSTRAINT "dhcp_leases_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "dhcp_scopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dhcp_relays" ADD CONSTRAINT "dhcp_relays_subnet_id_fkey" FOREIGN KEY ("subnet_id") REFERENCES "ip_subnets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dhcp_relays" ADD CONSTRAINT "dhcp_relays_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "dhcp_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dhcp_relays" ADD CONSTRAINT "dhcp_relays_interface_id_fkey" FOREIGN KEY ("interface_id") REFERENCES "network_interfaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
