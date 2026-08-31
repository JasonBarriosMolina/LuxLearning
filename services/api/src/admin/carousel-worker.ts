// ─── carousel-worker.ts ───────────────────────────────────────────────────────
// Async asset generation for Lux Carrousel (Trello N1bbWdz0): narration audio +
// speech marks (Polly), per-slide images (Stability, reusing ai-image-helpers —
// same no-text negative-prompt pipeline the spec asks for), a "Lux Recap" PDF
// (pdfkit, same library already used for certificates), then saves the finished
// carousel as a new Lesson (type="carousel") on the target module.
import { createId } from '@paralleldrive/cuid2';
import { AdminCtx, generateCarouselNarration, defaultVoiceForLanguage, S3_IMAGES_BUCKET, s3Client } from './ctx';
import { generateLessonImage } from './ai-image-helpers';
import { saveAiJob, createNotification } from '../shared/db-dynamo';
import { ok } from '../shared/response';
import { PutObjectCommand } from '@aws-sdk/client-s3';

const IMAGE_CONCURRENCY = 3;
// ~750 chars/min is a rough Polly neural speaking-rate estimate — only used as a fallback
// when the number of sentence speech marks doesn't line up 1:1 with the slide count (the
// model didn't phrase each slide as exactly one Polly-recognized sentence).
const CHARS_PER_MINUTE_ESTIMATE = 750;

export interface DraftSlide {
  order: number;
  onScreenText: { title: string; bullets: string[] };
  narrationSegment: string;
  imagePrompt: string;
}

export function computeSlideTiming(slides: DraftSlide[], marks: Array<{ time: number; value: string }>) {
  if (marks.length === slides.length) {
    return slides.map((s, i) => ({
      ...s,
      startMs: marks[i]!.time,
      endMs: i + 1 < marks.length ? marks[i + 1]!.time : marks[i]!.time + 4000,
    }));
  }
  // Fallback: distribute proportionally by narration character count.
  const totalChars = slides.reduce((sum, s) => sum + s.narrationSegment.length, 0) || 1;
  const estTotalMs = Math.round((totalChars / CHARS_PER_MINUTE_ESTIMATE) * 60000);
  let acc = 0;
  return slides.map((s) => {
    const dur = Math.max(1500, Math.round((s.narrationSegment.length / totalChars) * estTotalMs));
    const startMs = acc;
    acc += dur;
    return { ...s, startMs, endMs: acc };
  });
}

async function buildRecapPdf(courseTitle: string, moduleTitle: string, finalSlides: any[]): Promise<string | null> {
  try {
    // Lazy require to avoid cold-start cost on other routes — same pattern as certificates/handler.ts
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PDFDocument = require('pdfkit') as typeof import('pdfkit');
    const pdfBuffer = await new Promise<Buffer>(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(20).font('Helvetica-Bold').text('Lux Recap', { align: 'center' });
        doc.fontSize(12).font('Helvetica').fillColor('#555').text(moduleTitle, { align: 'center' });
        doc.moveDown(1.5);

        for (const slide of finalSlides) {
          if (doc.y > doc.page.height - 220) doc.addPage();
          if (slide.imageUrl) {
            try {
              const res = await fetch(slide.imageUrl);
              if (res.ok) {
                const buf = Buffer.from(await res.arrayBuffer());
                doc.image(buf, { fit: [200, 200] });
              }
            } catch { /* skip image, keep the text */ }
          }
          doc.moveDown(0.3);
          doc.fontSize(14).font('Helvetica-Bold').fillColor('#2C2C2C').text(slide.onScreenText?.title ?? '');
          const bullets: string[] = Array.isArray(slide.onScreenText?.bullets) ? slide.onScreenText.bullets : [];
          doc.fontSize(11).font('Helvetica').fillColor('#444');
          for (const b of bullets) doc.text(`•  ${b}`);
          doc.moveDown(1);
        }
        doc.end();
      } catch (e) { reject(e); }
    });

    const key = `carousel/recap-${createId()}.pdf`;
    await s3Client.send(new PutObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: key, Body: pdfBuffer, ContentType: 'application/pdf' }));
    return `https://${S3_IMAGES_BUCKET}.s3.amazonaws.com/${key}`;
  } catch (err) {
    console.error('[carousel-worker] PDF recap generation failed (non-fatal):', err);
    return null;
  }
}

export async function handleCarouselWorker(ctx: AdminCtx): Promise<any | null> {
  if (ctx.action !== 'carousel-generate') return null;
  const { prisma, body } = ctx;
  const { _jobId, moduleId, slides, courseLanguage, creatorUserId } = body as {
    _jobId: string; moduleId: string; slides: DraftSlide[]; courseLanguage?: string; creatorUserId?: string;
  };

  try {
    const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true } });
    if (!mod) { await saveAiJob(_jobId, { status: 'error', error: 'Módulo no encontrado' }); return ok({}); }

    const voiceId = defaultVoiceForLanguage(courseLanguage);
    const narrationText = slides.map((s) => {
      const t = s.narrationSegment.trim();
      return /[.!?]$/.test(t) ? t : `${t}.`;
    }).join(' ');

    const narration = await generateCarouselNarration(`carousel-${moduleId}`, narrationText, voiceId);
    if (!narration) {
      await saveAiJob(_jobId, { status: 'error', error: 'No se pudo generar la narración de audio' });
      return ok({});
    }

    const timedSlides = computeSlideTiming(slides, narration.marks);
    await saveAiJob(_jobId, { status: 'processing', phase: 'images', modulesProcessed: 0, totalModules: slides.length });

    const slideImages: (string | null)[] = new Array(slides.length).fill(null);
    for (let i = 0; i < slides.length; i += IMAGE_CONCURRENCY) {
      const batch = slides.slice(i, i + IMAGE_CONCURRENCY);
      await Promise.all(batch.map(async (s, bi) => {
        const idx = i + bi;
        const url = await generateLessonImage(mod.title, mod.title, idx, { promptText: s.imagePrompt, style: 'diagram' }).catch(() => null);
        slideImages[idx] = url;
      }));
      await saveAiJob(_jobId, { status: 'processing', phase: 'images', modulesProcessed: Math.min(i + IMAGE_CONCURRENCY, slides.length), totalModules: slides.length });
    }

    const finalSlides = timedSlides.map((s, i) => ({
      order: s.order, onScreenText: s.onScreenText, imageUrl: slideImages[i], startMs: s.startMs, endMs: s.endMs,
    }));

    await saveAiJob(_jobId, { status: 'processing', phase: 'recap' });
    const pdfRecapUrl = await buildRecapPdf(mod.title, mod.title, finalSlides);

    const lessonCount = await prisma.lesson.count({ where: { moduleId } });
    const lesson = await prisma.lesson.create({
      data: {
        moduleId, order: lessonCount + 1, title: `Lux Carrousel: ${mod.title}`, duration: '6 min',
        type: 'carousel', content: null, points: [], tip: '', youtubeId: '',
        audioUrl: narration.audioUrl, carouselSlides: finalSlides, speechMarks: narration.marks as any, pdfRecapUrl,
      },
    });

    await saveAiJob(_jobId, { status: 'done', lessonId: lesson.id });

    if (creatorUserId) {
      await createNotification({
        userId: creatorUserId, notifId: createId(), type: 'GENERAL',
        message: `🎠 Lux Carrousel listo — ${mod.title}`,
        read: false, createdAt: new Date().toISOString(), actionUrl: `/admin/courses`,
      }).catch(() => {});
    }
  } catch (err: any) {
    console.error('[carousel-worker] fatal error:', err);
    await saveAiJob(_jobId, { status: 'error', error: err?.message ?? 'Error generando el carrousel' });
  }
  return ok({});
}
