-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "activeVariantIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "textVariants" JSONB;
