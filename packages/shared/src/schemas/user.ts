import { z } from 'zod';
import { isValidCountryCode } from '../regions';

// ISO 3166-1 alpha-2, uppercased before the validity check so 'cn'/'CN' both
// pass — the frontend CurrentCountrySelect always stores upper-case, but
// this is cheap insurance for any other API caller.
const CountryCodeSchema = z
  .string()
  .length(2)
  .transform((code) => code.toUpperCase())
  .refine(isValidCountryCode, 'Invalid ISO 3166-1 country code');

export const ProfileUpdateSchema = z.object({
  // Limit relaxed from 20 to 50 — a product decision, not a doc typo
  skills: z.array(z.string().min(1).max(50)).min(1).max(50),
  experienceYears: z.number().int().min(0).max(50),
  preferredRoles: z.array(z.string().min(1).max(100)).min(1).max(10),
  // Omitted/null = not filled in, don't check eligibility.
  currentCountry: CountryCodeSchema.nullable().optional(),
  // Omitted/null = no salary preference.
  expectedSalaryMin: z.number().int().positive().nullable().optional(),
});
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

export const ProfileResponseSchema = z.object({
  skills: z.array(z.string()),
  experienceYears: z.number().int(),
  preferredRoles: z.array(z.string()),
  currentCountry: z.string().nullable(),
  expectedSalaryMin: z.number().int().nullable(),
  updatedAt: z.string().datetime(),
});
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;

export const GithubLinkSchema = z.object({
  username: z
    .string()
    .min(1)
    .max(39)
    .regex(/^[a-zA-Z0-9-]+$/, 'Invalid GitHub username'),
});
export type GithubLink = z.infer<typeof GithubLinkSchema>;

export const UserResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  onboardingCompleted: z.boolean(),
  // Daily Career Brief opt-out, defaults to true — toggled from
  // /settings/notifications.
  dailyBriefEnabled: z.boolean(),
  profile: ProfileResponseSchema.nullable(),
  createdAt: z.string().datetime(),
});
export type UserResponse = z.infer<typeof UserResponseSchema>;

export const NotificationSettingsUpdateSchema = z.object({
  dailyBriefEnabled: z.boolean(),
});
export type NotificationSettingsUpdate = z.infer<typeof NotificationSettingsUpdateSchema>;

export const NotificationSettingsResponseSchema = z.object({
  dailyBriefEnabled: z.boolean(),
});
export type NotificationSettingsResponse = z.infer<typeof NotificationSettingsResponseSchema>;

// null = never uploaded/linked (distinct from FAILED).
export const ParseStatusSchema = z.enum(['PENDING', 'SUCCESS', 'FAILED']);
export type ParseStatus = z.infer<typeof ParseStatusSchema>;

export const ResumeCareerProfileSchema = z.object({
  status: ParseStatusSchema.nullable(),
  skills: z.array(z.string()),
  experienceYears: z.number().int().nullable(),
  summary: z.string().nullable(),
  parsedAt: z.string().datetime().nullable(),
});

export const GithubCareerProfileSchema = z.object({
  status: ParseStatusSchema.nullable(),
  username: z.string().nullable(),
  languages: z.record(z.string(), z.number()).nullable(),
  summary: z.string().nullable(),
  parsedAt: z.string().datetime().nullable(),
});

export const CareerProfileResponseSchema = z.object({
  resume: ResumeCareerProfileSchema,
  github: GithubCareerProfileSchema,
});
export type CareerProfileResponse = z.infer<typeof CareerProfileResponseSchema>;
