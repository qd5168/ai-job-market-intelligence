import { z } from 'zod';

// Job-side only — Job.eligibleRegions is AI Job Parsing's coarse-bucket
// output. Users don't pick a bucket directly (see UserProfile.currentCountry
// in user.ts); their ISO 3166-1 country code is mapped to a bucket at
// scoring time via @ai-job-market-intelligence/shared/regions.
export const RegionBucketSchema = z.enum([
  'US',
  'EU',
  'UK',
  'APAC',
  'LATAM',
  'REMOTE_GLOBAL',
  'OTHER',
]);
export type RegionBucket = z.infer<typeof RegionBucketSchema>;

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const PaginationMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export const ErrorCode = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'PROFILE_INCOMPLETE',
  'QUOTA_EXCEEDED',
  'CAREER_COACH_QUOTA_EXCEEDED',
  'BILLING_ERROR',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorSchema = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export function apiSuccessSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema,
    meta: PaginationMetaSchema.partial().optional(),
  });
}
