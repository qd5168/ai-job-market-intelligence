// Detects "embedding score systemically low across many scores" (a real
// production incident: 97.8% of scores never called the LLM because
// embeddingScore was near-zero for nearly everything, due to a stale
// profile embedding that was silently never regenerated after profile
// edits). Once detected, scoring switches to Fail-Open: never skip the LLM,
// and shift weight away from embedding toward LLM/rule (see hybrid-score.ts).
//
// Deliberately a simple ratio threshold, not a statistical baseline/z-score
// — this project consistently favors deterministic rules over statistical
// models elsewhere (skill matching, F6/F7 keyword filters, region parsing)
// for the same reason: easier to debug, no "how is the baseline computed/how
// often does it recompute" complexity to maintain.
//
// The actual `job_scores` query that feeds this lives in apps/worker
// (packages/ai deliberately has no Prisma dependency) — this module only
// owns the pure threshold decision and the process-local cache.
//
// Single Worker instance in production (cron dedup depends on this), so a
// process-local variable is sufficient — no Redis/extra state table needed.
// Cold start defaults to "healthy" rather than Fail-Open, so a restart
// doesn't force a temporary all-jobs-call-the-LLM burst; if embedding really
// is unhealthy, the next refresh cycle re-detects it.
const HEALTHY_CONFIDENCE = 1.0;
const DEGRADED_CONFIDENCE = 0.3;
export const EMBEDDING_CONFIDENCE_THRESHOLD = 0.7;

const LOW_EMBEDDING_SCORE_THRESHOLD = 20;
const LOW_RATIO_UNHEALTHY_THRESHOLD = 0.6;
const MIN_SAMPLE_SIZE = 50;

let cachedConfidence = HEALTHY_CONFIDENCE;

export function getEmbeddingConfidence(): number {
  return cachedConfidence;
}

export interface RecentEmbeddingScoreSample {
  embeddingScore: number;
}

// Takes the already-fetched sample (most recent ~500 job_scores) rather than
// querying itself — see the module comment for why. Too few samples to judge
// confidently just keeps the previous value rather than guessing.
export function updateEmbeddingConfidence(samples: RecentEmbeddingScoreSample[]): number {
  if (samples.length < MIN_SAMPLE_SIZE) return cachedConfidence;

  const lowRatio =
    samples.filter((s) => s.embeddingScore < LOW_EMBEDDING_SCORE_THRESHOLD).length / samples.length;
  const wasHealthy = cachedConfidence >= EMBEDDING_CONFIDENCE_THRESHOLD;
  cachedConfidence =
    lowRatio > LOW_RATIO_UNHEALTHY_THRESHOLD ? DEGRADED_CONFIDENCE : HEALTHY_CONFIDENCE;

  if (wasHealthy && cachedConfidence < EMBEDDING_CONFIDENCE_THRESHOLD) {
    console.warn({
      event: 'embedding_health_degraded',
      lowRatio,
      sampleSize: samples.length,
    });
  } else if (!wasHealthy && cachedConfidence >= EMBEDDING_CONFIDENCE_THRESHOLD) {
    console.info({
      event: 'embedding_health_recovered',
      lowRatio,
      sampleSize: samples.length,
    });
  }

  return cachedConfidence;
}
