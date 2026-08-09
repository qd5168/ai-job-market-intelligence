import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
const { mockFindScore } = vi.hoisted(() => ({ mockFindScore: vi.fn() }));

vi.mock('@/lib/auth', () => ({ auth: mockAuth }));

vi.mock('@ai-job-market-intelligence/db', () => ({
  prisma: { jobScore: { findUnique: mockFindScore } },
}));

import { GET } from '../route';

function makeParams(id = 'job-1') {
  return { params: Promise.resolve({ id }) };
}

function baseScore(overrides: Record<string, unknown> = {}) {
  return {
    score: 85,
    decision: 'APPLY',
    eligibility: 'ELIGIBLE',
    reasoning: 'Strong match.',
    strengths: ['Node.js experience'],
    skillGap: ['Kubernetes'],
    llmScore: 88,
    embeddingScore: 82,
    ruleScore: 85,
    scoringVersion: 'v4.1',
    createdAt: new Date('2026-06-24T10:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  mockAuth.mockReset();
  mockFindScore.mockReset();
  mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('GET /api/v1/jobs/:id/score', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost'), makeParams());

    expect(res.status).toBe(401);
  });

  it('returns 404 when no score exists yet', async () => {
    mockFindScore.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost'), makeParams());

    expect(res.status).toBe(404);
  });

  it('scopes the lookup to the requesting user', async () => {
    mockFindScore.mockResolvedValue(baseScore());

    await GET(new Request('http://localhost'), makeParams('job-1'));

    expect(mockFindScore).toHaveBeenCalledWith({
      where: { jobId_userId: { jobId: 'job-1', userId: 'user-1' } },
    });
  });

  it('includes eligibility independently of decision', async () => {
    mockFindScore.mockResolvedValue(baseScore({ decision: 'SKIP', eligibility: 'INELIGIBLE' }));

    const res = await GET(new Request('http://localhost'), makeParams());
    const body = await res.json();

    expect(body.data.decision).toBe('SKIP');
    expect(body.data.eligibility).toBe('INELIGIBLE');
  });

  it('returns the score breakdown and reasoning fields', async () => {
    mockFindScore.mockResolvedValue(baseScore());

    const res = await GET(new Request('http://localhost'), makeParams());
    const body = await res.json();

    expect(body.data).toEqual({
      score: 85,
      decision: 'APPLY',
      eligibility: 'ELIGIBLE',
      reasoning: 'Strong match.',
      strengths: ['Node.js experience'],
      skillGap: ['Kubernetes'],
      breakdown: { llmScore: 88, embeddingScore: 82, ruleScore: 85 },
      scoringVersion: 'v4.1',
      createdAt: '2026-06-24T10:00:00.000Z',
    });
  });
});
