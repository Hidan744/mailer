-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'running', 'paused_for_edit', 'paused_manual', 'done');

-- CreateEnum
CREATE TYPE "LetterStatus" AS ENUM ('queued', 'sent', 'failed', 'bounced');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "sendWindowStart" TEXT NOT NULL DEFAULT '09:00',
    "sendWindowEnd" TEXT NOT NULL DEFAULT '17:00',
    "lunchStart" TEXT NOT NULL DEFAULT '12:00',
    "lunchEnd" TEXT NOT NULL DEFAULT '13:00',
    "intervalMinutes" INTEGER NOT NULL DEFAULT 5,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Yekaterinburg',
    "rotationThreshold" INTEGER NOT NULL DEFAULT 75,
    "sentSinceLastEdit" INTEGER NOT NULL DEFAULT 0,
    "letterheadId" TEXT,
    "numberingId" TEXT,
    "mailAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LetterheadTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headerImageUrl" TEXT,
    "footerImageUrl" TEXT,
    "footerContactsText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LetterheadTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "surnameInitials" TEXT NOT NULL,
    "fullNamePatronymic" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "extra" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberingConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "template" TEXT NOT NULL DEFAULT '{prefix}/{counter}',
    "prefix" TEXT NOT NULL DEFAULT '',
    "counter" INTEGER NOT NULL DEFAULT 1,
    "resetPeriod" TEXT NOT NULL DEFAULT 'never',
    "lastResetYear" INTEGER,

    CONSTRAINT "NumberingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailAccountConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL DEFAULT 465,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
    "smtpUser" TEXT NOT NULL,
    "smtpPasswordEnc" TEXT NOT NULL,
    "imapHost" TEXT,
    "imapPort" INTEGER DEFAULT 993,
    "imapSecure" BOOLEAN NOT NULL DEFAULT true,
    "imapUser" TEXT,
    "imapPasswordEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailAccountConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Letter" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "outgoingNumber" TEXT,
    "sentDate" TEXT,
    "messageId" TEXT,
    "trackingToken" TEXT NOT NULL,
    "status" "LetterStatus" NOT NULL DEFAULT 'queued',
    "errorMessage" TEXT,
    "subjectSnapshot" TEXT,
    "bodySnapshot" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),

    CONSTRAINT "Letter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'unsubscribed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recipient_campaignId_idx" ON "Recipient"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Letter_messageId_key" ON "Letter"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Letter_trackingToken_key" ON "Letter"("trackingToken");

-- CreateIndex
CREATE INDEX "Letter_campaignId_idx" ON "Letter"("campaignId");

-- CreateIndex
CREATE INDEX "Letter_recipientId_idx" ON "Letter"("recipientId");

-- CreateIndex
CREATE INDEX "Letter_status_idx" ON "Letter"("status");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_letterheadId_fkey" FOREIGN KEY ("letterheadId") REFERENCES "LetterheadTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_numberingId_fkey" FOREIGN KEY ("numberingId") REFERENCES "NumberingConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccountConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
