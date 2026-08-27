/**
 * Tests for reflection/detect-ai.ts
 *
 * Bug (found in code review 2026-08-26): the prompt was built with
 * PROMPT.replace('{{TEXT}}', text) — String.replace's *string* replacement form treats
 * "$`", "$'", "$&", "$$" in the replacement specially (insert-before-match,
 * insert-after-match, insert-whole-match, literal "$"), so a student reflection
 * containing a stray "$" could silently corrupt the prompt sent to Bedrock instead of
 * being inserted verbatim. Fix: build the prompt via template interpolation (no .replace
 * on user text), plus escape the text going into the <student_reflection> wrapper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({
    body: new TextEncoder().encode(JSON.stringify({
      content: [{ text: '{"isAI":false,"confidence":10,"signals":[],"verdict":"HUMANO"}' }],
    })),
  }),
}));

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function () { return { send: sendMock }; },
  InvokeModelCommand: function (x: any) { return x; },
}));

import { detectAI } from '../../reflection/detect-ai';

function sentPromptText(): string {
  const call = sendMock.mock.calls.at(-1)![0];
  const parsedBody = JSON.parse(call.body);
  return parsedBody.messages[0].content;
}

describe('detectAI — $-pattern corruption in .replace() (bug fix)', () => {
  beforeEach(() => {
    sendMock.mockClear();
  });

  it('un texto con "$\\`" se inserta literal, sin duplicar el prompt que lo precede', async () => {
    const text = 'Reflexión con caracter especial: $` en medio de la frase.';
    await detectAI(text);
    expect(sentPromptText()).toContain(text);
  });

  it('un texto con "$\'" se inserta literal, sin duplicar el prompt que lo sigue', async () => {
    const text = "Otra reflexión con $' en medio de la frase.";
    await detectAI(text);
    expect(sentPromptText()).toContain(text);
  });

  it('un texto con "$$" se inserta literal (no colapsa a un solo "$")', async () => {
    const text = 'Precio: $$100 en la reflexión.';
    await detectAI(text);
    expect(sentPromptText()).toContain(text);
  });

  it('texto normal se envuelve en <student_reflection> tal cual', async () => {
    const text = 'Una reflexión normal sin caracteres especiales.';
    await detectAI(text);
    const prompt = sentPromptText();
    expect(prompt).toContain(`<student_reflection>\n${text}\n</student_reflection>`);
  });
});
