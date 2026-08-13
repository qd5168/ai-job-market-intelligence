import { Queue, type JobsOptions } from 'bullmq';
import { QUEUE_NAMES } from '../constants/queues';
import { getQueueConnection } from './connection';

// Whole-table sweep triggered by cron — no per-run parameters needed, same
// reasoning as SkillTrendAggregatePayload.
export type DataRetentionCleanupPayload = Record<string, never>;

export const DATA_RETENTION_CLEANUP_JOB_OPTS: JobsOptions = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { count: 10 },
  removeOnFail: { count: 10 },
};

let dataRetentionCleanupQueue: Queue<DataRetentionCleanupPayload> | undefined;

export function getDataRetentionCleanupQueue(): Queue<DataRetentionCleanupPayload> {
  dataRetentionCleanupQueue ??= new Queue(QUEUE_NAMES.DATA_RETENTION_CLEANUP, {
    connection: getQueueConnection(),
  });
  return dataRetentionCleanupQueue;
}
