// User profile domain handler for lux-admin.
import {
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { ok, badRequest, forbidden } from '../shared/response';
import { AdminCtx, isAuthorized, cognito, USER_POOL_ID } from './ctx';

export async function handleProfile(ctx: AdminCtx): Promise<any | null> {
  const { event, method, path, body, userId } = ctx;

  // ── GET /user/profile ────────────────────────────────────────────────────────
  if (path === '/user/profile' && method === 'GET') {
    if (!isAuthorized(event)) return forbidden('No autorizado');
    if (!userId) return badRequest('userId no disponible');
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
    const attr = (name: string) => res.UserAttributes?.find((a: any) => a.Name === name)?.Value ?? '';
    return ok({
      username: userId,
      name: attr('name'),
      email: attr('email') || userId,
      phone: attr('phone_number'),
      bio: attr('custom:bio'),
      picture: attr('picture'),
    });
  }

  // ── PUT /user/profile ────────────────────────────────────────────────────────
  if (path === '/user/profile' && method === 'PUT') {
    if (!isAuthorized(event)) return forbidden('No autorizado');
    if (!userId) return badRequest('userId no disponible');
    const { name, phone, bio, picture } = body as { name?: string; phone?: string; bio?: string; picture?: string };
    const attrs: { Name: string; Value: string }[] = [];
    if (name !== undefined) attrs.push({ Name: 'name', Value: name });
    if (phone !== undefined) attrs.push({ Name: 'phone_number', Value: phone });
    if (bio !== undefined) attrs.push({ Name: 'custom:bio', Value: bio });
    if (picture !== undefined) attrs.push({ Name: 'picture', Value: picture });
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
