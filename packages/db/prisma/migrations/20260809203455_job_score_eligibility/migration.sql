-- CreateEnum
CREATE TYPE "JobEligibility" AS ENUM ('ELIGIBLE', 'RESTRICTED', 'INELIGIBLE');

-- AlterTable
ALTER TABLE "job_scores" ADD COLUMN     "eligibility" "JobEligibility" NOT NULL DEFAULT 'RESTRICTED',
ALTER COLUMN "scoring_version" SET DEFAULT 'v4.1';

-- CreateIndex
CREATE INDEX "job_scores_user_id_eligibility_idx" ON "job_scores"("user_id", "eligibility");
