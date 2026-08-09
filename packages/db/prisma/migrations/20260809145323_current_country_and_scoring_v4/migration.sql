-- AlterTable
ALTER TABLE "job_scores" ALTER COLUMN "scoring_version" SET DEFAULT 'v4';

-- AlterTable
ALTER TABLE "user_profiles" DROP COLUMN "preferred_countries",
ADD COLUMN     "current_country" TEXT;
