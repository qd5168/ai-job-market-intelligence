import type { Job } from 'bullmq';
import { prisma } from '@ai-job-market-intelligence/db';
import type { DataRetentionCleanupPayload } from '@ai-job-market-intelligence/shared/queue';
import { logger } from '../logger.js';

const JOBS_RETENTION_DAYS = 90;
const NOTIFICATIONS_RETENTION_DAYS = 180;
const CAREER_BRIEFS_RETENTION_DAYS = 90;
const CAREER_COACH_INACTIVITY_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * MS_PER_DAY);
}

// career_coach_messages has no separate "conversation" table — per
// database-schema.md §11.4 the whole per-user message history is cleaned up
// only once the conversation itself has been inactive for 180 days, not by
// deleting individual old messages out of an otherwise-active conversation.
// A flat `createdAt < cutoff` delete (like notifications) would wrongly trim
// the early half of a conversation that's still ongoing.
async function deleteInactiveCareerCoachConversations(): Promise<number> {
  const conversations = await prisma.careerCoachMessage.groupBy({
    by: ['userId'],
    _max: { createdAt: true },
  });
  const cutoff = daysAgo(CAREER_COACH_INACTIVITY_DAYS);
  const inactiveUserIds = conversations
    .filter((c) => c._max.createdAt !== null && c._max.createdAt < cutoff)
    .map((c) => c.userId);

  if (inactiveUserIds.length === 0) return 0;

  const { count } = await prisma.careerCoachMessage.deleteMany({
    where: { userId: { in: inactiveUserIds } },
  });
  return count;
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

  const { count: careerBriefsDeleted } = await prisma.careerBrief.deleteMany({
    where: { briefDate: { lt: daysAgo(CAREER_BRIEFS_RETENTION_DAYS) } },
  });

  const careerCoachMessagesDeleted = await deleteInactiveCareerCoachConversations();

  // Bulk deletes don't return physical disk space to the OS on their own —
  // VACUUM ANALYZE reclaims it and refreshes planner stats. Must run outside
  // a transaction, which a standalone $executeRaw call already is. Targets
  // the two tables whose bulk-deleted rows carry the largest payloads
  // (job_embeddings' 8KB vectors live in `jobs`' TOAST storage;
  // career_coach_messages holds unbounded conversation text).
  await prisma.$executeRaw`VACUUM ANALYZE jobs`;
  await prisma.$executeRaw`VACUUM ANALYZE career_coach_messages`;

  logger.info({
    event: 'data_retention_cleanup_complete',
    traceId,
    jobsDeleted,
    notificationsDeleted,
    careerBriefsDeleted,
    careerCoachMessagesDeleted,
  });
}
