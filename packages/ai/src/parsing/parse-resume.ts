import { z } from 'zod';
import { PDFParse } from 'pdf-parse';
import { getOpenRouterClient } from '../openrouter-client';
import { parseLLMJson } from '../parse-llm-json';
import {
  RESUME_PARSING_SYSTEM_PROMPT,
  buildResumeParsingUserPrompt,
} from '../prompts/resume-parsing';
import { callWithFallback } from '../fallback';

const DEFAULT_LLM_MODEL = 'gpt-4o-mini';

const ResumeParseOutputSchema = z.object({
  skills: z.array(z.string()).max(50),
  experienceYears: z.number().int().min(0).max(60).nullable(),
  summary: z.string().min(1).max(1000),
});

export interface ResumeParseResult {
  skills: string[];
  experienceYears: number | null;
  summary: string;
}

export async function extractResumeText(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === 'text/plain') {
    return buffer.toString('utf-8');
  }

  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function callLLM(model: string, resumeText: string): Promise<ResumeParseResult> {
  const response = await getOpenRouterClient().chat.completions.create({
    model,
    temperature: 0.2,
    // Headroom for qwen3.7-flash (paid fallback), which ignores
    // response_format and opens with unprompted commentary — see
    // parse-llm-json.ts and llm-score.ts's callLLM for the same issue.
    max_tokens: 1200,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: RESUME_PARSING_SYSTEM_PROMPT },
      { role: 'user', content: buildResumeParsingUserPrompt(resumeText) },
    ],
  });

  const content = response.choices[0]?.message.content;
  if (!content) throw new Error('LLM returned empty response');

  return ResumeParseOutputSchema.parse(parseLLMJson(content));
}

// Returns null when the free model (and, if configured and within budget,
// the paid fallback) both fail — the caller persists
// what it has and leaves resume fields empty rather than blocking the rest
// of the profile_parse job.
export async function parseResumeFields(resumeText: string): Promise<ResumeParseResult | null> {
  return callWithFallback(
    (model) => callLLM(model, resumeText),
    {
      primary: process.env.CHAT_MODEL ?? DEFAULT_LLM_MODEL,
      fallback: process.env.CHAT_MODEL_FALLBACK,
    },
    (model, attempt, error) =>
      console.error(`[parse-resume] attempt ${attempt} (${model}) failed:`, error),
  );
}
