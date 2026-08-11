// Input validation helpers for Lambda handlers

export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ValidationError'; }
}

export function assertMaxLen(val: unknown, max: number, field: string): void {
  if (typeof val === 'string' && val.length > max) {
    throw new ValidationError(`${field} excede ${max} caracteres`);
  }
}

export function assertEmail(val: unknown, field = 'email'): void {
  if (typeof val !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
    throw new ValidationError(`${field} inválido`);
  }
}

export function assertNonEmpty(val: unknown, field: string): void {
  if (!val || (typeof val === 'string' && val.trim() === '')) {
    throw new ValidationError(`${field} es requerido`);
  }
}

// Limits reference — use these constants across handlers
export const MAX = {
  NAME:      200,
  TITLE:     300,
  MESSAGE:   10_000,
  HTML_BODY: 100_000,
  CSV:       500_000,
  PROMPT:    2_000,
} as const;
