import { z } from 'zod';
import { JobDecisionSchema, JobEligibilitySchema } from './job';

export const ScoreBreakdownSchema = z.object({
  llmScore: z.number(),
  embeddingScore: z.number(),
  ruleScore: z.number(),
});

export const ScoreResponseSchema = z.object({
  score: z.number().int(),
  decision: JobDecisionSchema,
  eligibility: JobEligibilitySchema,
  reasoning: z.string(),
  strengths: z.array(z.string()),
  skillGap: z.array(z.string()),
  breakdown: ScoreBreakdownSchema,
  scoringVersion: z.string(),
  createdAt: z.string().datetime(),
});
export type ScoreResponse = z.infer<typeof ScoreResponseSchema>;
