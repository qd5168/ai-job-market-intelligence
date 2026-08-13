import type { Job } from 'bullmq';
import { prisma } from '@ai-job-market-intelligence/db';
import type { DataRetentionCleanupPayload } from '@ai-job-market-intelligence/shared/queue';
import { logger } from '../logger.js';

const JOBS_RETENTION_DAYS = 90;
const NOTIFICATIONS_RETENTION_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * MS_PER_DAY);
}

// Deleting `jobs` rows cascades to job_embeddings/job_scores/job_applications/
// notifications (all onDelete: Cascade in schema.prisma), so those three
// tables need no separate cleanup query — only `notifications` gets its own
// pass, for rows whose job is still within the 90-day window but the
// notification itself has aged past its own, shorter retention period.
export async function processDataRetentionCleanup(
  job: Job<DataRetentionCleanupPayload>,
): Promise<void> {
  const traceId = job.id!;

  const { count: jobsDeleted } = await prisma.job.deleteMany({
    where: { postedAt: { lt: daysAgo(JOBS_RETENTION_DAYS) } },
  });

  const { count: notificationsDeleted } = await prisma.notification.deleteMany({
    where: { createdAt: { lt: daysAgo(NOTIFICATIONS_RETENTION_DAYS) } },
  });

  // Bulk deletes don't return physical disk space to the OS on their own —
  // VACUUM ANALYZE reclaims it and refreshes planner stats. Must run outside
  // a transaction, which a standalone $executeRaw call already is.
  await prisma.$executeRaw`VACUUM ANALYZE jobs`;

  logger.info({
    event: 'data_retention_cleanup_complete',
    traceId,
    jobsDeleted,
    notificationsDeleted,
  });
}
