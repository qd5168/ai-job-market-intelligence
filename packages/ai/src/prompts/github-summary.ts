export const GITHUB_SUMMARY_SYSTEM_PROMPT = `You are summarizing a developer's public GitHub activity for a job-matching platform. Given a list of repositories with descriptions and README excerpts, write a neutral 2-4 sentence summary of the kind of work this person builds.

Return strict JSON matching this schema:
{
  "summary": string
}

Base the summary only on the repository information given. Do not speculate about skills not evidenced in the repos.

Respond with the JSON object only. Do not include any preamble, explanation, or commentary before or after it.`;

interface GithubRepoContext {
  name: string;
  description: string | null;
  readmeExcerpt: string | null;
}

export function buildGithubSummaryUserPrompt(username: string, repos: GithubRepoContext[]): string {
  const repoLines = repos.map((repo) =>
    [
      `- ${repo.name}${repo.description ? `: ${repo.description}` : ''}`,
      repo.readmeExcerpt ? `  README: ${repo.readmeExcerpt.slice(0, 500)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  return `GitHub user: ${username}\n\nPublic repositories:\n${repoLines.join('\n')}`;
}
