// User profile domain handler for lux-admin.
import {
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { ok, badRequest, forbidden } from '../shared/response';
import { AdminCtx, cognito, USER_POOL_ID } from './ctx';

/** Any authenticated user (including students) — just needs a userId from the authorizer. */
function isAuthenticated(event: any): boolean {
  return !!event.requestContext?.authorizer?.lambda?.userId;
}

export async function handleProfile(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, body, userId } = ctx;

  // ── GET /user/profile ────────────────────────────────────────────────────────
  if (path === '/user/profile' && method === 'GET') {
    if (!isAuthenticated(event)) return forbidden('No autorizado');
    if (!userId) return badRequest('userId no disponible');
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
    const attr = (name: string) => res.UserAttributes?.find((a: any) => a.Name === name)?.Value ?? '';
    const socialLinksRaw = attr('custom:socialLinks');
    return ok({
      username: userId,
      name: attr('name'),
      email: attr('email') || userId,
      phone: attr('phone_number'),
      bio: attr('custom:bio'),
      picture: attr('picture'),
      university: attr('custom:university'),
      career: attr('custom:career'),
      semester: attr('custom:semester'),
      title: attr('custom:title'),
      specialty: attr('custom:specialty'),
      experience: attr('custom:experience'),
      socialLinks: socialLinksRaw ? (() => { try { return JSON.parse(socialLinksRaw); } catch { return []; } })() : [],
    });
  }

  // ── PUT /user/profile ────────────────────────────────────────────────────────
  if (path === '/user/profile' && method === 'PUT') {
    if (!isAuthenticated(event)) return forbidden('No autorizado');
    if (!userId) return badRequest('userId no disponible');
    const { name, phone, bio, picture, university, career, semester, title, specialty, experience, socialLinks } = body as {
      name?: string; phone?: string; bio?: string; picture?: string;
      university?: string; career?: string; semester?: string;
      title?: string; specialty?: string; experience?: string;
      socialLinks?: { platform: string; url: string }[];
    };
    const attrs: { Name: string; Value: string }[] = [];
    if (name !== undefined) attrs.push({ Name: 'name', Value: name });
    if (phone !== undefined) attrs.push({ Name: 'phone_number', Value: phone });
    if (bio !== undefined) attrs.push({ Name: 'custom:bio', Value: bio });
    if (picture !== undefined) attrs.push({ Name: 'picture', Value: picture });
    if (university !== undefined) attrs.push({ Name: 'custom:university', Value: university });
    if (career !== undefined) attrs.push({ Name: 'custom:career', Value: career });
    if (semester !== undefined) attrs.push({ Name: 'custom:semester', Value: String(semester) });
    if (title !== undefined) attrs.push({ Name: 'custom:title', Value: title });
    if (specialty !== undefined) attrs.push({ Name: 'custom:specialty', Value: specialty });
    if (experience !== undefined) attrs.push({ Name: 'custom:experience', Value: experience });
    if (socialLinks !== undefined) attrs.push({ Name: 'custom:socialLinks', Value: JSON.stringify(socialLinks) });
    if (attrs.length === 0) return badRequest('No hay campos para actualizar');
    await cognito.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: userId,
      UserAttributes: attrs,
    }));
    return ok({ updated: true });
  }

  return null; // not handled by this domain
}
