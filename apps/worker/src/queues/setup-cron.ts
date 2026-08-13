import { scheduleIngestionCollectCron } from './ingestion-collect.js';
import { scheduleCompanyDiscoveryCron } from './company-discovery.js';
import { scheduleSkillTrendAggregateCron } from './skill-trend-aggregate.js';
import { scheduleCareerAgentDailyCron } from './career-agent-daily.js';
import { scheduleDataRetentionCleanupCron } from './data-retention-cleanup.js';

export async function setupCronJobs(): Promise<void> {
  await scheduleCompanyDiscoveryCron();
  await scheduleIngestionCollectCron();
  await scheduleSkillTrendAggregateCron();
  await scheduleCareerAgentDailyCron();
  await scheduleDataRetentionCleanupCron();
}
