import { describe, it, expect, vi, beforeEach } from 'vitest';

const pollySend = vi.fn();
const s3Send = vi.fn();
const acquireMock = vi.fn();
vi.mock('@aws-sdk/client-polly', () => ({
  PollyClient: function () { return { send: (...a: any[]) => pollySend(...a) }; },
  SynthesizeSpeechCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: function () { return { send: (...a: any[]) => s3Send(...a) }; },
  PutObjectCommand: function (x: any) { return { _put: x }; },
  HeadObjectCommand: function (x: any) { return { _head: x }; },
}));
vi.mock('./media-budget', () => ({
  acquireMedia: (...a: any[]) => acquireMock(...a),
  stubMediaUrl: (k: string) => `https://stub/${k}`,
}));

import { generateLessonAudio, audioContentHash, existingAudioUrl } from './polly-audio';

async function* stream() { yield new Uint8Array([1, 2, 3]); }

beforeEach(() => {
  pollySend.mockReset(); s3Send.mockReset(); acquireMock.mockReset();
  acquireMock.mockResolvedValue('allow');
  pollySend.mockResolvedValue({ AudioStream: stream() });
  s3Send.mockImplementation(async (cmd: any) => {
    if (cmd._head) throw Object.assign(new Error('nf'), { name: 'NotFound' });
    return {};
  });
});

describe('audioContentHash', () => {
  it('is stable and content-sensitive', () => {
    expect(audioContentHash('hola')).toBe(audioContentHash('hola'));
    expect(audioContentHash('hola')).not.toBe(audioContentHash('hola!'));
    expect(audioContentHash('x')).toHaveLength(10);
  });
});

describe('generateLessonAudio', () => {
  it('synthesizes and uploads, counting plain-text characters', async () => {
    const url = await generateLessonAudio('l1', '<p>Hola   mundo</p>', 'Mia');
    expect(url).toContain('audio/l1-mia.mp3');
    expect(acquireMock).toHaveBeenCalledWith('polly', 'Hola mundo'.length);
    expect(pollySend).toHaveBeenCalledTimes(1);
  });
  it('stub gate returns the fixture and never calls Polly', async () => {
    acquireMock.mockResolvedValue('stub');
    expect(await generateLessonAudio('l1', 'texto', 'Mia')).toBe('https://stub/audio');
    expect(pollySend).not.toHaveBeenCalled();
  });
  it('deny gate returns null and never calls Polly', async () => {
    acquireMock.mockResolvedValue('deny');
    expect(await generateLessonAudio('l1', 'texto', 'Mia')).toBeNull();
    expect(pollySend).not.toHaveBeenCalled();
  });
  it('reuseExisting: existing S3 object skips the gate and Polly', async () => {
    s3Send.mockImplementation(async () => ({}));
    const url = await generateLessonAudio('q-abc', 'texto', 'Mia', { reuseExisting: true });
    expect(url).toContain('audio/q-abc-mia.mp3');
    expect(acquireMock).not.toHaveBeenCalled();
    expect(pollySend).not.toHaveBeenCalled();
  });
  it('reuseExisting: missing object falls through to synthesis', async () => {
    const url = await generateLessonAudio('q-abc', 'texto', 'Mia', { reuseExisting: true });
    expect(url).toContain('audio/q-abc-mia.mp3');
    expect(pollySend).toHaveBeenCalledTimes(1);
  });
  it('without reuseExisting an existing object is overwritten (regeneration flows)', async () => {
    s3Send.mockImplementation(async () => ({}));
    await generateLessonAudio('l1', 'texto nuevo', 'Mia');
    expect(pollySend).toHaveBeenCalledTimes(1);
  });
});

describe('existingAudioUrl', () => {
  it('returns the URL only when the object exists', async () => {
    expect(await existingAudioUrl('l1-h', 'Pedro')).toBeNull();
    s3Send.mockImplementation(async () => ({}));
    expect(await existingAudioUrl('l1-h', 'Pedro')).toContain('audio/l1-h-pedro.mp3');
  });
});
