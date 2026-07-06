import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  // Must use regular functions — arrow functions cannot be used as constructors with `new`
  BedrockRuntimeClient: function() { return { send: mockSend }; },
  InvokeModelCommand:   function(input: any) { return input; },
}));

import { detectAI } from './detect-ai';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeResponse(result: object, wrapInFences = false) {
  const json = JSON.stringify(result);
  const text = wrapInFences ? `\`\`\`json\n${json}\n\`\`\`` : json;
  const body = new TextEncoder().encode(JSON.stringify({ content: [{ text }] }));
  return { body };
}

const HUMAN = { isAI: false, confidence: 12, signals: [], verdict: 'HUMANO' } as const;
const AI    = { isAI: true,  confidence: 91, signals: ['estructura perfecta', 'ausencia de errores'], verdict: 'IA_DETECTADA' } as const;

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockResolvedValue(makeResponse(HUMAN));
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('detectAI — model ID', () => {
  it('uses the IAM-authorized model (global haiku, not cross-region sonnet)', async () => {
    await detectAI('texto de prueba');
    const arg = mockSend.mock.calls[0]![0] as any;
    expect(arg.modelId).toBe('global.anthropic.claude-haiku-4-5-20251001-v1:0');
  });

  it('injects the full text into the prompt', async () => {
    const text = 'mi reflexión personal sobre el módulo';
    await detectAI(text);
    const arg = mockSend.mock.calls[0]![0] as any;
    const body = JSON.parse(arg.body);
    expect(body.messages[0].content).toContain(text);
  });

  it('sets anthropic_version and max_tokens correctly', async () => {
    await detectAI('texto');
    const arg = mockSend.mock.calls[0]![0] as any;
    const body = JSON.parse(arg.body);
    expect(body.anthropic_version).toBe('bedrock-2023-05-31');
    expect(body.max_tokens).toBe(300);
  });
});

describe('detectAI — response parsing', () => {
  it('returns parsed result for a human-written text', async () => {
    mockSend.mockResolvedValue(makeResponse(HUMAN));
    const result = await detectAI('texto humano');
    expect(result.isAI).toBe(false);
    expect(result.confidence).toBe(12);
    expect(result.verdict).toBe('HUMANO');
    expect(result.signals).toEqual([]);
  });

  it('returns parsed result for AI-detected text', async () => {
    mockSend.mockResolvedValue(makeResponse(AI));
    const result = await detectAI('texto generado por IA');
    expect(result.isAI).toBe(true);
    expect(result.confidence).toBe(91);
    expect(result.verdict).toBe('IA_DETECTADA');
    expect(result.signals).toHaveLength(2);
  });

  it('strips ```json fences from response before parsing', async () => {
    mockSend.mockResolvedValue(makeResponse(HUMAN, true));
    const result = await detectAI('texto con fences en respuesta');
    expect(result.isAI).toBe(false);
    expect(result.verdict).toBe('HUMANO');
  });

  it('strips plain ``` fences from response before parsing', async () => {
    const json = JSON.stringify(AI);
    const textWithFences = `\`\`\`\n${json}\n\`\`\``;
    const body = new TextEncoder().encode(JSON.stringify({ content: [{ text: textWithFences }] }));
    mockSend.mockResolvedValue({ body });
    const result = await detectAI('texto');
    expect(result.isAI).toBe(true);
  });
});

describe('detectAI — error handling', () => {
  it('propagates Bedrock errors (e.g. AccessDeniedException from wrong model)', async () => {
    mockSend.mockRejectedValue(new Error('AccessDeniedException: not authorized'));
    await expect(detectAI('texto')).rejects.toThrow('AccessDeniedException');
  });

  it('propagates JSON parse errors from malformed response', async () => {
    const body = new TextEncoder().encode(JSON.stringify({ content: [{ text: 'not-json' }] }));
    mockSend.mockResolvedValue({ body });
    await expect(detectAI('texto')).rejects.toThrow();
  });
});
