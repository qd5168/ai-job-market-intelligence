import { createServer } from 'node:http';
import { Worker } from 'bullmq';
import { prisma } from '@ai-job-market-intelligence/db';
import { withTimeout } from '@ai-job-market-intelligence/shared';
import { QUEUE_NAMES } from '@ai-job-market-intelligence/shared/constants';
import { logger } from './logger.js';
import { connection } from './redis.js';
import { processCompanyDiscovery } from './processors/company-discovery.js';
import { processIngestionCollect } from './processors/ingestion-collect.js';
import { processIngestionParse } from './processors/ingestion-parse.js';
import { processScoringMatch } from './processors/scoring-match.js';
import { processNotifyEmail } from './processors/notify-email.js';
import { processProfileParse } from './processors/profile-parse.js';
import { processSkillTrendAggregate } from './processors/skill-trend-aggregate.js';
import { processCareerAgentDaily } from './processors/career-agent-daily.js';
import { processCareerBriefGenerate } from './processors/career-brief-generate.js';
import { processAgentHandoff } from './processors/agent-handoff.js';
import { processDataRetentionCleanup } from './processors/data-retention-cleanup.js';
import { setupCronJobs } from './queues/setup-cron.js';

const port = Number(process.env.PORT ?? 3001);
const HEALTH_CHECK_TIMEOUT_MS = 3000;

const server = createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/health') {
    const services = { database: 'ok', redis: 'ok' };

    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, HEALTH_CHECK_TIMEOUT_MS);
    } catch {
      services.database = 'error';
    }

    try {
      await withTimeout(connection.ping(), HEALTH_CHECK_TIMEOUT_MS);
    } catch {
      services.redis = 'error';
    }

    const ok = services.database === 'ok' && services.redis === 'ok';
    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: ok ? 'ok' : 'degraded', services }));
    return;
  }

  res.writeHead(404);
  res.end();
});

const workers = [
  new Worker(QUEUE_NAMES.COMPANY_DISCOVERY, processCompanyDiscovery, {
    connection,
    concurrency: 1,
  }),
  new Worker(QUEUE_NAMES.INGESTION_COLLECT, processIngestionCollect, {
    connection,
    concurrency: 5,
  }),
  new Worker(QUEUE_NAMES.INGESTION_PARSE, processIngestionParse, { connection, concurrency: 3 }),
  new Worker(QUEUE_NAMES.SCORING_MATCH, processScoringMatch, { connection, concurrency: 5 }),
  new Worker(QUEUE_NAMES.NOTIFY_EMAIL, processNotifyEmail, { connection, concurrency: 3 }),
  new Worker(QUEUE_NAMES.PROFILE_PARSE, processProfileParse, { connection, concurrency: 2 }),
  new Worker(QUEUE_NAMES.SKILL_TREND_AGGREGATE, processSkillTrendAggregate, {
    connection,
    concurrency: 1,
  }),
  new Worker(QUEUE_NAMES.CAREER_AGENT_DAILY, processCareerAgentDaily, {
    connection,
    concurrency: 1,
  }),
  new Worker(QUEUE_NAMES.CAREER_BRIEF_GENERATE, processCareerBriefGenerate, {
    connection,
    concurrency: 5,
  }),
  new Worker(QUEUE_NAMES.AGENT_HANDOFF, processAgentHandoff, { connection, concurrency: 3 }),
  new Worker(QUEUE_NAMES.DATA_RETENTION_CLEANUP, processDataRetentionCleanup, {
    connection,
    concurrency: 1,
  }),
];

workers.forEach((w) => {
  w.on('failed', (job, err) => {
    logger.error({ event: 'job_failed', queue: w.name, jobId: job?.id, error: err.message });
  });
});

async function main() {
  await setupCronJobs();

  server.listen(port, () => {
    logger.info(
      { event: 'worker_started', port, queues: workers.map((w) => w.name) },
      'worker started',
    );
  });
}

async function shutdown() {
  logger.info({ event: 'worker_shutdown' }, 'shutting down worker');
  server.close();
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main();
