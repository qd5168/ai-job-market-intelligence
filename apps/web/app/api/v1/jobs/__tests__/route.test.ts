import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
const { mockFindManyScores, mockCountScores } = vi.hoisted(() => ({
  mockFindManyScores: vi.fn(),
  mockCountScores: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: mockAuth }));

vi.mock('@ai-job-market-intelligence/db', () => ({
  prisma: {
    jobScore: { findMany: mockFindManyScores, count: mockCountScores },
  },
}));

import { GET } from '../route';

function makeRequest(query = '') {
  return new Request(`http://localhost/api/v1/jobs${query}`);
}

function makeScoreRow(overrides: { applications?: unknown[] } = {}) {
  return {
    score: 85,
    decision: 'APPLY',
    eligibility: 'ELIGIBLE',
    reasoning: 'Great match',
    strengths: [],
    skillGap: [],
    job: {
      id: 'job-1',
      title: 'Backend Engineer',
      company: 'Acme',
      source: 'REMOTEOK',
      role: 'Backend Engineer',
      level: 'Senior',
      location: 'Remote',
      url: 'https://example.com/job-1',
      tags: ['node'],
      postedAt: new Date('2026-08-01T00:00:00Z'),
      applications: overrides.applications ?? [],
    },
  };
}

beforeEach(() => {
  mockAuth.mockReset();
  mockFindManyScores.mockReset();
  mockCountScores.mockReset();

  mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
  mockCountScores.mockResolvedValue(1);
});

describe('GET /api/v1/jobs', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(mockFindManyScores).not.toHaveBeenCalled();
  });

  it('includes the eligibility tag alongside decision in each score summary', async () => {
    mockFindManyScores.mockResolvedValue([makeScoreRow()]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.data[0].score.eligibility).toBe('ELIGIBLE');
  });

  it('returns application: null when the user has not marked this job', async () => {
    mockFindManyScores.mockResolvedValue([makeScoreRow()]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.data[0].application).toBeNull();
  });

  it('includes the application status/updatedAt when one exists', async () => {
    mockFindManyScores.mockResolvedValue([
      makeScoreRow({
        applications: [{ status: 'APPLIED', updatedAt: new Date('2026-08-04T10:00:00Z') }],
      }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.data[0].application).toEqual({
      status: 'APPLIED',
      updatedAt: '2026-08-04T10:00:00.000Z',
    });
  });

  it('filters by applicationStatus=NONE using an applications.none clause', async () => {
    mockFindManyScores.mockResolvedValue([]);

    await GET(makeRequest('?applicationStatus=NONE'));

    expect(mockFindManyScores).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          job: expect.objectContaining({
            applications: { none: { userId: 'user-1' } },
          }),
        }),
      }),
    );
  });

  it('filters by a real applicationStatus using an applications.some clause', async () => {
    mockFindManyScores.mockResolvedValue([]);

    await GET(makeRequest('?applicationStatus=INTERVIEWING'));

    expect(mockFindManyScores).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          job: expect.objectContaining({
            applications: { some: { userId: 'user-1', status: 'INTERVIEWING' } },
          }),
        }),
      }),
    );
  });
});
