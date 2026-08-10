import { prisma } from '@ai-job-market-intelligence/db';
import { updateEmbeddingConfidence } from '@ai-job-market-intelligence/ai';

const SAMPLE_SIZE = 500;

// The Prisma query packages/ai can't own (deliberately no Prisma
// dependency) — called on the existing ingestion_collect 30min cron cadence
// (see processors/ingestion-collect.ts), not a new queue.
export async function refreshEmbeddingHealth(): Promise<void> {
  const recent = await prisma.jobScore.findMany({
    orderBy: { createdAt: 'desc' },
    take: SAMPLE_SIZE,
    select: { embeddingScore: true },
  });
  updateEmbeddingConfidence(recent);
}
