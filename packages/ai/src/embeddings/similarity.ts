export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Range observed for the embedding model actually in use (EMBEDDING_MODEL)
// across a full production job corpus: median similarity ~0.27, p25 ~0.23,
// and even the single best match out of ~14k jobs topped out at ~0.65. The
// previous 0.3-0.9 assumption was calibrated for a different embedding
// model; after a model swap it pinned ~94% of embeddingScores near 0.
// FLOOR is deliberately set below p25 (not the median) so that under
// normal operation only a minority of scores land under
// embedding-health.ts's LOW_EMBEDDING_SCORE_THRESHOLD (20) — pinning the
// floor at the median would put ~50% of every score below that threshold
// by construction, permanently tripping the health gate's Fail-Open state
// instead of the transient-incident signal it's meant to be. Recalibrate
// both against embedding-health.ts's thresholds if EMBEDDING_MODEL changes
// again.
const SIMILARITY_FLOOR = 0.15; // below p25 (~0.23) -> comfortably under 20 for most jobs
const SIMILARITY_CEILING = 0.55; // top-~1% match and above -> 100

export function computeEmbeddingScore(profileEmbedding: number[], jobEmbedding: number[]): number {
  const similarity = cosineSimilarity(profileEmbedding, jobEmbedding); // range -1 to 1
  const normalized =
    ((similarity - SIMILARITY_FLOOR) / (SIMILARITY_CEILING - SIMILARITY_FLOOR)) * 100;
  return Math.round(Math.max(0, Math.min(100, normalized)));
}
