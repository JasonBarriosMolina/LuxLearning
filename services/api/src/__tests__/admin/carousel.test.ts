/**
 * Tests for admin/carousel.ts (Mini Wizard sync routes) — Trello N1bbWdz0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeAdminCtx, makePrisma } from '../helpers/ctx';

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient:  function () { return { send: vi.fn().mockResolvedValue({}) }; },
  InvokeCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function () { return { send: vi.fn() }; },
  InvokeModelCommand:   function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-ses',   () => ({ SESClient: function () { return {}; } }));
vi.mock('@aws-sdk/client-s3',    () => ({
  S3Client: function () { return { send: vi.fn() }; },
  PutObjectCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-polly', () => ({
  PollyClient: function () { return { send: vi.fn() }; },
  SynthesizeSpeechCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function () { return {}; },
  AdminGetUserCommand: function (x: any) { return x; },
}));
vi.mock('../../shared/db-dynamo', () => ({ saveAiJob: vi.fn().mockResolvedValue(undefined) }));

const invokeBedrockForJsonMock = vi.fn();
vi.mock('../../admin/ctx', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, invokeBedrockForJson: (...args: any[]) => invokeBedrockForJsonMock(...args) };
});

import { handleCarousel } from '../../admin/carousel';

function makeDraftSlides(n = 9) {
  return Array.from({ length: n }, (_, i) => ({
    onScreenText: { title: `Título ${i + 1}`, bullets: ['A', 'B'] },
    narrationSegment: `Narración de la diapositiva ${i + 1}.`,
    imagePrompt: `Escena ${i + 1}`,
  }));
}

describe('handleCarousel — POST /admin/modules/:id/carousel/draft', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a slide array built from the Bedrock script', async () => {
    invokeBedrockForJsonMock.mockResolvedValue(makeDraftSlides());
    const prisma = makePrisma();
    prisma.module.findUnique = vi.fn().mockResolvedValue({ title: 'Redes Neuronales', description: 'Intro' });
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/modules/m1/carousel/draft', prisma, body: { topic: 'Backpropagation' } });
    const res = await handleCarousel(ctx as any);
    expect(res?.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.slides).toHaveLength(9);
    expect(body.data.slides[0].onScreenText.title).toBe('Título 1');
  });

  it('returns 400 when the module does not exist', async () => {
    const prisma = makePrisma();
    prisma.module.findUnique = vi.fn().mockResolvedValue(null);
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/modules/missing/carousel/draft', prisma, body: {} });
    const res = await handleCarousel(ctx as any);
    expect(res?.statusCode).toBe(400);
  });

  it('returns 400 when Bedrock fails to produce usable slides', async () => {
    invokeBedrockForJsonMock.mockResolvedValue(null);
    const prisma = makePrisma();
    prisma.module.findUnique = vi.fn().mockResolvedValue({ title: 'Mod', description: 'Desc' });
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/modules/m1/carousel/draft', prisma, body: {} });
    const res = await handleCarousel(ctx as any);
    expect(res?.statusCode).toBe(400);
  });
});

describe('handleCarousel — POST /admin/modules/:id/carousel/generate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches a self-invoke job and returns a jobId', async () => {
    const ctx = makeAdminCtx({
      method: 'POST', path: '/admin/modules/m1/carousel/generate',
      body: { slides: makeDraftSlides(), courseLanguage: 'ES' },
    });
    const res = await handleCarousel(ctx as any);
    expect(res?.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.jobId).toMatch(/^carousel-/);
  });

  it('returns 400 when slides are missing', async () => {
    const ctx = makeAdminCtx({ method: 'POST', path: '/admin/modules/m1/carousel/generate', body: {} });
    const res = await handleCarousel(ctx as any);
    expect(res?.statusCode).toBe(400);
  });
});

describe('handleCarousel — routing', () => {
  it('returns null for unrelated paths', async () => {
    const ctx = makeAdminCtx({ method: 'GET', path: '/admin/courses' });
    const res = await handleCarousel(ctx as any);
    expect(res).toBeNull();
  });
});
