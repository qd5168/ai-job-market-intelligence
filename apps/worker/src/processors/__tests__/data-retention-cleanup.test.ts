import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockJobDeleteMany,
  mockNotificationDeleteMany,
  mockCareerBriefDeleteMany,
  mockCareerCoachMessageGroupBy,
  mockCareerCoachMessageDeleteMany,
  mockExecuteRaw,
} = vi.hoisted(() => ({
  mockJobDeleteMany: vi.fn(),
  mockNotificationDeleteMany: vi.fn(),
  mockCareerBriefDeleteMany: vi.fn(),
  mockCareerCoachMessageGroupBy: vi.fn(),
  mockCareerCoachMessageDeleteMany: vi.fn(),
  mockExecuteRaw: vi.fn(),
}));

vi.mock('@ai-job-market-intelligence/db', () => ({
  prisma: {
    job: { deleteMany: mockJobDeleteMany },
    notification: { deleteMany: mockNotificationDeleteMany },
    careerBrief: { deleteMany: mockCareerBriefDeleteMany },
    careerCoachMessage: {
      groupBy: mockCareerCoachMessageGroupBy,
      deleteMany: mockCareerCoachMessageDeleteMany,
    },
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
  mockCareerBriefDeleteMany.mockReset().mockResolvedValue({ count: 3 });
  mockCareerCoachMessageGroupBy.mockReset().mockResolvedValue([]);
  mockCareerCoachMessageDeleteMany.mockReset().mockResolvedValue({ count: 0 });
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

  it('deletes career briefs older than 90 days', async () => {
    await processDataRetentionCleanup(makeJob());

    const cutoff = new Date('2026-05-14T02:00:00Z'); // NOW - 90 days
    expect(mockCareerBriefDeleteMany).toHaveBeenCalledWith({
      where: { briefDate: { lt: cutoff } },
    });
  });

  it('deletes an entire career coach conversation once its last message is 180+ days old', async () => {
    mockCareerCoachMessageGroupBy.mockResolvedValue([
      { userId: 'stale-user', _max: { createdAt: new Date('2026-01-01T00:00:00Z') } }, // > 180d ago
      { userId: 'active-user', _max: { createdAt: new Date('2026-08-01T00:00:00Z') } }, // recent
    ]);

    await processDataRetentionCleanup(makeJob());

    expect(mockCareerCoachMessageDeleteMany).toHaveBeenCalledWith({
      where: { userId: { in: ['stale-user'] } },
    });
  });

  it('does not touch career_coach_messages when no conversation is inactive', async () => {
    mockCareerCoachMessageGroupBy.mockResolvedValue([
      { userId: 'active-user', _max: { createdAt: new Date('2026-08-01T00:00:00Z') } },
    ]);

    await processDataRetentionCleanup(makeJob());

    expect(mockCareerCoachMessageDeleteMany).not.toHaveBeenCalled();
  });

  it('does not partially trim an active conversation by message age', async () => {
    // A conversation with an old first message but recent activity overall
    // must survive in full — only the per-user last-activity date decides
    // whether the whole conversation is cleaned up.
    mockCareerCoachMessageGroupBy.mockResolvedValue([
      { userId: 'long-running-user', _max: { createdAt: new Date('2026-08-10T00:00:00Z') } },
    ]);

    await processDataRetentionCleanup(makeJob());

    expect(mockCareerCoachMessageDeleteMany).not.toHaveBeenCalled();
  });

  it('runs VACUUM ANALYZE on jobs and career_coach_messages after the deletes', async () => {
    const order: string[] = [];
    mockJobDeleteMany.mockImplementation(async () => {
      order.push('deleteJobs');
      return { count: 42 };
    });
    mockNotificationDeleteMany.mockImplementation(async () => {
      order.push('deleteNotifications');
      return { count: 7 };
    });
    mockCareerBriefDeleteMany.mockImplementation(async () => {
      order.push('deleteCareerBriefs');
      return { count: 3 };
    });
    mockCareerCoachMessageGroupBy.mockImplementation(async () => {
      order.push('groupByConversations');
      return [];
    });
    mockExecuteRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      order.push(`vacuum:${strings.join('')}`);
    });

    await processDataRetentionCleanup(makeJob());

    expect(mockExecuteRaw).toHaveBeenCalledTimes(2);
    expect(order).toEqual([
      'deleteJobs',
      'deleteNotifications',
      'deleteCareerBriefs',
      'groupByConversations',
      'vacuum:VACUUM ANALYZE jobs',
      'vacuum:VACUUM ANALYZE career_coach_messages',
    ]);
  });
});
