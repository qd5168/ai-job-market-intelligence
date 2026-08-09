import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAuth,
  mockUserFindUnique,
  mockUserUpdate,
  mockUserProfileUpsert,
  mockClearProfileEmbedding,
  mockEnqueueRescoring,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockUserProfileUpsert: vi.fn(),
  mockClearProfileEmbedding: vi.fn(),
  mockEnqueueRescoring: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: mockAuth }));
vi.mock('@ai-job-market-intelligence/db', () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique, update: mockUserUpdate },
    userProfile: { upsert: mockUserProfileUpsert },
  },
  clearProfileEmbedding: mockClearProfileEmbedding,
}));
vi.mock('@/lib/queue', () => ({ enqueueRescoring: mockEnqueueRescoring }));

import { PUT } from '../route';

function makePutRequest(body: unknown) {
  return new Request('http://localhost/api/v1/users/me/profile', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

const validBody = {
  skills: ['node.js', 'typescript'],
  experienceYears: 7,
  preferredRoles: ['Backend Team Lead'],
  currentCountry: 'cn',
  expectedSalaryMin: 120000,
};

beforeEach(() => {
  mockAuth.mockReset();
  mockUserFindUnique.mockReset();
  mockUserUpdate.mockReset();
  mockUserProfileUpsert.mockReset();
  mockClearProfileEmbedding.mockReset();
  mockEnqueueRescoring.mockReset();
});

describe('PUT /api/v1/users/me/profile', () => {
  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await PUT(makePutRequest(validBody));

    expect(res.status).toBe(401);
    expect(mockClearProfileEmbedding).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid body', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const res = await PUT(makePutRequest({ ...validBody, skills: [] }));

    expect(res.status).toBe(400);
    expect(mockUserProfileUpsert).not.toHaveBeenCalled();
    expect(mockClearProfileEmbedding).not.toHaveBeenCalled();
  });

  it('clears profile embedding after profile update', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({ onboardingCompleted: true });
    mockUserProfileUpsert.mockResolvedValue({
      skills: ['node.js', 'typescript'],
      experienceYears: 7,
      preferredRoles: ['Backend Team Lead'],
      currentCountry: 'CN',
      expectedSalaryMin: 120000,
      updatedAt: new Date('2026-08-10T00:00:00.000Z'),
    });
    mockUserUpdate.mockResolvedValue({ id: 'user-1' });

    const res = await PUT(makePutRequest(validBody));

    expect(res.status).toBe(200);
    expect(mockClearProfileEmbedding).toHaveBeenCalledWith('user-1');
    expect(mockEnqueueRescoring).toHaveBeenCalledWith('user-1', false);
  });
});
