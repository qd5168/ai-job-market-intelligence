import type { Job } from 'bullmq';
import { prisma, upsertCompany } from '@ai-job-market-intelligence/db';
import {
  getAdapterBySource,
  passesFilter,
  probeOfficialApi,
  currentCadenceBucket,
  type NormalizedJob,
} from '@ai-job-market-intelligence/shared/ingestion';
import { stripInjectionText } from '@ai-job-market-intelligence/shared/security';
import type { JobSource } from '@ai-job-market-intelligence/shared';
import type { AtsSource } from '@ai-job-market-intelligence/shared';
import {
  getIngestionParseQueue,
  INGESTION_PARSE_JOB_OPTS,
} from '@ai-job-market-intelligence/shared/queue';
import { logger } from '../logger.js';
import { refreshEmbeddingHealth } from '../lib/embedding-health.js';
import {
  getIngestionCollectQueue,
  type IngestionCollectPayload,
} from '../queues/ingestion-collect.js';

// Greenhouse/Lever/Ashby are "per company" sources — their jobs are fanned
// out from `ats_companies` instead of a single whole-source call.
// RemoteOK/Himalayas stay whole-source.
const PER_COMPANY_SOURCES: readonly JobSource[] = ['GREENHOUSE', 'LEVER', 'ASHBY'];

// After this many consecutive probe failures a company is presumed gone
// (board deleted/renamed) and stops being checked until manually revalidated
// by a future Company Discovery pass.
const CONSECUTIVE_FAILURE_THRESHOLD = 5;

// BullMQ rejects a custom jobId containing ':' unless splitting on ':'
// yields exactly 3 parts (kept only for backwards compat with the old
// repeat:<hash>:<timestamp> id scheme — see bullmq's classes/job.js). Some
// sources could plausibly use a URL-shaped externalId (containing its own
// ':'), so external IDs are sanitized before being embedded in a jobId.
function toJobIdSegment(value: string): string {
  return value.replace(/:/g, '_');
}

function isPerCompanySource(source: JobSource): source is AtsSource {
  return PER_COMPANY_SOURCES.includes(source);
}

// Removes a suspected prompt-injection sentence from the description (see
// packages/shared/src/security) rather than rejecting the whole posting —
// most flagged postings are otherwise-real jobs with one injected sentence
// appended, not fabricated end to end.
function sanitizeNormalized(
  normalized: NormalizedJob,
  source: JobSource,
  traceId: string,
): NormalizedJob {
  const { cleaned, stripped } = stripInjectionText(normalized.description);
  if (!stripped) return normalized;

  logger.info({
    event: 'ingestion_injection_stripped',
    source,
    externalId: normalized.externalId,
    traceId,
  });
  return { ...normalized, description: cleaned };
}

// This processor only fetches + normalizes + filters, then hands each
// candidate to ingestion_parse (AI Job Parsing + embedding + cross-source
// dedup + upsert) — one adapter per cron job, so a single source's failure
// never blocks the other four.
export async function processIngestionCollect(job: Job<IngestionCollectPayload>): Promise<void> {
  const source = job.data.source as JobSource;
  const { companySlug } = job.data;

  // Rides this cron's ~30min cadence rather than a dedicated queue — cheap
  // (one capped query) and idempotent, so firing once per source's tick
  // (a few times within any 30min window) is fine.
  await refreshEmbeddingHealth();

  if (isPerCompanySource(source) && !companySlug) {
    await processBatchTrigger(job, source);
    return;
  }

  if (isPerCompanySource(source)) {
    await processCompanyCollect(job, source, companySlug!);
    return;
  }

  await processAggregatorCollect(job, source);
}

// The 30min trigger job — pick this cycle's cadence_bucket slice of ACTIVE
// companies for `source` and fan out one sub-task each.
async function processBatchTrigger(
  job: Job<IngestionCollectPayload>,
  source: AtsSource,
): Promise<void> {
  const traceId = job.id!;
  const bucket = currentCadenceBucket();

  const companies = await prisma.atsCompany.findMany({
    where: { source, status: 'ACTIVE', cadenceBucket: bucket },
    select: { slug: true },
  });

  const queue = getIngestionCollectQueue();
  for (const { slug } of companies) {
    await queue.add(
      'collect',
      { source, companySlug: slug },
      {
        jobId: `ingestion-collect:${source}:${slug}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  logger.info({
    event: 'ingestion_batch_trigger',
    source,
    traceId,
    bucket,
    companiesFanned: companies.length,
  });
}

// One company's worth of postings — fetch, normalize, filter, enqueue parse,
// detect closures, and update ats_companies health (lastSuccessAt /
// consecutiveFailures / INACTIVE demotion).
async function processCompanyCollect(
  job: Job<IngestionCollectPayload>,
  source: AtsSource,
  companySlug: string,
): Promise<void> {
  const traceId = job.id!;
  const startedAt = Date.now();

  // A cheap validity probe first — a 200 with zero open roles ("zombie
  // board") is a valid ACTIVE company, not a failure, so this can't be
  // inferred from an empty jobs array alone.
  const valid = await probeOfficialApi(source, companySlug);
  if (!valid) {
    await recordCompanyProbeFailure(source, companySlug);
    logger.info({ event: 'ingestion_company_probe_failed', source, companySlug, traceId });
    return;
  }

  const adapter = getAdapterBySource(source);
  if (!adapter) {
    logger.error({ event: 'ingestion_unknown_source', source, traceId });
    return;
  }

  const rawJobs = await adapter.fetch(companySlug);
  const currentExternalIds = new Set<string>();
  let queued = 0;
  let skipped = 0;

  const company = await upsertCompany(companySlug);
  const queue = getIngestionParseQueue();

  for (const raw of rawJobs) {
    let normalized = adapter.normalize(raw);
    if (!normalized || !passesFilter(normalized)) {
      skipped++;
      continue;
    }
    normalized = sanitizeNormalized(normalized, source, traceId);

    currentExternalIds.add(normalized.externalId);
    await queue.add(
      'parse',
      { normalized, companyId: company.id },
      {
        ...INGESTION_PARSE_JOB_OPTS,
        jobId: `parse:${source}:${toJobIdSegment(normalized.externalId)}`,
      },
    );
    queued++;
  }

  await markClosedJobs(source, companySlug, currentExternalIds);
  await prisma.atsCompany.update({
    where: { source_slug: { source, slug: companySlug } },
    data: {
      status: 'ACTIVE',
      consecutiveFailures: 0,
      lastSuccessAt: new Date(),
      lastCheckedAt: new Date(),
    },
  });

  logger.info({
    event: 'ingestion_metrics',
    source,
    companySlug,
    traceId,
    durationMs: Date.now() - startedAt,
    rawCount: rawJobs.length,
    queued,
    skipped,
  });
}

// Only per-company sources can tell "still listed" from "removed" —
// anything ACTIVE in our DB for this company that wasn't in this crawl's
// result set just got taken down at the source.
async function markClosedJobs(
  source: AtsSource,
  companySlug: string,
  currentExternalIds: Set<string>,
): Promise<void> {
  await prisma.job.updateMany({
    where: {
      source,
      company: companySlug,
      status: 'ACTIVE',
      externalId: { notIn: [...currentExternalIds] },
    },
    data: { status: 'CLOSED', closedAt: new Date() },
  });
}

async function recordCompanyProbeFailure(source: AtsSource, companySlug: string): Promise<void> {
  const updated = await prisma.atsCompany.update({
    where: { source_slug: { source, slug: companySlug } },
    data: { consecutiveFailures: { increment: 1 }, lastCheckedAt: new Date() },
  });

  if (updated.consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
    await prisma.atsCompany.update({ where: { id: updated.id }, data: { status: 'INACTIVE' } });
  }
}

// RemoteOK/Himalayas are aggregators — one call covers every company, no
// ats_companies fan-out involved.
async function processAggregatorCollect(
  job: Job<IngestionCollectPayload>,
  source: JobSource,
): Promise<void> {
  const traceId = job.id!;
  const startedAt = Date.now();

  const adapter = getAdapterBySource(source);
  if (!adapter) {
    logger.error({ event: 'ingestion_unknown_source', source, traceId });
    return;
  }

  logger.info({ event: 'ingestion_start', source, traceId });

  const rawJobs = await adapter.fetch();
  let queued = 0;
  let skipped = 0;
  const queue = getIngestionParseQueue();

  for (const raw of rawJobs) {
    let normalized = adapter.normalize(raw);
    if (!normalized || !passesFilter(normalized)) {
      skipped++;
      continue;
    }
    normalized = sanitizeNormalized(normalized, source, traceId);

    const company = await upsertCompany(normalized.company);
    await queue.add(
      'parse',
      { normalized, companyId: company.id },
      {
        ...INGESTION_PARSE_JOB_OPTS,
        jobId: `parse:${source}:${toJobIdSegment(normalized.externalId)}`,
      },
    );
    queued++;
  }

  logger.info({
    event: 'ingestion_metrics',
    source,
    traceId,
    durationMs: Date.now() - startedAt,
    rawCount: rawJobs.length,
    queued,
    skipped,
  });
}
