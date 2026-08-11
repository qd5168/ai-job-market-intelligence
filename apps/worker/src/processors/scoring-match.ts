import type { Job } from 'bullmq';
import {
  prisma,
  getJobEmbedding,
  getProfileEmbedding,
  upsertProfileEmbedding,
} from '@ai-job-market-intelligence/db';
import {
  buildProfileText,
  generateEmbedding,
  scoreJob,
  computeLLMScore,
  computeFinalScore,
  getEmbeddingConfidence,
  toDecision,
  type ProfileInput,
  type JobInput,
  type ScoringResult,
} from '@ai-job-market-intelligence/ai';
import type { ScoringMatchPayload } from '@ai-job-market-intelligence/shared/queue';
import {
  getAgentHandoffQueue,
  AGENT_HANDOFF_JOB_OPTS,
} from '@ai-job-market-intelligence/shared/queue';
import { canScore, incrementUsage } from '../billing/usage.js';
import { logger } from '../logger.js';

// Deliberately higher than the >=85 Opportunity Discovery threshold (which
// summarizes into the next day's Career Brief) — this triggers a real-time
// agent handoff instead of waiting for the daily digest, reserved for
// matches strong enough to justify an immediate, proactive Career Coach
// message.
const AGENT_HANDOFF_SCORE_THRESHOLD = 90;

// Display-layer smoothing for repeat scoring of the same (job, user) —
// dampens run-to-run llm_score noise (observed 94->14 swings on unchanged
// input, see ai-scoring.md §8.7) without spending an extra LLM call.
// Sub-scores (llmScore/embeddingScore/ruleScore) are stored unsmoothed.
const SMOOTHING_NEW_WEIGHT = 0.7;
const SMOOTHING_OLD_WEIGHT = 0.3;

export async function processScoringMatch(job: Job<ScoringMatchPayload>): Promise<void> {
  const { jobId, userId } = job.data;
  const traceId = job.id!;

  const allowed = await canScore(userId);
  if (!allowed) {
    logger.warn({ event: 'scoring_quota_exceeded', userId, jobId, traceId });
    return;
  }

  const [profile, jobRecord, jobEmbedding] = await Promise.all([
    prisma.userProfile.findUniqueOrThrow({ where: { userId } }),
    prisma.job.findUniqueOrThrow({ where: { id: jobId } }),
    getJobEmbedding(jobId),
  ]);

  if (!jobEmbedding) {
    throw new Error(`Job ${jobId} has no embedding yet`);
  }

  let profileEmbedding = await getProfileEmbedding(userId);
  if (!profileEmbedding) {
    const profileText = buildProfileText(profile);
    profileEmbedding = await generateEmbedding(profileText);
    await upsertProfileEmbedding(userId, profileEmbedding);
  }

  const result = await scoreJob(profile, jobRecord, {
    profile: profileEmbedding,
    job: jobEmbedding,
  });

  const existingScore = await prisma.jobScore.findUnique({
    where: { jobId_userId: { jobId, userId } },
  });

  // First-time scoring has no history to blend against — using the raw
  // value there avoids artificially pulling a cold-start score up or down.
  const score = existingScore
    ? Math.round(SMOOTHING_NEW_WEIGHT * result.score + SMOOTHING_OLD_WEIGHT * existingScore.score)
    : result.score;
  const decision = toDecision(score, result.eligibility);

  await prisma.jobScore.upsert({
    where: { jobId_userId: { jobId, userId } },
    create: { jobId, userId, ...result, score, decision },
    update: { ...result, score, decision, updatedAt: new Date() },
  });

  if (!existingScore) {
    await incrementUsage(userId);
  }

  logger.info({
    event: 'scoring_complete',
    jobId,
    userId,
    score,
    decision,
    traceId,
  });

  // Instant high-match email (score >= 80 + APPLY) is retired — high-match
  // jobs now surface via Opportunity Discovery in the next day's Career
  // Brief instead. A score this high specifically (>=90) still gets a
  // real-time reaction, just via an agent handoff instead of an email — see
  // AGENT_HANDOFF_SCORE_THRESHOLD above.
  if (score >= AGENT_HANDOFF_SCORE_THRESHOLD) {
    const verified = await reverifyHighScore(profile, jobRecord, result);
    if (verified) {
      await getAgentHandoffQueue().add(
        'handoff',
        { jobId, userId, matchScore: score },
        { ...AGENT_HANDOFF_JOB_OPTS, jobId: `handoff:${jobId}:${userId}` },
      );
    } else {
      logger.info({ event: 'agent_handoff_reverify_failed', jobId, userId, traceId });
    }
  }
}

// A single llm_score sample isn't reliable enough to justify proactively
// interrupting the user with an agent handoff (see ai-scoring.md §8.7 —
// smoothing doesn't help here since this fires on first-time/low-to-high
// scoring, which has no prior score to blend against). This is the one
// place allowed to spend a second LLM call on the same job: the >=90
// threshold is already a rare tail, so re-verifying it doesn't meaningfully
// change overall LLM cost.
async function reverifyHighScore(
  profile: ProfileInput,
  jobRecord: JobInput,
  result: ScoringResult,
): Promise<boolean> {
  const secondSample = await computeLLMScore(profile, jobRecord);
  if (!secondSample) return false;

  const avgLlmScore = (result.llmScore + secondSample.score) / 2;
  const verifiedScore = computeFinalScore(
    avgLlmScore,
    result.embeddingScore,
    result.ruleScore,
    getEmbeddingConfidence(),
  );
  return verifiedScore >= AGENT_HANDOFF_SCORE_THRESHOLD;
}
