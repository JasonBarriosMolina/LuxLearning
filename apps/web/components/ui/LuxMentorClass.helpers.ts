// ─── LuxMentorClass.helpers.ts ───────────────────────────────────────────────
// Prompt builder and utilities for the Lux Mentor Class voice session.

/**
 * Builds the Vapi system prompt with a 2-phase structure:
 *  Phase 1 (0-5 min): Monologue — Mentor delivers lessonScript, student mic muted.
 *  Phase 2 (5-10 min): Q&A — Triggered by a system message, mic unmuted.
 */
export function buildSystemPrompt(
  vapiPrompt: string | null,
  vapiObjectives: string | null,
  lang: string,
  lessonScript: string | null,
): string {
  const scriptSection = lessonScript
    ? (lang === 'en'
      ? `\n\nLESSON CONTENT TO DELIVER IN PHASE 1:\n${lessonScript.slice(0, 3000)}`
      : `\n\nCONTENIDO DE LA LECCIÓN A EXPONER EN FASE 1:\n${lessonScript.slice(0, 3000)}`)
    : '';

  // Tone constraint added (Trello DmPpbrff item 6, 2026-08-30 20:24): the lesson content
  // read on screen during Phase 1 comes straight from this prompt's instructions — a
  // casual chatbot voice/register read there like an AI assistant chat, not a lecture.
  const toneRule = lang === 'en'
    ? 'Maintain a warm but professional register throughout — no emojis, no chatbot-style filler ("Great question!", "Awesome!", etc). Speak like an experienced instructor giving a clear lecture.'
    : 'Mantén un registro cálido pero profesional en todo momento — sin emojis, sin muletillas de chatbot ("¡Buena pregunta!", "¡Genial!", etc). Habla como un instructor con experiencia dando una clase clara.';

  const twoPhaseBase = lang === 'en'
    ? `You are Lux Mentor, a knowledgeable educational voice assistant. ${toneRule} This session has TWO phases:

PHASE 1 — EXPOSITION (first 5 minutes): Deliver the lesson content as a clear, structured monologue. Do NOT ask the student any questions. Do NOT wait for responses. Teach the material fluently and professionally.${scriptSection}

PHASE 2 — Q&A (after 5 minutes, triggered by a system message): When you receive the transition signal, say "I have finished the lesson content. I will now open the floor for questions." Then ask 2-3 focused questions about the material and respond warmly to the student's questions. The total session is 10 minutes.`
    : `Eres Lux Mentor, un asistente educativo de voz conocedor. ${toneRule} Esta sesión tiene DOS fases:

FASE 1 — EXPOSICIÓN (primeros 5 minutos): Entrega el contenido de la lección como un monólogo claro y estructurado. NO hagas preguntas al estudiante. NO esperes respuestas. Enseña el material de forma fluida y profesional.${scriptSection}

FASE 2 — Q&A (después de 5 minutos, activada por mensaje del sistema): Cuando recibas la señal de transición, di "He concluido el contenido de la lección. Ahora abro el espacio para preguntas." Luego haz 2-3 preguntas específicas sobre el material y responde con calidez las preguntas del estudiante. La sesión total es de 10 minutos.`;

  // If evaluator provided a custom prompt, append the two-phase structure to it
  const base = vapiPrompt ? `${vapiPrompt}\n\n${twoPhaseBase}` : twoPhaseBase;

  if (vapiObjectives) {
    try {
      const parsed = JSON.parse(vapiObjectives);
      if (Array.isArray(parsed)) {
        const prefix = lang === 'en'
          ? '\n\nPhase 2 question objectives:\n'
          : '\n\nObjetivos de preguntas para Fase 2:\n';
        return base + prefix + parsed.map((o: string, i: number) => `${i + 1}. ${o}`).join('\n');
      }
    } catch { /* ignore */ }
  }
  return base;
}

// Silence-timeout decision (Trello DmPpbrff item 7, 2026-08-30 20:28): pure so it can be
// unit-tested without mocking timers/Vapi. The component calls this on every 1s tick
// during Q&A and enacts whichever action comes back — 'checkin' sends the "are you
// still there?" system message once; 'end' sends the goodbye and stops the call.
export type SilenceAction = 'none' | 'checkin' | 'end';

export function computeSilenceAction(params: {
  inQA: boolean;                 // elapsed >= MONOLOGUE_SECONDS
  silenceSeconds: number;        // seconds since the student last spoke
  checkinSent: boolean;          // has the "are you there?" message already been sent
  secondsSinceCheckin: number;   // seconds since that check-in was sent (0 if not sent)
  checkinThreshold: number;      // e.g. 12
  endThreshold: number;          // e.g. 10
}): SilenceAction {
  const { inQA, silenceSeconds, checkinSent, secondsSinceCheckin, checkinThreshold, endThreshold } = params;
  if (!inQA) return 'none';
  if (!checkinSent) {
    return silenceSeconds >= checkinThreshold ? 'checkin' : 'none';
  }
  return secondsSinceCheckin >= endThreshold ? 'end' : 'none';
}

export function extractYouTubeId(url: string): string {
  const match = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
  return match?.[1] ?? '';
}
