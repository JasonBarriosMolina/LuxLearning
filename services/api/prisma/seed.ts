import { PrismaClient } from '@prisma/client';
import { STAFFPAD_COURSE } from '../../packages/types/src/seed-data.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Lux Learning database...');

  // Upsert course
  const course = await prisma.course.upsert({
    where: { slug: STAFFPAD_COURSE.slug },
    update: {},
    create: {
      title: STAFFPAD_COURSE.title,
      slug: STAFFPAD_COURSE.slug,
      description: STAFFPAD_COURSE.description,
      imageUrl: STAFFPAD_COURSE.imageUrl,
      isPilot: STAFFPAD_COURSE.isPilot,
      isActive: STAFFPAD_COURSE.isActive,
    },
  });

  console.log(`✓ Course: ${course.title} (${course.id})`);

  for (const mod of STAFFPAD_COURSE.modules) {
    const module = await prisma.module.upsert({
      where: { courseId_order: { courseId: course.id, order: mod.order } },
      update: {
        title: mod.title,
        description: mod.description,
        duration: mod.duration,
        passingScore: mod.passingScore,
      },
      create: {
        courseId: course.id,
        order: mod.order,
        title: mod.title,
        description: mod.description,
        duration: mod.duration,
        passingScore: mod.passingScore,
      },
    });

    console.log(`  ✓ Module ${mod.order}: ${module.title}`);

    // Lessons
    for (const lesson of mod.lessons) {
      await prisma.lesson.upsert({
        where: { moduleId_order: { moduleId: module.id, order: lesson.order } },
        update: {
          title: lesson.title,
          duration: lesson.duration,
          youtubeId: lesson.youtubeId,
          imageUrl: lesson.imageUrl ?? null,
          points: lesson.points,
          tip: lesson.tip,
        },
        create: {
          moduleId: module.id,
          order: lesson.order,
          title: lesson.title,
          duration: lesson.duration,
          youtubeId: lesson.youtubeId,
          imageUrl: lesson.imageUrl ?? null,
          points: lesson.points,
          tip: lesson.tip,
        },
      });
    }

    console.log(`    ✓ ${mod.lessons.length} lessons seeded`);

    // Questions
    for (const q of mod.questions) {
      await prisma.question.upsert({
        where: { moduleId_order: { moduleId: module.id, order: q.order } },
        update: {
          text: q.text,
          options: q.options,
          correctIndex: q.correctIndex,
        },
        create: {
          moduleId: module.id,
          order: q.order,
          text: q.text,
          options: q.options,
          correctIndex: q.correctIndex,
        },
      });
    }

    console.log(`    ✓ ${mod.questions.length} questions seeded`);
  }

  console.log('\n✅ Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
