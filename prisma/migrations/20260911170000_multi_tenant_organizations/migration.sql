-- Мультитенантность: организации (клиенты сервиса), каждая видит только свои данные.
-- Все существующие данные становятся первой организацией.

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Organization" ("id", "name") VALUES ('00000000-0000-0000-0000-000000000001', 'Vinakov Lab');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('owner', 'operator');

-- User: организация, роль, флаг суперадмина
ALTER TABLE "User" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "User" ADD COLUMN "role" "OrgRole" NOT NULL DEFAULT 'owner';
ALTER TABLE "User" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "organizationId" = '00000000-0000-0000-0000-000000000001', "isSuperAdmin" = true;
ALTER TABLE "User" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- Campaign
ALTER TABLE "Campaign" ADD COLUMN "organizationId" TEXT;
UPDATE "Campaign" SET "organizationId" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "Campaign" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
CREATE INDEX "Campaign_organizationId_idx" ON "Campaign"("organizationId");

-- LetterheadTemplate
ALTER TABLE "LetterheadTemplate" ADD COLUMN "organizationId" TEXT;
UPDATE "LetterheadTemplate" SET "organizationId" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "LetterheadTemplate" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "LetterheadTemplate" ADD CONSTRAINT "LetterheadTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
CREATE INDEX "LetterheadTemplate_organizationId_idx" ON "LetterheadTemplate"("organizationId");

-- NumberingConfig
ALTER TABLE "NumberingConfig" ADD COLUMN "organizationId" TEXT;
UPDATE "NumberingConfig" SET "organizationId" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "NumberingConfig" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "NumberingConfig" ADD CONSTRAINT "NumberingConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
CREATE INDEX "NumberingConfig_organizationId_idx" ON "NumberingConfig"("organizationId");

-- MailAccountConfig
ALTER TABLE "MailAccountConfig" ADD COLUMN "organizationId" TEXT;
UPDATE "MailAccountConfig" SET "organizationId" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "MailAccountConfig" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "MailAccountConfig" ADD CONSTRAINT "MailAccountConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
CREATE INDEX "MailAccountConfig_organizationId_idx" ON "MailAccountConfig"("organizationId");

-- AuditEvent (необязательное поле — записи без организации возможны для системных/суперадмин-действий)
ALTER TABLE "AuditEvent" ADD COLUMN "organizationId" TEXT;
UPDATE "AuditEvent" SET "organizationId" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
CREATE INDEX "AuditEvent_organizationId_idx" ON "AuditEvent"("organizationId");

-- Suppression: был глобальным списком отписавшихся (email как первичный ключ),
-- теперь свой список на каждую организацию — отписка у одного клиента не должна
-- блокировать переписку другого клиента с тем же адресом.
ALTER TABLE "Suppression" ADD COLUMN "id" TEXT;
UPDATE "Suppression" SET "id" = gen_random_uuid()::text;
ALTER TABLE "Suppression" ADD COLUMN "organizationId" TEXT;
UPDATE "Suppression" SET "organizationId" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "Suppression" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "Suppression" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Suppression" DROP CONSTRAINT "Suppression_pkey";
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id");
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX "Suppression_organizationId_email_key" ON "Suppression"("organizationId", "email");
