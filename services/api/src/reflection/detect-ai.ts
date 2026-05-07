import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { AIDetectionResult } from '@lux/types';

const client = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });

const PROMPT = `Analiza el siguiente texto y determina si fue escrito por un humano
o generado por IA. Responde ÚNICAMENTE con este JSON (sin markdown):
{"isAI": boolean, "confidence": number_0_to_100, "signals": string[], "verdict": "HUMANO" | "IA_DETECTADA"}

Señales de IA: estructura demasiado perfecta, vocabulario homogéneo,
ausencia de errores naturales, frases genéricas, falta de experiencia personal concreta.

Texto a analizar:
"""
{{TEXT}}
"""`;

export async function detectAI(text: string): Promise<AIDetectionResult> {
  const response = await client.send(
    new InvokeModelCommand({
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 300,
        messages: [{ role: 'user', content: PROMPT.replace('{{TEXT}}', text) }],
      }),
    })
  );

  const result = JSON.parse(new TextDecoder().decode(response.body));
  const raw = result.content[0].text as string;

  // Strip any accidental markdown fences
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean) as AIDetectionResult;
}
