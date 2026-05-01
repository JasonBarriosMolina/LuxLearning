import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { getCertificate, getCertificatesByUser, getCertificateByUserAndCourse, saveCertificate, getReflection } from '../shared/db-dynamo';
import { getPrismaClient } from '../shared/db-neon';
import { ok, notFound, badRequest, serverError, cors } from '../shared/response';
import { createId } from '@paralleldrive/cuid2';

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;

async function resolveStudentName(userId: string, fallbackEmail: string): Promise<string> {
  try {
    if (/^[0-9a-f-]{36}$/i.test(userId)) {
      const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
      return res.UserAttributes?.find((a: any) => a.Name === 'name')?.Value
        ?? res.UserAttributes?.find((a: any) => a.Name === 'email')?.Value
        ?? fallbackEmail;
    }
  } catch { /* fall through */ }
  return fallbackEmail || userId;
}

export const handler = async (event: Event) => {
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const path = event.rawPath;
  const method = event.requestContext.http.method;
  const auth = event.requestContext.authorizer?.lambda;

  try {
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
    if (method === 'POST' && path === '/my-certificates/generate') {
      if (!auth?.userId) return notFound('No autenticado');
      const body = JSON.parse(event.body ?? '{}');
      const { courseId } = body as { courseId: string };
      if (!courseId) return badRequest('courseId es requerido');

      // Check if already exists
      const existing = await getCertificateByUserAndCourse(auth.userId, courseId);
      if (existing) return ok(existing);

      // Verify all modules are approved
      const prisma = getPrismaClient();
      const course = await prisma.course.findUnique({
        where: { id: courseId },
        include: { modules: { select: { id: true } } },
      });
      if (!course) return notFound('Curso no encontrado');

      const reflections = await Promise.all(
        course.modules.map((m) => getReflection(auth.userId, m.id))
      );
      const allApproved = course.modules.length > 0 && reflections.every((r) => r?.status === 'APPROVED');
      if (!allApproved) return badRequest('El curso aún no está completado');

      // Generate certificate
      const studentName = await resolveStudentName(auth.userId, auth.email);
      const cert = {
        certId: createId(),
        userId: auth.userId,
        courseId,
        studentName,
        courseTitle: course.title,
        issuedAt: new Date().toISOString(),
      };
      await saveCertificate(cert);
      return ok(cert);
    }

    return notFound('Ruta no encontrada');
  } catch (err) {
    return serverError(err);
  }
};
