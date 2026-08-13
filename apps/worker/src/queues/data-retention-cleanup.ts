import {
  getDataRetentionCleanupQueue,
  DATA_RETENTION_CLEANUP_JOB_OPTS,
} from '@ai-job-market-intelligence/shared/queue';

// 02:00 UTC — after career_agent_daily (01:30 UTC) and clear of the
// Himalayas ingestion window (03:00 UTC).
const DAILY_2AM_UTC = '0 2 * * *';

export async function scheduleDataRetentionCleanupCron(): Promise<void> {
  const queue = getDataRetentionCleanupQueue();

  await queue.add(
    'cleanup',
    {},
    {
      ...DATA_RETENTION_CLEANUP_JOB_OPTS,
      jobId: 'data-retention-cleanup-cron',
      repeat: { pattern: DAILY_2AM_UTC, immediately: false },
    },
  );
}
