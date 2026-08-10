import { z } from 'zod';
import { getOpenRouterClient } from '../openrouter-client';
import { parseLLMJson } from '../parse-llm-json';
import { SCORING_SYSTEM_PROMPT } from '../prompts/scoring-system';
import { buildScoringUserPrompt } from '../prompts/scoring-user';
import { callWithFallback } from '../fallback';
import type { JobInput, ProfileInput } from '../types';

// Non-reasoning instruct model (see packages/ai/src/parsing/parse-job-fields.ts) —
// avoids the empty-content failure mode reasoning models like gpt-oss-20b hit
// when chain-of-thought exhausts the token budget before final content.
const DEFAULT_LLM_MODEL = 'google/gemma-4-26b-a4b-it:free';

const LLMScoreOutputSchema = z.object({
  score: z.number().int().min(0).max(100),
  reasoning: z.string().min(10).max(300),
  strengths: z.array(z.string()).max(6),
  skill_gap: z.array(z.string()).max(10),
});

export interface LLMScoreResult {
  score: number;
  reasoning: string;
  strengths: string[];
  skillGap: string[];
}

async function callLLM(
  model: string,
  profile: ProfileInput,
  job: JobInput,
): Promise<LLMScoreResult> {
  const response = await getOpenRouterClient().chat.completions.create({
    model,
    // 0 (was 0.2) to converge the sampling-driven half of run-to-run score
    // noise — observed llm_score swings of 94->14 on unchanged input go
    // beyond what temperature alone explains (see ai-scoring.md §8.7), so
    // this alone isn't a full fix, just the cheap first layer of one.
    temperature: 0,
    // gpt-oss-20b is a reasoning model: with a tight token budget it can burn
    // the whole budget on chain-of-thought and return empty `content`.
    // reasoning_effort caps that spend, and the higher max_tokens leaves
    // headroom for the final JSON after reasoning. Also needs headroom for
    // qwen3.7-flash (paid fallback), which ignores response_format and
    // opens with unprompted commentary ("Here's a thorough analysis...")
    // that was getting truncated before any JSON ever appeared — see
    // parse-llm-json.ts.
    max_tokens: 2000,
    reasoning_effort: 'low',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SCORING_SYSTEM_PROMPT },
      { role: 'user', content: buildScoringUserPrompt(profile, job) },
    ],
  });

  const message = response.choices[0]?.message;
  // Some free OpenRouter models put their answer in a non-standard
  // `reasoning` field and leave `content` null instead of respecting
  // response_format — fall back to it before giving up.
  const content = message?.content ?? (message as { reasoning?: string } | undefined)?.reasoning;
  if (!content) throw new Error('LLM returned empty response');

  const parsed = LLMScoreOutputSchema.parse(parseLLMJson(content));
  return {
    score: parsed.score,
    reasoning: parsed.reasoning,
    strengths: parsed.strengths,
    skillGap: parsed.skill_gap,
  };
}

// Returns null when the free model (and, if configured and within budget, the
// paid fallback) both fail — the caller falls back to
// rule_score in that case.
export async function computeLLMScore(
  profile: ProfileInput,
  job: JobInput,
): Promise<LLMScoreResult | null> {
  return callWithFallback(
    (model) => callLLM(model, profile, job),
    {
      primary: process.env.CHAT_MODEL ?? DEFAULT_LLM_MODEL,
      fallback: process.env.CHAT_MODEL_FALLBACK,
    },
    (model, attempt, error) =>
      console.error(`[llm-score] attempt ${attempt} (${model}) failed:`, error),
  );
}
