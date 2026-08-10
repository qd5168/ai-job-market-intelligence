import { z } from 'zod';
import { PaginationQuerySchema, RegionBucketSchema } from './common';

export const JobDecisionSchema = z.enum(['APPLY', 'MAYBE', 'SKIP']);
export type JobDecision = z.infer<typeof JobDecisionSchema>;

// Region eligibility signal — independent of `decision`, so a strong
// skill/experience match with a region mismatch surfaces as "high score +
// INELIGIBLE" instead of a single blended number that conflates match
// quality with eligibility.
export const JobEligibilitySchema = z.enum(['ELIGIBLE', 'RESTRICTED', 'INELIGIBLE']);
export type JobEligibility = z.infer<typeof JobEligibilitySchema>;

export const JobSourceSchema = z.enum(['REMOTEOK', 'GREENHOUSE', 'LEVER', 'ASHBY', 'HIMALAYAS']);
export type JobSource = z.infer<typeof JobSourceSchema>;

export const JobLevelSchema = z.enum(['Junior', 'Mid', 'Senior', 'Staff', 'Principal', 'Unknown']);
export type JobLevel = z.infer<typeof JobLevelSchema>;

export const SalaryPeriodSchema = z.enum(['HOURLY', 'MONTHLY', 'ANNUAL']);
export type SalaryPeriod = z.infer<typeof SalaryPeriodSchema>;

export const JobStatusSchema = z.enum(['ACTIVE', 'CLOSED']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

// User-tracked application status — purely local bookkeeping (see
// database-schema.md §6.6 JobApplication), never synced to any external
// platform.
export const ApplicationStatusSchema = z.enum([
  'APPLIED',
  'INTERVIEWING',
  'OFFER',
  'REJECTED',
  'WITHDRAWN',
]);
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;

// 'NONE' is a filter-only value (not a stored status) meaning "no
// application record for this job" — GET /jobs?applicationStatus=NONE.
export const JobApplicationStatusFilterSchema = z.enum([
  ...ApplicationStatusSchema.options,
  'NONE',
]);
export type JobApplicationStatusFilter = z.infer<typeof JobApplicationStatusFilterSchema>;

// Embedded in JobListItem/JobResponse — the trimmed-down shape shown
// alongside a job, not the full PUT /jobs/:id/application response.
export const JobApplicationSummarySchema = z.object({
  status: ApplicationStatusSchema,
  updatedAt: z.string().datetime(),
});
export type JobApplicationSummary = z.infer<typeof JobApplicationSummarySchema>;

// Full PUT /jobs/:id/application response body.
export const JobApplicationSchema = z.object({
  jobId: z.string(),
  status: ApplicationStatusSchema,
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type JobApplicationDto = z.infer<typeof JobApplicationSchema>;

export const UpdateJobApplicationSchema = z.object({
  status: ApplicationStatusSchema,
  note: z.string().max(500).optional(),
});
export type UpdateJobApplicationInput = z.infer<typeof UpdateJobApplicationSchema>;

export const JobListQuerySchema = PaginationQuerySchema.extend({
  decision: JobDecisionSchema.optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  sort: z.enum(['score', 'date']).default('score'),
  applicationStatus: JobApplicationStatusFilterSchema.optional(),
});
export type JobListQuery = z.infer<typeof JobListQuerySchema>;

export const JobScoreSummarySchema = z.object({
  value: z.number().int(),
  decision: JobDecisionSchema,
  eligibility: JobEligibilitySchema,
  reasoning: z.string(),
  strengths: z.array(z.string()),
  skillGap: z.array(z.string()),
});

export const JobListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  source: JobSourceSchema,
  role: z.string().nullable(),
  level: JobLevelSchema.nullable(),
  location: z.string(),
  url: z.string().url(),
  tags: z.array(z.string()),
  postedAt: z.string().datetime().nullable(),
  score: JobScoreSummarySchema,
  application: JobApplicationSummarySchema.nullable(),
});
export type JobListItem = z.infer<typeof JobListItemSchema>;

export const JobResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  description: z.string(),
  url: z.string().url(),
  location: z.string(),
  tags: z.array(z.string()),
  source: JobSourceSchema,
  role: z.string().nullable(),
  level: JobLevelSchema.nullable(),
  salaryMin: z.number().int().nullable(),
  salaryMax: z.number().int().nullable(),
  // Only sourceStructured sources (Himalayas) populate these — everything
  // else is null and the frontend assumes annual USD.
  salaryCurrency: z.string().nullable(),
  salaryPeriod: SalaryPeriodSchema.nullable(),
  remote: z.boolean(),
  eligibleRegions: z.array(RegionBucketSchema),
  parseConfidence: z.number().min(0).max(1).nullable(),
  status: JobStatusSchema,
  postedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  application: JobApplicationSummarySchema.nullable(),
});
export type JobResponse = z.infer<typeof JobResponseSchema>;
