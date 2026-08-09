import { randomUUID } from 'node:crypto';
import { prisma } from './client';
import type { JobSource } from '@ai-job-market-intelligence/shared';

// job_embeddings.embedding / user_profiles.profile_embedding are pgvector
// vector(2048) columns marked as Unsupported in the Prisma schema, so the
// type-safe client (create/update/upsert/select) generates no read/write
// support for them at all — they can only be accessed via $queryRaw/$executeRaw.
//
// 2048 dims matches nvidia/llama-nemotron-embed-vl-1b-v2:free (the free
// OpenRouter model this env is configured to use), not OpenAI
// text-embedding-3-small (1536 dims, the documented production choice) —
// see the embedding_vector_2048_free_model migration for why, and the
// tradeoffs to revisit before a real production deploy.

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

function parseVectorLiteral(raw: string): number[] {
  return raw.slice(1, -1).split(',').map(Number);
}

export async function getJobEmbedding(jobId: string): Promise<number[] | null> {
  const rows = await prisma.$queryRaw<{ embedding: string }[]>`
    SELECT embedding::text AS embedding FROM job_embeddings WHERE job_id = ${jobId}
  `;
  return rows[0] ? parseVectorLiteral(rows[0].embedding) : null;
}

export async function upsertJobEmbedding(
  jobId: string,
  embedding: number[],
  model: string,
): Promise<void> {
  const vector = toVectorLiteral(embedding);
  await prisma.$executeRaw`
    INSERT INTO job_embeddings (id, job_id, embedding, model, created_at)
    VALUES (${randomUUID()}, ${jobId}, ${vector}::vector, ${model}, now())
    ON CONFLICT (job_id)
    DO UPDATE SET embedding = EXCLUDED.embedding, model = EXCLUDED.model
  `;
}

export async function getProfileEmbedding(userId: string): Promise<number[] | null> {
  const rows = await prisma.$queryRaw<{ profile_embedding: string | null }[]>`
    SELECT profile_embedding::text AS profile_embedding FROM user_profiles WHERE user_id = ${userId}
  `;
  const value = rows[0]?.profile_embedding;
  return value ? parseVectorLiteral(value) : null;
}

export async function upsertProfileEmbedding(userId: string, embedding: number[]): Promise<void> {
  const vector = toVectorLiteral(embedding);
  await prisma.$executeRaw`
    UPDATE user_profiles SET profile_embedding = ${vector}::vector, updated_at = now()
    WHERE user_id = ${userId}
  `;
}

// Called whenever a user edits their profile (skills, roles, etc.) so
// scoring-match.ts's lazy "if (!profileEmbedding)" check regenerates it
// against the new profile text on the next score, instead of silently
// scoring every future job against a vector computed from a since-edited
// profile forever.
export async function clearProfileEmbedding(userId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE user_profiles SET profile_embedding = NULL WHERE user_id = ${userId}
  `;
}

export interface SimilarJobCandidate {
  id: string;
  source: JobSource;
}

// Same company + posted within N days + cosine similarity >= threshold.
// Ordered by closest match first so the caller can take candidates[0] as the
// canonical record.
export async function findSimilarJobs(
  embedding: number[],
  options: { threshold: number; sameCompany: string; postedWithinDays: number },
): Promise<SimilarJobCandidate[]> {
  const vector = toVectorLiteral(embedding);
  const cutoff = new Date(Date.now() - options.postedWithinDays * 24 * 60 * 60 * 1000);

  return prisma.$queryRaw<SimilarJobCandidate[]>`
    SELECT j.id, j.source::text AS source
    FROM job_embeddings je
    JOIN jobs j ON j.id = je.job_id
    WHERE j.company = ${options.sameCompany}
      AND j.created_at >= ${cutoff}
      AND 1 - (je.embedding <=> ${vector}::vector) >= ${options.threshold}
    ORDER BY je.embedding <=> ${vector}::vector ASC
    LIMIT 5
  `;
}

// When a duplicate is found, the canonical (earliest seen) job keeps its own
// row and the other sources it was also found on are recorded on alsoSeenOn
// instead of writing a second jobs row.
export async function recordAlsoSeenOn(jobId: string, source: JobSource): Promise<void> {
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { source: true, alsoSeenOn: true },
  });
  if (job.source === source || job.alsoSeenOn.includes(source)) return;

  await prisma.job.update({
    where: { id: jobId },
    data: { alsoSeenOn: { set: [...job.alsoSeenOn, source] } },
  });
}
