// ─── carousel-pdf.ts ──────────────────────────────────────────────────────────
// "Lux Recap" PDF builder for Lux Carrousel — shared between lux-admin (no longer
// calls this eagerly, see below) and lux-courses (on-demand generation).
//
// Trello N1bbWdz0 (2026-08-31 15:21): "no es necesario que se cree un PDF
// instantáneamente... si fuese necesario que el estudiante lo descargue, el
// estudiante lo puede solicitar." Building the PDF during the main async
// generation job (9 sequential image re-fetches + pdfkit rendering) was adding
// real time to every carousel, whether or not anyone ever downloads it. Moved to
// on-demand: the student-facing /my-lessons/:id/carousel-recap route builds it
// the FIRST time anyone asks, then caches the URL on the Lesson row so every
// later request (any student, or the evaluator) is instant.
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createId } from '@paralleldrive/cuid2';

const s3Client = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
const S3_IMAGES_BUCKET = process.env.S3_IMAGES_BUCKET ?? 'lux-learning-images';

const LOGO_URL = process.env.APP_BASE_URL
  ? `${process.env.APP_BASE_URL}/lux-logo.png`
  : 'https://luxlearning.academy/lux-logo.png';

export interface RecapSlide {
  onScreenText: { title: string; bullets: string[] };
  narrationSegment?: string;
  imageUrl: string | null;
}

export async function buildRecapPdf(moduleTitle: string, slides: RecapSlide[]): Promise<string | null> {
  try {
    // Lazy require to avoid cold-start cost on other routes — same pattern as certificates/handler.ts
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PDFDocument = require('pdfkit') as typeof import('pdfkit');

    const [logoBuf] = await Promise.allSettled([
      fetch(LOGO_URL).then((r) => r.ok ? r.arrayBuffer().then(Buffer.from) : null).catch(() => null),
    ]);
    const logoBuffer: Buffer | null = logoBuf.status === 'fulfilled' ? logoBuf.value : null;

    const pdfBuffer = await new Promise<Buffer>(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Header
        doc.fontSize(22).font('Helvetica-Bold').fillColor('#1A1A2E').text('Lux Recap', { align: 'center' });
        doc.fontSize(13).font('Helvetica').fillColor('#6B21A8').text(moduleTitle, { align: 'center' });
        doc.moveDown(1.5);

        for (const slide of slides) {
          if (doc.y > doc.page.height - 240) doc.addPage();
          if (slide.imageUrl) {
            try {
              const res = await fetch(slide.imageUrl);
              if (res.ok) {
                const buf = Buffer.from(await res.arrayBuffer());
                doc.image(buf, { fit: [180, 180] });
                doc.moveDown(0.3);
              }
            } catch { /* skip image, keep the text */ }
          }
          doc.fontSize(14).font('Helvetica-Bold').fillColor('#1A1A2E').text(slide.onScreenText?.title ?? '');
          doc.moveDown(0.3);
          // Narration body text
          if (slide.narrationSegment) {
            doc.fontSize(11).font('Helvetica').fillColor('#374151').text(slide.narrationSegment, { lineGap: 2 });
            doc.moveDown(0.4);
          }
          // Key points
          const bullets: string[] = Array.isArray(slide.onScreenText?.bullets) ? slide.onScreenText.bullets : [];
          if (bullets.length > 0) {
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#6B21A8').text('Puntos clave:');
            doc.fontSize(10).font('Helvetica').fillColor('#4B5563');
            for (const b of bullets) doc.text(`•  ${b}`, { indent: 8 });
          }
          doc.moveDown(1.2);
        }

        // Footer with logo
        const footerY = doc.page.height - 55;
        doc.fontSize(8).font('Helvetica').fillColor('#9CA3AF')
          .text('Lux Learning — Todos los derechos reservados', 50, footerY, { align: 'center', width: doc.page.width - 100 });
        if (logoBuffer) {
          try { doc.image(logoBuffer, doc.page.width / 2 - 30, footerY + 10, { width: 60 }); } catch { /* skip */ }
        }

        doc.end();
      } catch (e) { reject(e); }
    });

    const key = `carousel/recap-${createId()}.pdf`;
    await s3Client.send(new PutObjectCommand({ Bucket: S3_IMAGES_BUCKET, Key: key, Body: pdfBuffer, ContentType: 'application/pdf' }));
    return `https://${S3_IMAGES_BUCKET}.s3.amazonaws.com/${key}`;
  } catch (err) {
    console.error('[carousel-pdf] recap generation failed (non-fatal):', err);
    return null;
  }
}
