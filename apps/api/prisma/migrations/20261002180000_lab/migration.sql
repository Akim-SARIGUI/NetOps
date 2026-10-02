-- CreateEnum
CREATE TYPE "LabRole" AS ENUM ('ROUTER', 'SWITCH', 'FIREWALL', 'SERVER', 'CLIENT');

-- CreateEnum
CREATE TYPE "LabScenarioKind" AS ENUM ('VLAN', 'DHCP', 'DNS', 'ROUTING', 'ACL', 'CONNECTIVITY');

-- CreateEnum
CREATE TYPE "PromotionPhase" AS ENUM ('PREPARED', 'VALIDATED', 'PROMOTED');

-- AlterEnum
ALTER TYPE "Environment" ADD VALUE 'DEV';

-- CreateTable
CREATE TABLE "lab_fabrics" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_fabrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_nodes" (
    "id" UUID NOT NULL,
    "fabric_id" UUID NOT NULL,
    "role" "LabRole" NOT NULL,
    "hostname" TEXT NOT NULL,
    "address" TEXT NOT NULL,

    CONSTRAINT "lab_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_scenarios" (
    "id" UUID NOT NULL,
    "fabric_id" UUID NOT NULL,
    "kind" "LabScenarioKind" NOT NULL,
    "label" TEXT NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "plan" TEXT NOT NULL,
    "observation" TEXT NOT NULL,

    CONSTRAINT "lab_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_promotions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "fabric_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "source_promotion_id" UUID,
    "source_environment" "Environment" NOT NULL,
    "target_environment" "Environment" NOT NULL,
    "target_site_id" UUID NOT NULL,
    "phase" "PromotionPhase" NOT NULL DEFAULT 'PREPARED',
    "configuration" TEXT NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "pushed" BOOLEAN NOT NULL DEFAULT false,
    "confirm_production" BOOLEAN NOT NULL DEFAULT false,
    "validated_at" TIMESTAMP(3),
    "promoted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lab_fabrics_site_id_key" ON "lab_fabrics"("site_id");

-- CreateIndex
CREATE INDEX "lab_fabrics_organization_id_idx" ON "lab_fabrics"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_nodes_fabric_id_role_key" ON "lab_nodes"("fabric_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "lab_nodes_fabric_id_hostname_key" ON "lab_nodes"("fabric_id", "hostname");

-- CreateIndex
CREATE UNIQUE INDEX "lab_scenarios_fabric_id_kind_key" ON "lab_scenarios"("fabric_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "lab_promotions_source_promotion_id_key" ON "lab_promotions"("source_promotion_id");

-- CreateIndex
CREATE INDEX "lab_promotions_organization_id_created_at_idx" ON "lab_promotions"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "lab_promotions_fabric_id_idx" ON "lab_promotions"("fabric_id");

-- CreateIndex
CREATE INDEX "lab_promotions_target_site_id_idx" ON "lab_promotions"("target_site_id");

-- AddForeignKey
ALTER TABLE "lab_fabrics" ADD CONSTRAINT "lab_fabrics_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_fabrics" ADD CONSTRAINT "lab_fabrics_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_nodes" ADD CONSTRAINT "lab_nodes_fabric_id_fkey" FOREIGN KEY ("fabric_id") REFERENCES "lab_fabrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_scenarios" ADD CONSTRAINT "lab_scenarios_fabric_id_fkey" FOREIGN KEY ("fabric_id") REFERENCES "lab_fabrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_promotions" ADD CONSTRAINT "lab_promotions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_promotions" ADD CONSTRAINT "lab_promotions_fabric_id_fkey" FOREIGN KEY ("fabric_id") REFERENCES "lab_fabrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_promotions" ADD CONSTRAINT "lab_promotions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_promotions" ADD CONSTRAINT "lab_promotions_target_site_id_fkey" FOREIGN KEY ("target_site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_promotions" ADD CONSTRAINT "lab_promotions_source_promotion_id_fkey" FOREIGN KEY ("source_promotion_id") REFERENCES "lab_promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
