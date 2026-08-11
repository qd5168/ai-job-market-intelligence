import { decodeHTML } from 'entities';
import { stripHtml } from '../../utils/strip-html';
import { IngestionError } from '../errors';
import type { JobSourceAdapter, NormalizedJob } from '../types';

const MIN_DESCRIPTION_LENGTH = 50;

interface GreenhouseRawJob {
  id: number;
  title: string;
  location: { name: string };
  content: string;
  absolute_url: string;
  updated_at: string;
}

// company: the ats_companies-registered display name — a single Greenhouse
// board never returns its own company name in the response body.
interface GreenhouseFetchResult {
  company: string;
  job: GreenhouseRawJob;
}

// One call per company, fanned out by the ingestion_collect batch trigger
// reading `ats_companies` — this adapter no longer loops over a static
// GREENHOUSE_COMPANY_SLUGS whitelist.
async function fetchGreenhouse(companySlug?: string): Promise<GreenhouseFetchResult[]> {
  if (!companySlug) return [];

  const res = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${companySlug}/jobs?content=true`,
    {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!res.ok) {
    if (res.status >= 500)
      throw new IngestionError(`Greenhouse API returned ${res.status} for ${companySlug}`, {
        retryable: true,
      });
    return []; // 404 etc — the caller tracks company validity via probeOfficialApi, not this
  }

  const data = (await res.json()) as { jobs?: GreenhouseRawJob[] };
  return (data.jobs ?? []).map((job) => ({ company: companySlug, job }));
}

function normalizeGreenhouseJob(raw: GreenhouseFetchResult): NormalizedJob | null {
  const { company, job } = raw;
  if (!job?.id || !job.title?.trim()) return null;

  // For a subset of postings (varies per-job, not per-company — depends on
  // how that specific listing's content was authored in Greenhouse's rich
  // text editor), `content` comes back HTML-entity-escaped one level too
  // many, e.g. `&lt;p&gt;...&lt;/p&gt;` instead of `<p>...</p>`. Fed straight
  // into stripHtml(), that escaped markup is parsed as plain text — the
  // HTML parser still decodes the entities (producing literal `<p>` in the
  // output), but never recognizes it as real tag structure, so nothing
  // actually gets stripped and the tags leak into the stored description.
  // Decoding once here first is a no-op for the normal (already-real-HTML)
  // case and fixes the escaped case.
  const description = stripHtml(decodeHTML(job.content ?? ''));
  if (description.length < MIN_DESCRIPTION_LENGTH) return null;

  return {
    externalId: String(job.id),
    source: 'GREENHOUSE',
    title: job.title.trim(),
    company,
    description,
    url: job.absolute_url,
    location: job.location?.name?.trim() || 'Remote',
    tags: [],
    postedAt: job.updated_at ? new Date(job.updated_at) : null,
  };
}

export const greenhouseAdapter: JobSourceAdapter = {
  source: 'GREENHOUSE',
  tier: 1,
  fetch: fetchGreenhouse,
  normalize: (raw) => normalizeGreenhouseJob(raw as GreenhouseFetchResult),
};
