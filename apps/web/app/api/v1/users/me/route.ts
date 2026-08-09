import { auth } from '@/lib/auth';
import { prisma } from '@ai-job-market-intelligence/db';
import { UserResponseSchema } from '@ai-job-market-intelligence/shared';
import { apiSuccess, apiError } from '@/lib/api-response';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return apiError('UNAUTHORIZED', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { profile: true },
  });
  if (!user) {
    return apiError('UNAUTHORIZED', 401);
  }

  const data = UserResponseSchema.parse({
    id: user.id,
    email: user.email,
    onboardingCompleted: user.onboardingCompleted,
    dailyBriefEnabled: user.dailyBriefEnabled,
    profile: user.profile
      ? {
          skills: user.profile.skills,
          experienceYears: user.profile.experienceYears,
          preferredRoles: user.profile.preferredRoles,
          currentCountry: user.profile.currentCountry,
          expectedSalaryMin: user.profile.expectedSalaryMin,
          updatedAt: user.profile.updatedAt.toISOString(),
        }
      : null,
    createdAt: user.createdAt.toISOString(),
  });

  return apiSuccess(data);
}
