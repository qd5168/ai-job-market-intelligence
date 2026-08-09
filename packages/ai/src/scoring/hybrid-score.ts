import type { JobDecision, JobEligibility } from '@ai-job-market-intelligence/shared';
import { CURRENT_SCORING_VERSION } from '@ai-job-market-intelligence/shared/constants';
import { containsInjectionPattern } from '@ai-job-market-intelligence/shared/security';
import { computeEmbeddingScore } from '../embeddings/similarity';
import type { JobInput, ProfileInput } from '../types';
import { computeRuleScore, computeEligibility } from './rule-score';
import { computeLLMScore, type LLMScoreResult } from './llm-score';
import { toDecision } from './decision';
import { getEmbeddingConfidence, EMBEDDING_CONFIDENCE_THRESHOLD } from './embedding-health';

// The ingestion-time filter is the "before" line of defense — this is the
// "after" backstop in case some new injection technique slips past it.
// Reuses the same pattern list rather than maintaining a second one.
function isSuspectedInjection(result: LLMScoreResult): boolean {
  return (
    containsInjectionPattern(result.reasoning) ||
    result.strengths.some(containsInjectionPattern) ||
    result.skillGap.some(containsInjectionPattern)
  );
}

export interface ScoringResult {
  score: number;
  decision: JobDecision;
  eligibility: JobEligibility;
  reasoning: string;
  strengths: string[];
  skillGap: string[];
  llmScore: number;
  embeddingScore: number;
  ruleScore: number;
  scoringVersion: typeof CURRENT_SCORING_VERSION;
}

// Skipping the LLM entirely on a fixed embedding<20 && rule<30 threshold
// (the previous design) turned out to be dangerous: when embeddingScore is
// systemically low for an unrelated reason (a stale profile embedding that
// silently never regenerated — see embedding-health.ts), it drives nearly
// every score below the threshold and the LLM never gets called at all
// (a real incident: 97.8% of a user's scores never called the LLM).
// Skipping is now gated on embedding health (Fail-Open when unhealthy) and
// requires eligibility to be independently confirmed bad too, with a
// constant sample rate still routed to a real LLM call for calibration.
const SKIP_SAMPLE_RATE = 0.08;
const SKIP_ELIGIBILITY_RULE_SCORE_THRESHOLD = 25;

// Default weights assume embedding is trustworthy. When embedding health is
// degraded, weight shifts away from it toward LLM/rule (Fail-Open) rather
// than continuing to trust a signal known to be behaving abnormally.
const DEFAULT_WEIGHTS = { llm: 0.4, embedding: 0.4, rule: 0.2 };
const DEGRADED_WEIGHTS = { llm: 0.6, embedding: 0.1, rule: 0.3 };

export function computeFinalScore(
  llmScore: number,
  embeddingScore: number,
  ruleScore: number,
  embeddingConfidence: number,
): number {
  const weights =
    embeddingConfidence >= EMBEDDING_CONFIDENCE_THRESHOLD ? DEFAULT_WEIGHTS : DEGRADED_WEIGHTS;
  const raw =
    weights.llm * llmScore + weights.embedding * embeddingScore + weights.rule * ruleScore;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

export async function scoreJob(
  profile: ProfileInput,
  job: JobInput,
  embeddings: { profile: number[]; job: number[] },
): Promise<ScoringResult> {
  const embeddingScore = computeEmbeddingScore(embeddings.profile, embeddings.job);
  const ruleScore = computeRuleScore(profile, job);
  const eligibility = computeEligibility(profile, job);
  const embeddingConfidence = getEmbeddingConfidence();

  const meetsSkipCriteria =
    embeddingConfidence >= EMBEDDING_CONFIDENCE_THRESHOLD &&
    eligibility === 'INELIGIBLE' &&
    ruleScore < SKIP_ELIGIBILITY_RULE_SCORE_THRESHOLD;

  if (meetsSkipCriteria) {
    if (Math.random() >= SKIP_SAMPLE_RATE) {
      return buildHighConfidenceSkipResult(embeddingScore, ruleScore, eligibility);
    }
    // Sampled back into a real LLM call despite qualifying to skip — used to
    // continuously calibrate whether these thresholds are still right, not
    // just to reduce cost. The real call below still happens and its result
    // is what gets used, not a discarded "for comparison only" extra call.
    console.info({
      event: 'scoring_skip_sampled_for_calibration',
      title: job.title,
      company: job.company,
    });
  }

  const llmResult = await computeLLMScore(profile, job);
  const injectionSuspected = llmResult !== null && isSuspectedInjection(llmResult);

  if (injectionSuspected) {
    // Discard the (possibly manipulated) output and log for manual review —
    // don't retry the LLM (the same payload would likely get poisoned again)
    // and don't surface anything to the user, so as not to tip off whoever
    // is probing the filter.
    console.warn({
      event: 'llm_output_injection_suspected',
      title: job.title,
      company: job.company,
    });
  }

  if (!llmResult || injectionSuspected) {
    // Fall back to rule_score when the LLM fails entirely, or its output is
    // discarded as suspected prompt injection
    const finalScore = computeFinalScore(ruleScore, embeddingScore, ruleScore, embeddingConfidence);
    return {
      score: finalScore,
      decision: toDecision(finalScore),
      eligibility,
      reasoning:
        'AI analysis temporarily unavailable. Score based on skill and experience matching.',
      strengths: [],
      skillGap: [],
      llmScore: ruleScore,
      embeddingScore,
      ruleScore,
      scoringVersion: CURRENT_SCORING_VERSION,
    };
  }

  const finalScore = computeFinalScore(
    llmResult.score,
    embeddingScore,
    ruleScore,
    embeddingConfidence,
  );

  return {
    score: finalScore,
    decision: toDecision(finalScore),
    eligibility,
    reasoning: llmResult.reasoning,
    strengths: llmResult.strengths,
    skillGap: llmResult.skillGap,
    llmScore: llmResult.score,
    embeddingScore,
    ruleScore,
    scoringVersion: CURRENT_SCORING_VERSION,
  };
}

// Skip-the-LLM fallback — llmScore uses ruleScore as a stand-in, matching
// the same convention as the "LLM failed entirely" fallback above, rather
// than inventing a separate null/0 semantic for a third case.
function buildHighConfidenceSkipResult(
  embeddingScore: number,
  ruleScore: number,
  eligibility: JobEligibility,
): ScoringResult {
  const llmScore = ruleScore;
  const score = Math.round(0.3 * embeddingScore + 0.7 * ruleScore);

  return {
    score,
    decision: 'SKIP',
    eligibility,
    reasoning:
      'Not evaluated by AI: this role requires eligibility the profile does not meet, ' +
      'and the rule-based skill/experience match is very weak.',
    strengths: [],
    skillGap: [],
    llmScore,
    embeddingScore,
    ruleScore,
    scoringVersion: CURRENT_SCORING_VERSION,
  };
}
