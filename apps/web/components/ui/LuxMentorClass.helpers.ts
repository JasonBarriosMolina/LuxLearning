// ─── LuxMentorClass.helpers.ts ───────────────────────────────────────────────
// Prompt builder and utilities for the Lux Mentor Class voice session.

/**
 * Builds the Vapi system prompt for the Q&A-only voice session.
 *
 * Restructured (Trello DmPpbrff, 2026-08-31 04:01): the exposition is no longer
 * delivered by Vapi at all — it's pre-narrated by Amazon Polly (see
 * LuxMentorClass.tsx's 'narrating' phase) BEFORE the call connects. Vapi now only
 * handles the live Q&A (~5 min), which is also what fixes the class hanging after
 * the old "microphone will be deactivated" mic-mute message: that whole two-phase
 * mute/unmute dance is gone. lessonScript is passed only as REFERENCE material so
 * the model can answer accurately — it must never re-narrate it as a monologue.
 */
export function buildSystemPrompt(
  vapiPrompt: string | null,
  vapiObjectives: string | null,
  lang: string,
  lessonScript: string | null,
): string {
  const scriptSection = lessonScript
    ? (lang === 'en'
      ? `\n\nREFERENCE MATERIAL (the student already heard this narrated before the call — use it to answer questions accurately, do NOT read it aloud again):\n${lessonScript.slice(0, 3000)}`
      : `\n\nMATERIAL DE REFERENCIA (el estudiante ya escuchó esto narrado antes de la llamada — úsalo para responder con precisión, NO lo vuelvas a leer en voz alta):\n${lessonScript.slice(0, 3000)}`)
    : '';

  // Tone constraint (Trello DmPpbrff item 6, 2026-08-30 20:24): a casual chatbot
  // voice/register, not an instructor's.
  const toneRule = lang === 'en'
    ? 'Maintain a warm but professional register throughout — no emojis, no chatbot-style filler ("Great question!", "Awesome!", etc). Speak like an experienced instructor.'
    : 'Mantén un registro cálido pero profesional en todo momento — sin emojis, sin muletillas de chatbot ("¡Buena pregunta!", "¡Genial!", etc). Habla como un instructor con experiencia.';

  const qaBase = lang === 'en'
    ? `You are Lux Mentor, a knowledgeable educational voice assistant. ${toneRule} The student just listened to a narrated exposition of this module's content and is now ready with questions. Your ONLY job in this call is a live Q&A (about 5 minutes): answer the student's questions about the material below clearly and concisely. Do NOT deliver a monologue or re-teach the whole lesson — respond to what they actually ask. When you receive a system message saying the call is wrapping up, give a brief one-sentence goodbye (a longer closing summary will be played separately afterward).${scriptSection}`
    : `Eres Lux Mentor, un asistente educativo de voz conocedor. ${toneRule} El estudiante acaba de escuchar una exposición narrada del contenido de este módulo y ahora está listo con preguntas. Tu ÚNICO trabajo en esta llamada es un Q&A en vivo (unos 5 minutos): responde las preguntas del estudiante sobre el material de abajo de forma clara y concisa. NO des un monólogo ni vuelvas a enseñar toda la lección — responde a lo que realmente pregunte. Cuando recibas un mensaje del sistema indicando que la llamada está por cerrar, despídete brevemente en una oración (un cierre más largo se reproducirá aparte después).${scriptSection}`;

  // If evaluator provided a custom prompt, append the Q&A base to it
  const base = vapiPrompt ? `${vapiPrompt}\n\n${qaBase}` : qaBase;

  if (vapiObjectives) {
    try {
      const parsed = JSON.parse(vapiObjectives);
      if (Array.isArray(parsed)) {
        const prefix = lang === 'en'
          ? '\n\nQuestion objectives to guide the Q&A:\n'
          : '\n\nObjetivos de preguntas para guiar el Q&A:\n';
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

// ── Exposition redesign (Trello DmPpbrff, 2026-09-01 01:10) ──────────────────
// Live closed-caption sync: lessonSpeechMarks is Polly's sentence-level timing
// array ({time, value}, time in ms, ascending, same shape produced by
// generateCarouselNarration in admin/ctx.ts). Mirrors LuxCarrouselPlayer's
// findActiveSlideIndex, but marks here have no explicit endMs — a sentence
// stays "active" until the next one's start time.
export interface SpeechMark {
  time: number;
  value: string;
}

/** Which caption/sentence is active at a given playback position. Returns -1
 *  for an empty marks list. Before the first mark's time (e.g. currentMs=0
 *  while the first mark starts at a few ms in), the first sentence is shown. */
export function findActiveCaptionIndex(marks: SpeechMark[], currentMs: number): number {
  if (marks.length === 0) return -1;
  let active = 0;
  for (let i = 0; i < marks.length; i++) {
    if (marks[i]!.time <= currentMs) active = i;
    else break;
  }
  return active;
}
