// Tests for sanitizeUserPromptForImage / generateLessonInfographic, moved here
// from ctx.test.ts when those functions were extracted to ai-image-helpers.ts
// (Trello DmPpbrff item 4, 2026-08-30 — ctx.ts was pushed over the size limit).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function () { return { send: vi.fn() }; },
  InvokeModelCommand:   function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-ses',      () => ({ SESClient: function () { return {}; } }));
vi.mock('@aws-sdk/client-s3',       () => ({
  S3Client: function () { return { send: vi.fn() }; },
  PutObjectCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-lambda',   () => ({ LambdaClient: function () { return {}; } }));
vi.mock('@aws-sdk/client-polly',    () => ({
  PollyClient: function () { return {}; },
  SynthesizeSpeechCommand: function (x: any) { return x; },
}));
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: function () { return {}; },
  AdminGetUserCommand: function (x: any) { return x; },
}));
vi.mock('jsonrepair', () => ({ jsonrepair: (x: string) => x }));

const { applyLuxWatermarkMock } = vi.hoisted(() => ({ applyLuxWatermarkMock: vi.fn() }));
vi.mock('../../shared/lux-watermark', () => ({ applyLuxWatermark: applyLuxWatermarkMock }));

function makeBedrockBody(text: string) {
  return Buffer.from(JSON.stringify({ content: [{ text }] }));
}

describe('sanitizeUserPromptForImage', () => {
  let bedrock: any;
  let sanitize: (p: string) => Promise<string>;

  beforeEach(async () => {
    const ctx = await import('../../admin/ctx');
    const helpers = await import('../../admin/ai-image-helpers');
    bedrock = ctx.bedrock;
    sanitize = helpers.sanitizeUserPromptForImage;
    vi.spyOn(bedrock, 'send');
  });

  it('returns Claude response when Haiku returns valid text', async () => {
    vi.mocked(bedrock.send).mockResolvedValueOnce({
      body: makeBedrockBody('Colorful flat illustration of audio waves and music notes, clean white background'),
    });
    const result = await sanitize('Infografía de formatos de audio');
    expect(result).toContain('audio');
    expect(result).not.toMatch(/infograf/i);
  });

  it('falls back to regex cleanup when Bedrock throws', async () => {
    vi.mocked(bedrock.send).mockRejectedValueOnce(new Error('Bedrock error'));
    const result = await sanitize('Infografía de formatos de audio');
    expect(result).not.toMatch(/\binfograf\w*/i);
    expect(result).toContain('no text');
  });

  it('falls back when Haiku returns short/empty text', async () => {
    vi.mocked(bedrock.send).mockResolvedValueOnce({ body: makeBedrockBody('ok') });
    const result = await sanitize('Diagrama de flujo de red');
    expect(result).not.toMatch(/\bdiagram\w*/i);
    expect(result).toContain('no text');
  });

  it('strips infographic/chart/text keywords in fallback', async () => {
    vi.mocked(bedrock.send).mockRejectedValueOnce(new Error('fail'));
    const result = await sanitize('chart of audio formats with labels and text');
    // These user-supplied keywords should be stripped from the leading cleaned portion.
    // The appended suffix adds "no text, no labels" which is intentional.
    const leadingPart = result.split(', flat illustration')[0];
    expect(leadingPart).not.toMatch(/\bchart\b/i);
    expect(leadingPart).not.toMatch(/\blabels?\b/i);
    expect(leadingPart).not.toMatch(/\btext\b/i);
    expect(result).toContain('no text');
  });

  // Jason, 2026-09-01: a carousel slide describing a DAW "software interface" came
  // back as a fake UI mockup full of illegible pseudo-text — diffusion models
  // hallucinate gibberish text whenever the concept implies text-bearing UI widgets,
  // regardless of a generic "no text" negative prompt.
  it('strips software-interface/screenshot/mockup keywords in fallback (diffusion models hallucinate fake UI text otherwise)', async () => {
    vi.mocked(bedrock.send).mockRejectedValueOnce(new Error('fail'));
    const result = await sanitize('screenshot of a DAW software interface with toolbar and menu bar');
    const leadingPart = result.split(', flat illustration')[0];
    expect(leadingPart).not.toMatch(/\binterfaz?e?\b/i);
    expect(leadingPart).not.toMatch(/\bsoftware\b/i);
    expect(leadingPart).not.toMatch(/\bscreenshots?\b/i);
    expect(leadingPart).not.toMatch(/\btoolbars?\b/i);
    expect(leadingPart).not.toMatch(/\bmenu ?bars?\b/i);
    expect(result).toContain('no user interface');
  });
});

// ── generateLessonInfographic ─────────────────────────────────────────────────

describe('generateLessonInfographic', () => {
  let bedrock: any;
  let s3Client: any;
  let generateLessonInfographic: (title: string, module: string, content: string) => Promise<string | null>;

  beforeEach(async () => {
    const ctx = await import('../../admin/ctx');
    const helpers = await import('../../admin/ai-image-helpers');
    bedrock = ctx.bedrock;
    s3Client = ctx.s3Client;
    generateLessonInfographic = helpers.generateLessonInfographic;
    vi.spyOn(bedrock,   'send');
    vi.spyOn(s3Client,  'send').mockResolvedValue({});
  });

  function makeSvgBody(svgContent: string) {
    return Buffer.from(JSON.stringify({ content: [{ text: svgContent }] }));
  }

  it('returns S3 URL when Haiku returns valid SVG', async () => {
    const svg = '<svg viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1200" fill="white"/><text x="600" y="100">Formatos de Audio</text></svg>';
    vi.mocked(bedrock.send).mockResolvedValueOnce({ body: makeSvgBody(svg) });
    const result = await generateLessonInfographic('Formatos de Audio', 'Módulo 1', '<p>WAV, MP3, AAC</p>');
    expect(result).toMatch(/^https:\/\/lux-learning-images\.s3\.amazonaws\.com\/lessons\/.+\.svg$/);
    expect(s3Client.send).toHaveBeenCalled();
  });

  it('returns null when Haiku response contains no SVG', async () => {
    vi.mocked(bedrock.send).mockResolvedValueOnce({ body: makeSvgBody('No SVG here, just text.') });
    const result = await generateLessonInfographic('Lección', 'Módulo', '');
    expect(result).toBeNull();
  });

  it('strips <script> tags from SVG before upload', async () => {
    const maliciousSvg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="100" height="100"/></svg>';
    vi.mocked(bedrock.send).mockResolvedValueOnce({ body: makeSvgBody(maliciousSvg) });
    let uploadedBody = '';
    vi.mocked(s3Client.send).mockImplementationOnce((cmd: any) => {
      uploadedBody = cmd.Body?.toString?.() ?? '';
      return Promise.resolve({});
    });
    const result = await generateLessonInfographic('Test', 'Módulo', '');
    expect(result).not.toBeNull();
    expect(uploadedBody).not.toMatch(/<script/i);
    expect(uploadedBody).not.toContain('alert(1)');
  });

  it('strips javascript: URIs from SVG (replaces with nojavascript:)', async () => {
    const xssSvg = '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="100" height="100"/></a></svg>';
    vi.mocked(bedrock.send).mockResolvedValueOnce({ body: makeSvgBody(xssSvg) });
    let uploadedBody = '';
    vi.mocked(s3Client.send).mockImplementationOnce((cmd: any) => {
      uploadedBody = cmd.Body?.toString?.() ?? '';
      return Promise.resolve({});
    });
    await generateLessonInfographic('Test', 'Módulo', '');
    // ctx.ts replaces "javascript:" with "nojavascript:" — the bare scheme must not appear as a URI
    expect(uploadedBody).not.toMatch(/"javascript\s*:/i);
    expect(uploadedBody).toContain('nojavascript:');
  });

  it('returns null when Bedrock throws', async () => {
    vi.mocked(bedrock.send).mockRejectedValueOnce(new Error('Bedrock timeout'));
    const result = await generateLessonInfographic('Lección', 'Módulo', 'Contenido');
    expect(result).toBeNull();
  });

  it('uses max_tokens 8192 in Bedrock call', async () => {
    const svg = '<svg viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    let capturedBody: any = null;
    vi.mocked(bedrock.send).mockImplementationOnce((cmd: any) => {
      capturedBody = JSON.parse(cmd?.body ?? '{}');
      return Promise.resolve({ body: makeSvgBody(svg) });
    });
    await generateLessonInfographic('Test', 'Módulo', '');
    expect(capturedBody?.max_tokens).toBe(8192);
  });
});

// ── generateLessonImage ────────────────────────────────────────────────────────
// Trello DmPpbrff, 2026-09-05 (Mack): "íconos extraños" / "cosas ... encima de las
// letras" — root-caused to the negative_prompt fighting the 'diagram' style's own
// positive prompt (excluding "diagram, chart, infographic" while asking for exactly
// that), plus a prompt-imagined fake watermark replaced with a real composited one.
describe('generateLessonImage', () => {
  let bedrockImageClient: any;
  let s3Client: any;
  let generateLessonImage: typeof import('../../admin/ai-image-helpers').generateLessonImage;

  function makeStabilityBody(base64Image: string) {
    return Buffer.from(JSON.stringify({ images: [base64Image] }));
  }

  const fakeImageB64 = Buffer.from('fake-jpeg-bytes').toString('base64');

  beforeEach(async () => {
    const ctx = await import('../../admin/ctx');
    const helpers = await import('../../admin/ai-image-helpers');
    bedrockImageClient = ctx.bedrockImageClient;
    s3Client = ctx.s3Client;
    generateLessonImage = helpers.generateLessonImage;
    vi.spyOn(bedrockImageClient, 'send');
    vi.spyOn(s3Client, 'send').mockResolvedValue({});
    applyLuxWatermarkMock.mockReset();
  });

  it('drops "diagram/chart/infographic" from the negative prompt for style=diagram (they contradict its own positive prompt)', async () => {
    applyLuxWatermarkMock.mockResolvedValue(Buffer.from('watermarked'));
    let capturedBody: any = null;
    vi.mocked(bedrockImageClient.send).mockImplementationOnce((cmd: any) => {
      capturedBody = JSON.parse(cmd?.body ?? '{}');
      return Promise.resolve({ body: makeStabilityBody(fakeImageB64) });
    });
    await generateLessonImage('Lección', 'Módulo', 0, { lessonContent: 'x', style: 'diagram' });
    expect(capturedBody.negative_prompt).not.toMatch(/\bdiagram\b/);
    expect(capturedBody.negative_prompt).not.toMatch(/\bchart\b/);
    expect(capturedBody.negative_prompt).not.toMatch(/\binfographic\b/);
    // Still excludes actual legible text/UI artifacts regardless of style.
    expect(capturedBody.negative_prompt).toMatch(/\btext\b/);
  });

  it('keeps "diagram/chart/infographic" in the negative prompt for non-diagram styles', async () => {
    applyLuxWatermarkMock.mockResolvedValue(Buffer.from('watermarked'));
    let capturedBody: any = null;
    vi.mocked(bedrockImageClient.send).mockImplementationOnce((cmd: any) => {
      capturedBody = JSON.parse(cmd?.body ?? '{}');
      return Promise.resolve({ body: makeStabilityBody(fakeImageB64) });
    });
    await generateLessonImage('Lección', 'Módulo', 0, { lessonContent: 'x', style: 'illustration' });
    expect(capturedBody.negative_prompt).toMatch(/\bdiagram\b/);
    expect(capturedBody.negative_prompt).toMatch(/\binfographic\b/);
  });

  it('uploads the watermarked buffer, not the raw Stability output, when watermarking succeeds', async () => {
    const watermarked = Buffer.from('watermarked-bytes');
    applyLuxWatermarkMock.mockResolvedValue(watermarked);
    vi.mocked(bedrockImageClient.send).mockResolvedValueOnce({ body: makeStabilityBody(fakeImageB64) });
    await generateLessonImage('Lección', 'Módulo', 0, { lessonContent: 'x' });
    const putCall = vi.mocked(s3Client.send).mock.calls.at(-1)![0] as any;
    expect(putCall.Body).toEqual(watermarked);
  });

  it('falls back to the un-watermarked image when applyLuxWatermark rejects (e.g. sharp native binding missing) — non-fatal', async () => {
    applyLuxWatermarkMock.mockRejectedValue(new Error('sharp native binding missing for this platform'));
    vi.mocked(bedrockImageClient.send).mockResolvedValueOnce({ body: makeStabilityBody(fakeImageB64) });
    const result = await generateLessonImage('Lección', 'Módulo', 0, { lessonContent: 'x' });
    expect(result).toMatch(/^https:\/\/lux-learning-images\.s3\.amazonaws\.com\/lessons\/.+\.jpg$/);
    const putCall = vi.mocked(s3Client.send).mock.calls.at(-1)![0] as any;
    expect(putCall.Body).toEqual(Buffer.from(fakeImageB64, 'base64')); // the original, un-watermarked bytes
  });

  it('returns null when Stability returns no image', async () => {
    applyLuxWatermarkMock.mockResolvedValue(Buffer.from('x'));
    vi.mocked(bedrockImageClient.send).mockResolvedValueOnce({ body: Buffer.from(JSON.stringify({ images: [] })) });
    const result = await generateLessonImage('Lección', 'Módulo', 0, { lessonContent: 'x' });
    expect(result).toBeNull();
  });

  it('returns null (not a crash) when Bedrock/Stability throws', async () => {
    vi.mocked(bedrockImageClient.send).mockRejectedValueOnce(new Error('Stability timeout'));
    const result = await generateLessonImage('Lección', 'Módulo', 0, { lessonContent: 'x' });
    expect(result).toBeNull();
  });
});
