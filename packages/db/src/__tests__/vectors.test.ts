import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../client';
import {
  upsertJobEmbedding,
  findSimilarJobs,
  recordAlsoSeenOn,
  getProfileEmbedding,
  upsertProfileEmbedding,
  clearProfileEmbedding,
} from '../vectors';

// Integration test against a real Postgres with pgvector.
const TEST_EXTERNAL_ID_PREFIX = 'test-vectors-';
const TEST_EMAIL_PREFIX = 'test-vectors-';

function unitVector(dims: number, hotIndex: number): number[] {
  return Array.from({ length: dims }, (_, i) => (i === hotIndex ? 1 : 0));
}

// Two vectors that only differ in a couple of components stay above the
// 0.92 cosine-similarity threshold used for cross-source dedup.
const BASE_EMBEDDING = Array.from({ length: 2048 }, (_, i) => (i < 100 ? 1 : 0));
const NEAR_DUPLICATE_EMBEDDING = Array.from({ length: 2048 }, (_, i) => (i < 95 ? 1 : 0));

async function createTestJob(
  overrides: Partial<Parameters<typeof prisma.job.create>[0]['data']> = {},
) {
  return prisma.job.create({
    data: {
      externalId: `${TEST_EXTERNAL_ID_PREFIX}${crypto.randomUUID()}`,
      source: 'REMOTEOK',
      title: 'Backend Engineer',
      company: 'Test Dedup Co',
      description: 'A'.repeat(100),
      url: 'https://example.com/job',
      location: 'Remote',
      tags: [],
      alsoSeenOn: [],
      ...overrides,
    },
  });
}

async function createTestProfile() {
  const user = await prisma.user.create({
    data: { email: `${TEST_EMAIL_PREFIX}${crypto.randomUUID()}@example.com` },
  });
  await prisma.userProfile.create({
    data: { userId: user.id, skills: [], preferredRoles: [] },
  });
  return user.id;
}

afterAll(async () => {
  await prisma.job.deleteMany({ where: { externalId: { startsWith: TEST_EXTERNAL_ID_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

describe('findSimilarJobs', () => {
  it('finds a near-duplicate posting from the same company within the time window', async () => {
    const canonical = await createTestJob({ company: 'Similarity Co' });
    await upsertJobEmbedding(canonical.id, BASE_EMBEDDING, 'text-embedding-3-small');

    const candidates = await findSimilarJobs(NEAR_DUPLICATE_EMBEDDING, {
      threshold: 0.92,
      sameCompany: 'Similarity Co',
      postedWithinDays: 14,
    });

    expect(candidates.map((c) => c.id)).toContain(canonical.id);
  });

  it('does not match a different company even with an identical embedding', async () => {
    const other = await createTestJob({ company: 'Different Co' });
    await upsertJobEmbedding(other.id, BASE_EMBEDDING, 'text-embedding-3-small');

    const candidates = await findSimilarJobs(BASE_EMBEDDING, {
      threshold: 0.92,
      sameCompany: 'Not The Same Co',
      postedWithinDays: 14,
    });

    expect(candidates.map((c) => c.id)).not.toContain(other.id);
  });

  it('does not match dissimilar embeddings even for the same company', async () => {
    const job = await createTestJob({ company: 'Orthogonal Co' });
    await upsertJobEmbedding(job.id, unitVector(2048, 0), 'text-embedding-3-small');

    const candidates = await findSimilarJobs(unitVector(2048, 1), {
      threshold: 0.92,
      sameCompany: 'Orthogonal Co',
      postedWithinDays: 14,
    });

    expect(candidates.map((c) => c.id)).not.toContain(job.id);
  });
});

describe('getProfileEmbedding / upsertProfileEmbedding / clearProfileEmbedding', () => {
  it('returns null when no embedding has been set yet', async () => {
    const userId = await createTestProfile();

    expect(await getProfileEmbedding(userId)).toBeNull();
  });

  it('round-trips a stored embedding', async () => {
    const userId = await createTestProfile();

    await upsertProfileEmbedding(userId, unitVector(2048, 0));

    expect(await getProfileEmbedding(userId)).toEqual(unitVector(2048, 0));
  });

  it('overwrites a previously stored embedding', async () => {
    const userId = await createTestProfile();

    await upsertProfileEmbedding(userId, unitVector(2048, 0));
    await upsertProfileEmbedding(userId, unitVector(2048, 1));

    expect(await getProfileEmbedding(userId)).toEqual(unitVector(2048, 1));
  });

  it('clears a stored embedding back to null', async () => {
    const userId = await createTestProfile();
    await upsertProfileEmbedding(userId, unitVector(2048, 0));

    await clearProfileEmbedding(userId);

    expect(await getProfileEmbedding(userId)).toBeNull();
  });
});

describe('recordAlsoSeenOn', () => {
  it('appends a new source to an empty alsoSeenOn list', async () => {
    const job = await createTestJob({ source: 'REMOTEOK' });

    await recordAlsoSeenOn(job.id, 'GREENHOUSE');

    const updated = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.alsoSeenOn).toEqual(['GREENHOUSE']);
  });

  it('does not add a duplicate entry when called twice with the same source', async () => {
    const job = await createTestJob({ source: 'REMOTEOK' });

    await recordAlsoSeenOn(job.id, 'GREENHOUSE');
    await recordAlsoSeenOn(job.id, 'GREENHOUSE');

    const updated = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.alsoSeenOn).toEqual(['GREENHOUSE']);
  });

  it("is a no-op when the source matches the job's own canonical source", async () => {
    const job = await createTestJob({ source: 'REMOTEOK' });

    await recordAlsoSeenOn(job.id, 'REMOTEOK');

    const updated = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.alsoSeenOn).toEqual([]);
  });
});
