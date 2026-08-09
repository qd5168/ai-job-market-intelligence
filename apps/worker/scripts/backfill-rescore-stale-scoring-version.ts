import { prisma } from '@ai-job-market-intelligence/db';
import { enqueueRescoringJobs } from '@ai-job-market-intelligence/shared/queue';
import { CURRENT_SCORING_VERSION } from '@ai-job-market-intelligence/shared/constants';

// Actively re-enqueues every job_score whose scoringVersion is behind the
// current algorithm, instead of waiting for a user's own next Profile
// update/Onboarding/new-job-match to passively trigger it. Rerunnable after
// any future CURRENT_SCORING_VERSION bump, not a one-off tied to this
// specific fix.
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const stale = await prisma.jobScore.findMany({
    where: { scoringVersion: { not: CURRENT_SCORING_VERSION } },
    select: { jobId: true, userId: true },
  });
  console.log(
    `Found ${stale.length} job_scores with scoringVersion != ${CURRENT_SCORING_VERSION}.`,
  );

  const byUser = new Map<string, string[]>();
  for (const row of stale) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row.jobId);
    byUser.set(row.userId, list);
  }
  console.log(`Across ${byUser.size} users.`);

  if (DRY_RUN) {
    console.log('--dry-run passed: not enqueueing anything.');
    await prisma.$disconnect();
    return;
  }

  let processed = 0;
  for (const [userId, jobIds] of byUser) {
    await enqueueRescoringJobs(userId, jobIds);
    processed += jobIds.length;
    console.log(`Progress: ${processed}/${stale.length} scanned, enqueued for user ${userId}`);
  }

  console.log(`Done. Enqueued ${stale.length} scoring_match jobs across ${byUser.size} users.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
