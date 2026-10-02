import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('./db-core', () => ({
  ddb: { send: (...a: any[]) => sendMock(...a) },
  TABLES: { MEDIA_USAGE: 'LuxMediaUsage-Test' },
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({ UpdateCommand: function (x: any) { return x; } }));

import { acquireMedia, mediaMode, stubMediaUrl, syntheticSpeechMarks } from './media-budget';
import { setCurrentEnv } from './env-context';
import { trackBedrockUsage } from './bedrock-usage';

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({});
  delete process.env.MEDIA_MODE;
  delete process.env.MEDIA_CAP_IMAGE;
  delete process.env.MEDIA_CAP_POLLY_CHARS;
});
afterEach(() => setCurrentEnv('prod'));

describe('mediaMode', () => {
  it('prod is always real', () => {
    setCurrentEnv('prod');
    process.env.MEDIA_MODE = 'stub';
    expect(mediaMode()).toBe('real');
  });
  it('test defaults to stub, staging to real, MEDIA_MODE overrides', () => {
    setCurrentEnv('test');
    expect(mediaMode()).toBe('stub');
    process.env.MEDIA_MODE = 'real';
    expect(mediaMode()).toBe('real');
    setCurrentEnv('staging');
    delete process.env.MEDIA_MODE;
    expect(mediaMode()).toBe('real');
  });
});

describe('acquireMedia', () => {
  it('prod: allow without touching DynamoDB', async () => {
    setCurrentEnv('prod');
    expect(await acquireMedia('image', 1)).toBe('allow');
    expect(sendMock).not.toHaveBeenCalled();
  });
  it('test (stub mode): stub without touching DynamoDB', async () => {
    setCurrentEnv('test');
    expect(await acquireMedia('polly', 2000)).toBe('stub');
    expect(sendMock).not.toHaveBeenCalled();
  });
  it('staging: allow and count against the monthly cap', async () => {
    setCurrentEnv('staging');
    expect(await acquireMedia('image', 1)).toBe('allow');
    const capCall = sendMock.mock.calls[0][0];
    expect(capCall.Key.sk).toBe('image');
    expect(capCall.Key.pk).toMatch(/^cap#\d{4}-\d{2}$/);
    expect(capCall.ExpressionAttributeValues[':max']).toBe(299); // default staging cap 300 - 1
  });
  it('staging: denies once the conditional update fails', async () => {
    setCurrentEnv('staging');
    sendMock.mockRejectedValueOnce(Object.assign(new Error('cap'), { name: 'ConditionalCheckFailedException' }));
    expect(await acquireMedia('image', 1)).toBe('deny');
  });
  it('fails open on any other DynamoDB error', async () => {
    setCurrentEnv('staging');
    sendMock.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'ResourceNotFoundException' }));
    expect(await acquireMedia('polly', 1000)).toBe('allow');
  });
  it('honours MEDIA_CAP_* overrides and denies oversize single requests', async () => {
    setCurrentEnv('staging');
    process.env.MEDIA_CAP_POLLY_CHARS = '1000';
    expect(await acquireMedia('polly', 2000)).toBe('deny');
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('stub helpers', () => {
  it('builds fixture URLs in the env bucket', () => {
    process.env.S3_IMAGES_BUCKET = 'lux-learning-images-test';
    expect(stubMediaUrl('image')).toBe('https://lux-learning-images-test.s3.amazonaws.com/fixtures/stub.jpg');
    expect(stubMediaUrl('audio')).toBe('https://lux-learning-images-test.s3.amazonaws.com/fixtures/stub.mp3');
    delete process.env.S3_IMAGES_BUCKET;
  });
  it('syntheticSpeechMarks: one monotonic mark per sentence', () => {
    const marks = syntheticSpeechMarks('Primera frase. Segunda frase! ¿Tercera?');
    expect(marks.map((m) => m.value)).toEqual(['Primera frase.', 'Segunda frase!', '¿Tercera?']);
    expect(marks[0]!.time).toBe(0);
    expect(marks[1]!.time).toBeGreaterThan(marks[0]!.time);
    expect(marks[2]!.time).toBeGreaterThan(marks[1]!.time);
  });
});

describe('trackBedrockUsage', () => {
  it('returns bare stubs untouched (unit-test mocks have no middlewareStack)', () => {
    const stub = { send: vi.fn() };
    expect(trackBedrockUsage(stub as any)).toBe(stub);
  });
  it('records tokens from response headers in test, nothing in prod', async () => {
    let mw: any;
    const client: any = { middlewareStack: { add: (fn: any) => { mw = fn; } } };
    trackBedrockUsage(client);
    const next = async () => ({ response: { headers: {
      'x-amzn-bedrock-input-token-count': '120', 'x-amzn-bedrock-output-token-count': '45',
    } } });

    setCurrentEnv('test');
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'lux-lessons-test';
    await mw(next, {})({ input: { modelId: 'haiku' } });
    const call = sendMock.mock.calls[0][0];
    expect(call.Key.sk).toBe('bedrock#lessons-test#haiku');
    expect(Object.values(call.ExpressionAttributeValues)).toEqual(expect.arrayContaining([1, 120, 45]));

    sendMock.mockClear();
    setCurrentEnv('prod');
    await mw(next, {})({ input: { modelId: 'haiku' } });
    expect(sendMock).not.toHaveBeenCalled();
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  });
});
