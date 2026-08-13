export const QUEUE_NAMES = {
  COMPANY_DISCOVERY: 'company_discovery',
  INGESTION_COLLECT: 'ingestion_collect',
  INGESTION_PARSE: 'ingestion_parse',
  SCORING_MATCH: 'scoring_match',
  NOTIFY_EMAIL: 'notify_email',
  PROFILE_PARSE: 'profile_parse',
  SKILL_TREND_AGGREGATE: 'skill_trend_aggregate',
  CAREER_AGENT_DAILY: 'career_agent_daily',
  CAREER_BRIEF_GENERATE: 'career_brief_generate',
  AGENT_HANDOFF: 'agent_handoff',
  DATA_RETENTION_CLEANUP: 'data_retention_cleanup',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
