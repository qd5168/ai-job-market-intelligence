import { z } from 'zod';
import { Octokit } from '@octokit/rest';
import { getOpenRouterClient } from '../openrouter-client';
import { parseLLMJson } from '../parse-llm-json';
import {
  GITHUB_SUMMARY_SYSTEM_PROMPT,
  buildGithubSummaryUserPrompt,
} from '../prompts/github-summary';
import { callWithFallback } from '../fallback';

const DEFAULT_LLM_MODEL = 'gpt-4o-mini';
const MAX_REPOS_FOR_LANGUAGES = 15;
const MAX_REPOS_FOR_README = 3;

const GithubSummaryOutputSchema = z.object({
  summary: z.string().min(1).max(1000),
});

export interface GithubParseResult {
  languages: Record<string, number>;
  summary: string | null;
}

let octokit: Octokit | undefined;

function getOctokit(): Octokit {
  octokit ??= new Octokit({ auth: process.env.GITHUB_TOKEN });
  return octokit;
}

async function fetchReadmeExcerpt(owner: string, repo: string): Promise<string | null> {
  try {
    const { data } = await getOctokit().rest.repos.getReadme({ owner, repo });
    return Buffer.from(data.content, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

async function callLLM(
  model: string,
  username: string,
  repos: { name: string; description: string | null; readmeExcerpt: string | null }[],
): Promise<string> {
  const response = await getOpenRouterClient().chat.completions.create({
    model,
    temperature: 0.3,
    // Headroom for qwen3.7-flash (paid fallback), which ignores
    // response_format and opens with unprompted commentary — see
    // parse-llm-json.ts and llm-score.ts's callLLM for the same issue.
    max_tokens: 800,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: GITHUB_SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: buildGithubSummaryUserPrompt(username, repos) },
    ],
  });

  const content = response.choices[0]?.message.content;
  if (!content) throw new Error('LLM returned empty response');

  return GithubSummaryOutputSchema.parse(parseLLMJson(content)).summary;
}

// Returns null when the free model (and, if configured and within budget,
// the paid fallback) both fail — the caller proceeds
// without a summary rather than blocking the rest of profile parsing.
async function summarizeRepos(
  username: string,
  repos: { name: string; description: string | null; readmeExcerpt: string | null }[],
): Promise<string | null> {
  if (repos.length === 0) return null;

  return callWithFallback(
    (model) => callLLM(model, username, repos),
    {
      primary: process.env.CHAT_MODEL ?? DEFAULT_LLM_MODEL,
      fallback: process.env.CHAT_MODEL_FALLBACK,
    },
    (model, attempt, error) =>
      console.error(`[parse-github] attempt ${attempt} (${model}) failed:`, error),
  );
}

// Uses only the public GitHub REST API (no OAuth) — GITHUB_TOKEN is a PAT used
// solely to raise the rate limit (60/h unauthenticated -> 5000/h), not to
// access anything private. Returns null on any failure (user not found, rate
// limited) so the caller can proceed without blocking the rest of profile
// parsing.
export async function fetchGithubProfile(username: string): Promise<GithubParseResult | null> {
  let repos;
  try {
    const { data } = await getOctokit().rest.repos.listForUser({
      username,
      sort: 'updated',
      per_page: MAX_REPOS_FOR_LANGUAGES,
    });
    repos = data.filter((r) => !r.fork);
  } catch {
    return null;
  }

  if (repos.length === 0) {
    return { languages: {}, summary: null };
  }

  const languageResults = await Promise.all(
    repos.map(async (repo) => {
      try {
        const { data } = await getOctokit().rest.repos.listLanguages({
          owner: username,
          repo: repo.name,
        });
        return data;
      } catch {
        return {};
      }
    }),
  );

  const languages: Record<string, number> = {};
  for (const result of languageResults) {
    for (const [lang, bytes] of Object.entries(result)) {
      languages[lang] = (languages[lang] ?? 0) + bytes;
    }
  }

  const readmeRepos = repos.slice(0, MAX_REPOS_FOR_README);
  const reposWithReadme = await Promise.all(
    readmeRepos.map(async (repo) => ({
      name: repo.name,
      description: repo.description,
      readmeExcerpt: await fetchReadmeExcerpt(username, repo.name),
    })),
  );

  const summary = await summarizeRepos(username, reposWithReadme);

  return { languages, summary };
}
