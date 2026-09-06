import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { getCertificate, getCertificatesByUser, getCertificateByUserAndCourse, getCertTemplate, saveCertTemplate, type CertTemplate } from '../shared/db-dynamo';
import { getPrismaClient } from '../shared/db-neon';
import { checkAndCompleteCourse } from '../shared/db-course-completion';
import { ok, notFound, badRequest, forbidden, serverError, cors, setRequestOrigin, getCorsOrigin } from '../shared/response';
import { setEnvironmentFromOrigin } from '../shared/env-context';

const DEFAULT_TEMPLATE: CertTemplate = {
  primaryColor: '#7B2FBE',
  secondaryColor: '#00B4D8',
  watermarkText: 'Lux Learning',
  footerText: 'Este certificado acredita la finalización exitosa del curso.',
  fields: { studentName: true, courseTitle: true, issuedAt: true },
};

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

export const handler = async (event: Event) => {
  const origin = event.headers?.origin ?? event.headers?.Origin;
  setRequestOrigin(origin);
  setEnvironmentFromOrigin(origin);
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const path = event.rawPath;
  const method = event.requestContext.http.method;
  const auth = event.requestContext.authorizer?.lambda;

  try {
    // GET /admin/certificates/template — EVALUATOR or ADMIN
    if (method === 'GET' && path === '/admin/certificates/template') {
      if (!auth?.userId || !['EVALUATOR', 'ADMIN', 'SUPER_ADMIN'].includes(auth.role)) {
        return forbidden('Se requiere rol de evaluador o administrador');
      }
      const template = await getCertTemplate();
      return ok(template ?? DEFAULT_TEMPLATE);
    }

    // PUT /admin/certificates/template — ADMIN only
    if (method === 'PUT' && path === '/admin/certificates/template') {
      if (!auth?.userId || !['ADMIN', 'SUPER_ADMIN'].includes(auth.role)) {
        return forbidden('Se requiere rol de administrador');
      }
      const body = JSON.parse(event.body ?? '{}') as Partial<CertTemplate>;
      const { logoUrl, watermarkText, primaryColor, secondaryColor, fields, footerText } = body;
      const template: CertTemplate = {
        ...(logoUrl !== undefined ? { logoUrl } : {}),
        ...(watermarkText !== undefined ? { watermarkText } : {}),
        ...(primaryColor !== undefined ? { primaryColor } : {}),
        ...(secondaryColor !== undefined ? { secondaryColor } : {}),
        ...(fields !== undefined ? { fields } : {}),
        ...(footerText !== undefined ? { footerText } : {}),
      };
      await saveCertTemplate(template);
      return ok(template);
    }

    // GET /certificates/:certId/pdf — PUBLIC
    const certPdfMatch = path.match(/^\/certificates\/([^/]+)\/pdf$/);
    if (method === 'GET' && certPdfMatch) {
      const certId = certPdfMatch[1]!;
      const cert = await getCertificate(certId);
      if (!cert) return notFound('Certificado no encontrado');

      const template = (await getCertTemplate()) ?? DEFAULT_TEMPLATE;
      const primary = template.primaryColor ?? DEFAULT_TEMPLATE.primaryColor!;
      const secondary = template.secondaryColor ?? DEFAULT_TEMPLATE.secondaryColor!;
      const footerText = template.footerText ?? DEFAULT_TEMPLATE.footerText!;
      const watermark = template.watermarkText ?? DEFAULT_TEMPLATE.watermarkText!;

      // Lazy require to avoid cold-start cost on other routes
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const PDFDocument = require('pdfkit') as typeof import('pdfkit');

      const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 60 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const W = doc.page.width;
        const H = doc.page.height;

        // Parse hex color to r,g,b
        const hexToRgb = (hex: string) => {
          const n = parseInt(hex.replace('#', ''), 16);
          return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
        };

        const p = hexToRgb(primary);
        const s = hexToRgb(secondary);

        // Header gradient strip (two-rect approximation)
        doc.rect(0, 0, W / 2, 20).fill(primary);
        doc.rect(W / 2, 0, W / 2, 20).fill(secondary);

        // Watermark (very light diagonal text)
        doc.save()
           .rotate(-30, { origin: [W / 2, H / 2] })
           .opacity(0.06)
           .fontSize(90)
           .fillColor(primary)
           .text(watermark, 0, H / 2 - 50, { width: W, align: 'center' })
           .restore()
           .opacity(1);

        // Border
        doc.roundedRect(30, 30, W - 60, H - 60, 12)
           .lineWidth(2)
           .strokeColor(primary)
           .stroke();

        // Organization name / watermark text
        doc.fontSize(11).fillColor(secondary).text(watermark.toUpperCase(), 0, 50, { width: W, align: 'center', characterSpacing: 3 });

        // Title
        doc.fontSize(36).fillColor(primary).font('Helvetica-Bold')
           .text('Certificado de Finalización', 0, H / 2 - 90, { width: W, align: 'center' });

        // Course title
        const fields = template.fields ?? DEFAULT_TEMPLATE.fields!;
        let yPos = H / 2 - 30;
        if (fields.courseTitle) {
          doc.fontSize(20).fillColor('#333333').font('Helvetica')
             .text(cert.courseTitle ?? '', 0, yPos, { width: W, align: 'center' });
          yPos += 40;
        }

        // "Se otorga a"
        doc.fontSize(13).fillColor('#666666').font('Helvetica')
           .text('Se otorga a', 0, yPos, { width: W, align: 'center' });
        yPos += 22;

        // Student name
        if (fields.studentName) {
          doc.fontSize(26).fillColor('#111111').font('Helvetica-Bold')
             .text(cert.studentName ?? cert.userId, 0, yPos, { width: W, align: 'center' });
          yPos += 42;
        }

        // Issue date
        if (fields.issuedAt && cert.issuedAt) {
          const dateStr = new Date(cert.issuedAt).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
          doc.fontSize(11).fillColor('#888888').font('Helvetica')
             .text(`Emitido el ${dateStr}`, 0, yPos, { width: W, align: 'center' });
          yPos += 22;
        }

        // Footer divider
        doc.moveTo(W / 4, H - 80).lineTo(3 * W / 4, H - 80).lineWidth(0.5).strokeColor('#CCCCCC').stroke();

        // Footer text
        doc.fontSize(9).fillColor('#AAAAAA').font('Helvetica')
           .text(footerText, 0, H - 70, { width: W, align: 'center' });

        doc.end();
      });

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="certificado-${certId}.pdf"`,
          'Access-Control-Allow-Origin': getCorsOrigin(origin),
        },
        body: pdfBuffer.toString('base64'),
        isBase64Encoded: true,
      };
    }

    // GET /certificates/:certId — PUBLIC, no auth required (for verification page)
    const certMatch = path.match(/^\/certificates\/([^/]+)$/);
    if (method === 'GET' && certMatch) {
      const certId = certMatch[1]!;
      const cert = await getCertificate(certId);
      if (!cert) return notFound('Certificado no encontrado');
      return ok(cert);
    }

    // GET /my-certificates — authenticated, returns student's own certificates
    if (method === 'GET' && path === '/my-certificates') {
      if (!auth?.userId) return notFound('No autenticado');
      const certs = await getCertificatesByUser(auth.userId);
      return ok(certs);
    }

    // POST /my-certificates/generate — generate cert if course is complete (idempotent)
    // Trello DmPpbrff, 2026-09-06 (Mack): "el certificado se obtiene al completar
    // todo el módulo y todos los entregables y evaluaciones de un curso" — the old
    // check here only looked at reflectionStatus, so a quiz-only or class-only
    // module (no reflection planned) could never satisfy it. Delegates to the
    // shared, full completion check (lessons+class+quiz+reflection+interview) —
    // same one the other gating endpoints call so a certificate appears the moment
    // ANY of them clears the last requirement, not just when this endpoint is hit.
    if (method === 'POST' && path === '/my-certificates/generate') {
      if (!auth?.userId) return notFound('No autenticado');
      const body = JSON.parse(event.body ?? '{}');
      const { courseId } = body as { courseId: string };
      if (!courseId) return badRequest('courseId es requerido');

      const existing = await getCertificateByUserAndCourse(auth.userId, courseId);
      if (existing) return ok(existing);

      const prisma = await getPrismaClient();
      const result = await checkAndCompleteCourse(prisma, auth.userId, courseId, auth.email);
      if (!result) return badRequest('El curso aún no está completado');

      const cert = await getCertificate(result.certId);
      return ok(cert);
    }

    return notFound('Ruta no encontrada');
  } catch (err) {
    return serverError(err);
  }
};
