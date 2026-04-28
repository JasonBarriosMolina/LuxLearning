import type {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerWithContextResult,
} from 'aws-lambda';
import { verifyToken, extractToken } from './auth.js';

export const handler = async (
  event: APIGatewayRequestAuthorizerEventV2
): Promise<APIGatewaySimpleAuthorizerWithContextResult<Record<string, string>>> => {
  try {
    const authHeader = event.headers?.['authorization'] ?? event.headers?.['Authorization'];
    const token = extractToken(authHeader);
    const claims = await verifyToken(token);

    return {
      isAuthorized: true,
      context: {
        userId: claims.userId,
        email: claims.email,
        role: claims.role,
      },
    };
  } catch (err) {
    console.warn('[Authorizer] Denied:', (err as Error).message);
    return {
      isAuthorized: false,
      context: {},
    };
  }
};
