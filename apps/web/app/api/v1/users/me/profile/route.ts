import { auth } from '@/lib/auth';
import { prisma, clearProfileEmbedding } from '@ai-job-market-intelligence/db';
import { ProfileUpdateSchema, ProfileResponseSchema } from '@ai-job-market-intelligence/shared';
import { apiSuccess, apiError } from '@/lib/api-response';
import { enqueueRescoring } from '@/lib/queue';

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return apiError('UNAUTHORIZED', 401);
  }

  const body = await request.json().catch(() => null);
  const parsed = ProfileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 400, parsed.error.issues);
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { onboardingCompleted: true },
  });
  const isNewOnboarding = !existingUser?.onboardingCompleted;

  const profile = await prisma.userProfile.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...parsed.data },
    update: parsed.data,
  });

  await prisma.user.update({
    where: { id: session.user.id },
    data: { onboardingCompleted: true },
  });

  // Manual profile edits bypass profile_parse, so force the next scoring run
  // to regenerate the embedding from the latest profile text.
  await clearProfileEmbedding(session.user.id);

  await enqueueRescoring(session.user.id, isNewOnboarding);

  const data = ProfileResponseSchema.parse({
    skills: profile.skills,
    experienceYears: profile.experienceYears,
    preferredRoles: profile.preferredRoles,
    currentCountry: profile.currentCountry,
    expectedSalaryMin: profile.expectedSalaryMin,
    updatedAt: profile.updatedAt.toISOString(),
  });

  return apiSuccess(data);
}
