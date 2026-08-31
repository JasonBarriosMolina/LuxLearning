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
