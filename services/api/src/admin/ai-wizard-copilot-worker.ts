// ─── ai-wizard-copilot-worker.ts ──────────────────────────────────────────────
// Async worker for wizard-copilot (weekly plan generation), split out of
// ai-wizard-worker.ts to stay under the domain-module line limit (CLAUDE.md: ≤600
// lines) — that file grew past it adding the lessons-phase idempotency guard and
// carousel-phase reordering (Trello DmPpbrff, 2026-08-31 17:30).
import { saveAiJob } from '../shared/db-dynamo';
import { ok } from '../shared/response';
import { AdminCtx, invokeBedrockForJson } from './ctx';

export async function handleWizardCopilot(ctx: AdminCtx): Promise<any | null> {
  if (ctx.action !== 'wizard-copilot') return null;
  const { body } = ctx;
  const {
    _jobId, title, courseType, description = '', planLanguage = 'ES', modality = '',
    totalWeeks = 16, startDate = '', classDays = [], classSchedule = '',
    academicPeriod = '', evaluationItems = [], syllabusInput = '', exceptionWeeks = [],
  } = body as any;
  try {
    const isEN = planLanguage === 'EN';
    const effectiveWeeks = (totalWeeks as number) - (exceptionWeeks as number[]).length;
    const evalSummary = (evaluationItems as any[])
      .map((it: any) => {
        const label = isEN ? (it.nameEN || it.name) : it.name;
        const countNote = it.count > 1 ? ` (${it.count})` : '';
        return `- ${label}${countNote}: ${it.weight}%, ${it.count} entrega(s)`;
      }).join('\n');
    const exceptionNote = (exceptionWeeks as number[]).length > 0
      ? `\n${isEN ? 'Non-teaching weeks' : 'Semanas con excepciones (NO lectivas)'}: ${(exceptionWeeks as number[]).map((n) => `S${n}`).join(', ')}`
      : '';
    const jsonFormat = isEN
      ? `{"modules":[{"name":"Module","nameEN":"Module","description":"2-3 sentences","descriptionEN":"2-3 sentences","weeks":[1,2,3]}],"weeklyPlan":[{"weekNum":1,"topics":["Specific topic"],"module":"Module","procedure":"Suggested class activity","notes":"Important observation or upcoming deadline","evalEvent":null}]}`
      : `{"modules":[{"name":"Módulo","nameEN":"Module","description":"2-3 oraciones","descriptionEN":"2-3 sentences","weeks":[1,2,3]}],"weeklyPlan":[{"weekNum":1,"topics":["Tema específico"],"module":"Módulo","procedure":"Actividad sugerida en clase","notes":"Observación importante o entrega próxima","evalEvent":null}]}`;
    const isAsync = (modality as string).toUpperCase().includes('ASINC') || (modality as string).toUpperCase().includes('ASYNC');
    const asyncNote = isAsync
      ? (isEN
        ? `\n\nASYNC COURSE RULE — NON-NEGOTIABLE:
1. Generate EXACTLY ${effectiveWeeks} modules — one per teaching week. No more, no less.
2. EVERY weeklyPlan entry MUST have a UNIQUE "module" value. The same module name MUST NOT appear in more than one week under ANY circumstance — a module must never span 2 weeks.
3. Each module in the "modules" array MUST have "weeks" as a single-element array, e.g. "weeks":[3].
4. If the syllabus has fewer topics than ${effectiveWeeks} weeks, SUBDIVIDE each topic into specific subtopics. Every week must have its own uniquely named module.
5. VERIFY before responding: count the unique "module" values in weeklyPlan — it must equal ${effectiveWeeks}.`
        : `\n\nREGLA CURSO ASÍNCRONO — NO NEGOCIABLE:
1. Genera EXACTAMENTE ${effectiveWeeks} módulos — uno por semana lectiva. Ni más, ni menos.
2. CADA entrada de weeklyPlan DEBE tener un valor "module" ÚNICO. El mismo nombre de módulo NO DEBE aparecer en más de una semana BAJO NINGUNA CIRCUNSTANCIA — un módulo nunca debe repartirse entre 2 semanas.
3. Cada módulo en el array "modules" DEBE tener "weeks" como array de UN SOLO elemento, ej: "weeks":[3].
4. Si el temario tiene menos temas que ${effectiveWeeks} semanas, SUBDIVIDE cada tema en subtemas específicos. Cada semana debe tener su propio módulo con nombre único.
5. VERIFICA antes de responder: cuenta los valores "module" únicos en weeklyPlan — debe ser igual a ${effectiveWeeks}.`)
      : '';
    // For sync/lecture courses: one distinct module per teaching week — no module spans multiple weeks.
    const syncNote = !isAsync
      ? (isEN
        ? `\n\nSYNC/LECTURE COURSE RULE — NON-NEGOTIABLE:
1. Generate EXACTLY ${effectiveWeeks} modules — one per teaching week. No more, no less.
2. EVERY weeklyPlan entry MUST have a UNIQUE "module" value. The same module name MUST NOT appear in more than one week under ANY circumstance.
3. Each module in the "modules" array MUST have "weeks" as a single-element array, e.g. "weeks":[3].
4. If the syllabus has fewer topics than ${effectiveWeeks} weeks, SUBDIVIDE each topic into specific subtopics (e.g. "Linear Algebra" → "Linear Algebra: Vectors", "Linear Algebra: Matrix Operations", "Linear Algebra: Eigenvalues"). Every week must have its own uniquely named module.
5. VERIFY before responding: count the unique "module" values in weeklyPlan — it must equal ${effectiveWeeks}.`
        : `\n\nREGLA ABSOLUTA CURSO SINCRÓNICO — NO NEGOCIABLE:
1. Genera EXACTAMENTE ${effectiveWeeks} módulos — uno por semana lectiva. Ni más, ni menos.
2. CADA entrada de weeklyPlan DEBE tener un valor "module" ÚNICO. El mismo nombre de módulo NO DEBE aparecer en más de una semana BAJO NINGUNA CIRCUNSTANCIA.
3. Cada módulo en el array "modules" DEBE tener "weeks" como array de UN SOLO elemento, ej: "weeks":[3].
4. Si el temario tiene menos temas que ${effectiveWeeks} semanas, SUBDIVIDE cada tema en subtemas específicos (ej: "Álgebra Lineal" → "Álgebra Lineal: Vectores", "Álgebra Lineal: Operaciones con Matrices", "Álgebra Lineal: Valores Propios"). Cada semana debe tener su propio módulo con nombre único.
5. VERIFICA antes de responder: cuenta los valores "module" únicos en weeklyPlan — debe ser igual a ${effectiveWeeks}.`)
      : '';
    const prompt = isEN
      ? `You are an expert instructional designer. Generate a week-by-week curriculum plan.\n\nCOURSE: ${title}\nTYPE: ${courseType}\nDESCRIPTION: ${description}\nPERIOD: ${academicPeriod}\nMODALITY: ${modality}\nSCHEDULE: ${classSchedule} | Days: ${(classDays as string[]).join(', ')}\nTOTAL TEACHING WEEKS: ${effectiveWeeks} (out of ${totalWeeks} calendar weeks)\nSTART DATE: ${startDate}${exceptionNote}${asyncNote}${syncNote}\n\nCONFIGURED EVALUATIONS:\n${evalSummary}\n\nSYLLABUS:\n${(syllabusInput as string).slice(0, 2500)}\n\nDistribute the syllabus progressively week by week. For weeks with evaluations, include the evaluation in evalEvent. For each week include: procedure (suggested classroom activity) and notes (important observations, upcoming deadlines, or reminders).\n\nRespond ONLY with valid JSON (no markdown):\n${jsonFormat}`
      : `Eres un experto en diseño curricular. Genera un plan de estudios detallado semana por semana.\n\nCURSO: ${title}\nTIPO: ${courseType}\nDESCRIPCIÓN: ${description}\nPERÍODO: ${academicPeriod}\nMODALIDAD: ${modality}\nHORARIO: ${classSchedule} | Días: ${(classDays as string[]).join(', ')}\nSEMANAS LECTIVAS: ${effectiveWeeks} (de ${totalWeeks} semanas calendario)\nFECHA INICIO: ${startDate}${exceptionNote}${asyncNote}${syncNote}\n\nEVALUACIONES CONFIGURADAS:\n${evalSummary}\n\nCONTENIDO / TEMARIO:\n${(syllabusInput as string).slice(0, 2500)}\n\nDistribuye el temario progresivamente semana a semana. Para semanas con evaluaciones, inclúyelas en evalEvent. Por cada semana incluye: procedure (actividad sugerida en clase) y notes (observaciones importantes, entregas próximas o recordatorios).\n\nResponde ÚNICAMENTE con JSON válido (sin markdown):\n${jsonFormat}`;

    const result = await invokeBedrockForJson(prompt, 64000);
    if (!result?.weeklyPlan || !Array.isArray(result.weeklyPlan)) {
      await saveAiJob(_jobId, { status: 'error', error: 'El modelo no pudo generar el plan. Intenta de nuevo.' });
    } else {
      // Post-process: enforce unique module per week (sync AND async — a module must
      // never span 2 weeks in either modality). Even with the strict prompt, Bedrock
      // sometimes reuses module names across weeks.
      {
        const seenModules = new Map<string, number>();
        const newModules: any[] = Array.isArray(result.modules) ? [...result.modules] : [];
        for (const wk of result.weeklyPlan) {
          const orig: string = wk.module ?? '';
          if (!orig) continue;
          const seen = seenModules.get(orig) ?? 0;
          if (seen > 0) {
            // Duplicate — create a unique sub-module name
            const suffix = isEN ? ` — Part ${seen + 1}` : ` — Parte ${seen + 1}`;
            const newName = `${orig}${suffix}`;
            wk.module = newName;
            // Clone the original module entry with the new name
            const parentMod = newModules.find((m: any) => m.name === orig || m.nameEN === orig);
            if (parentMod) {
              newModules.push({
                ...parentMod,
                name: parentMod.name ? `${parentMod.name}${suffix}` : newName,
                nameEN: parentMod.nameEN ? `${parentMod.nameEN}${isEN ? ` — Part ${seen + 1}` : ` — Part ${seen + 1}`}` : newName,
                weeks: [wk.weekNum],
              });
            } else {
              newModules.push({ name: newName, nameEN: newName, description: '', descriptionEN: '', weeks: [wk.weekNum] });
            }
            console.warn(`[wizard-copilot] dedup (${isAsync ? 'async' : 'sync'}): week ${wk.weekNum} had duplicate module "${orig}" → renamed "${newName}"`);
          }
          seenModules.set(orig, seen + 1);
        }
        result.modules = newModules;
      }
      await saveAiJob(_jobId, { status: 'done', weeklyPlan: result.weeklyPlan, modules: result.modules ?? [] });
    }
  } catch (err: any) {
    await saveAiJob(_jobId, { status: 'error', error: err?.message ?? 'Error generando plan' });
  }
  return ok({});
}
