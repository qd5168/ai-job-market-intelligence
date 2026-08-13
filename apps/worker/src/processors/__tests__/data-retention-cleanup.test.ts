import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockJobDeleteMany, mockNotificationDeleteMany, mockExecuteRaw } = vi.hoisted(() => ({
  mockJobDeleteMany: vi.fn(),
  mockNotificationDeleteMany: vi.fn(),
  mockExecuteRaw: vi.fn(),
}));

vi.mock('@ai-job-market-intelligence/db', () => ({
  prisma: {
    job: { deleteMany: mockJobDeleteMany },
    notification: { deleteMany: mockNotificationDeleteMany },
    $executeRaw: mockExecuteRaw,
  },
}));

vi.mock('../../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { processDataRetentionCleanup } from '../data-retention-cleanup';

const NOW = new Date('2026-08-12T02:00:00Z');

function makeJob() {
  return { id: 'data-retention-cleanup-cron' } as never;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  mockJobDeleteMany.mockReset().mockResolvedValue({ count: 42 });
  mockNotificationDeleteMany.mockReset().mockResolvedValue({ count: 7 });
  mockExecuteRaw.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('processDataRetentionCleanup', () => {
  it('deletes jobs posted more than 90 days ago', async () => {
    await processDataRetentionCleanup(makeJob());

    const cutoff = new Date('2026-05-14T02:00:00Z'); // NOW - 90 days
    expect(mockJobDeleteMany).toHaveBeenCalledWith({
      where: { postedAt: { lt: cutoff } },
    });
  });

  it('deletes notifications older than 180 days', async () => {
    await processDataRetentionCleanup(makeJob());

    const cutoff = new Date('2026-02-13T02:00:00Z'); // NOW - 180 days
    expect(mockNotificationDeleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: cutoff } },
    });
  });

  it('runs VACUUM ANALYZE on jobs after the deletes', async () => {
    const order: string[] = [];
    mockJobDeleteMany.mockImplementation(async () => {
      order.push('deleteJobs');
      return { count: 42 };
    });
    mockNotificationDeleteMany.mockImplementation(async () => {
      order.push('deleteNotifications');
      return { count: 7 };
    });
    mockExecuteRaw.mockImplementation(async () => {
      order.push('vacuum');
    });

    await processDataRetentionCleanup(makeJob());

    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['deleteJobs', 'deleteNotifications', 'vacuum']);
  });
});
