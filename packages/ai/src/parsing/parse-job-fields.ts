import { z } from 'zod';
import { getOpenRouterClient } from '../openrouter-client';
import { parseLLMJson } from '../parse-llm-json';
import { JOB_PARSING_SYSTEM_PROMPT, buildJobParsingUserPrompt } from '../prompts/job-parsing';
import { callWithFallback } from '../fallback';
import type { ParsedJobFields } from '@ai-job-market-intelligence/shared/ingestion';
import { inferEligibleRegionsFromText } from '@ai-job-market-intelligence/shared/regions';

// OpenRouter model slugs require a 'vendor/' prefix — a bare model name gets
// rejected with a 400 (see packages/ai/src/scoring/llm-score.ts for the same
// issue and fix).
// Non-reasoning instruct model (see packages/ai/src/scoring/llm-score.ts) —
// avoids the empty-content failure mode reasoning models like gpt-oss-20b hit
// when chain-of-thought exhausts the token budget before final content.
const DEFAULT_LLM_MODEL = 'google/gemma-4-26b-a4b-it:free';

const JobLevelSchema = z.enum(['Junior', 'Mid', 'Senior', 'Staff', 'Principal', 'Unknown']);
const RegionBucketSchema = z.enum(['US', 'EU', 'UK', 'APAC', 'LATAM', 'REMOTE_GLOBAL', 'OTHER']);
const MAX_SKILLS = 30;
const MAX_ELIGIBLE_REGIONS = 7;

const JobParseOutputSchema = z.object({
  role: z.string().max(100),
  level: JobLevelSchema,
  // Some models (observed with qwen3-30b-a3b-instruct-2507 as a paid
  // fallback) extract more than MAX_SKILLS — truncate rather than reject
  // the entire response over a count, matching the `remote` field's
  // degrade-gracefully approach below instead of a hard .max() reject.
  skills: z.array(z.string()).transform((arr) => arr.slice(0, MAX_SKILLS)),
  salaryMin: z.number().int().nullable(),
  salaryMax: z.number().int().nullable(),
  // Prompted as a plain boolean, but weaker free models return null when the
  // posting doesn't make remote status clear — nullable+transform absorbs
  // that instead of rejecting the entire response (role/skills/salaryMin/
  // salaryMax/eligibleRegions/confidence) over this one ambiguous field.
  // EMPTY_RESULT's own remote default is also false.
  remote: z
    .boolean()
    .nullable()
    .transform((v) => v ?? false),
  // Same idea: some models invent a label that isn't one of our known
  // buckets (observed: a raw timezone like "EST") — drop just that entry
  // instead of rejecting the whole response over one bad array element.
  eligibleRegions: z
    .array(z.string())
    .transform((arr) =>
      arr
        .filter(
          (v): v is z.infer<typeof RegionBucketSchema> => RegionBucketSchema.safeParse(v).success,
        )
        .slice(0, MAX_ELIGIBLE_REGIONS),
    ),
  confidence: z.number().min(0).max(1),
});

export interface ParseJobFieldsInput {
  title: string;
  description: string;
  tags: string[];
}

const EMPTY_RESULT: ParsedJobFields = {
  role: '',
  level: 'Unknown',
  skills: [],
  salaryMin: null,
  salaryMax: null,
  remote: false,
  eligibleRegions: [],
  confidence: 0,
};

async function callLLM(model: string, input: ParseJobFieldsInput): Promise<ParsedJobFields> {
  const response = await getOpenRouterClient().chat.completions.create({
    model,
    temperature: 0.2,
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
      { role: 'system', content: JOB_PARSING_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildJobParsingUserPrompt(input.title, input.description, input.tags),
      },
    ],
  });

  const message = response.choices[0]?.message;
  // Some free OpenRouter models put their answer in a non-standard
  // `reasoning` field and leave `content` null instead of respecting
  // response_format — fall back to it before giving up.
  const content = message?.content ?? (message as { reasoning?: string } | undefined)?.reasoning;
  if (!content) throw new Error('LLM returned empty response');

  return JobParseOutputSchema.parse(parseLLMJson(content));
}

// Never throws: JSON/schema failures (and, if a paid fallback is configured
// and within budget, its own failure too) fall back to
// a confidence=0 result so ingestion is never blocked by a bad LLM response.
export async function parseJobFields(input: ParseJobFieldsInput): Promise<ParsedJobFields> {
  const result = await callWithFallback(
    (model) => callLLM(model, input),
    {
      primary: process.env.CHAT_MODEL ?? DEFAULT_LLM_MODEL,
      fallback: process.env.CHAT_MODEL_FALLBACK,
    },
    (model, attempt, error) =>
      console.error(`[parse-job-fields] attempt ${attempt} (${model}) failed:`, error),
  );
  const parsed = result ?? EMPTY_RESULT;

  // The LLM's own eligibleRegions extraction sometimes misses an explicit
  // restriction despite the prompt covering it (and total LLM failure
  // leaves EMPTY_RESULT's eligibleRegions empty too) — fall back to the same
  // deterministic detector used for sourceStructured sources rather than
  // trusting an empty array as "no restriction stated".
  if (parsed.eligibleRegions.length === 0) {
    const inferred = inferEligibleRegionsFromText(`${input.title} ${input.description}`);
    if (inferred.length > 0) return { ...parsed, eligibleRegions: inferred };
  }

  return parsed;
}
