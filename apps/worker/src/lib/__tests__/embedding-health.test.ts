import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindMany } = vi.hoisted(() => ({ mockFindMany: vi.fn() }));
const { mockUpdateEmbeddingConfidence } = vi.hoisted(() => ({
  mockUpdateEmbeddingConfidence: vi.fn(),
}));

vi.mock('@ai-job-market-intelligence/db', () => ({
  prisma: { jobScore: { findMany: mockFindMany } },
}));

vi.mock('@ai-job-market-intelligence/ai', () => ({
  updateEmbeddingConfidence: mockUpdateEmbeddingConfidence,
}));

import { refreshEmbeddingHealth } from '../embedding-health';

beforeEach(() => {
  mockFindMany.mockReset();
  mockUpdateEmbeddingConfidence.mockReset();
});

describe('refreshEmbeddingHealth', () => {
  it('queries the most recent 500 job_scores and forwards the sample to updateEmbeddingConfidence', async () => {
    const sample = [{ embeddingScore: 5 }, { embeddingScore: 80 }];
    mockFindMany.mockResolvedValue(sample);

    await refreshEmbeddingHealth();

    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { embeddingScore: true },
    });
    expect(mockUpdateEmbeddingConfidence).toHaveBeenCalledWith(sample);
  });
});
