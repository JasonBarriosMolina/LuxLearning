'use client';

// Previews module content types other than async lessons — quiz, reflection,
// Lux Mentor class, interview. Added 2026-09-01: the "Ver como Estudiante"
// preview only ever showed lessons, so an evaluator couldn't actually check a
// module's quiz questions or class script for errors before publishing
// (Mack: "en esa vista es importante que me den la posibilidad de identificar
// posibles errores").
import { HelpCircle, MessageSquare, Mic, GraduationCap, CheckCircle2, FileText } from 'lucide-react';

interface Props {
  extra: { kind: 'quiz' | 'reflection' | 'class' | 'interview' | 'evidence'; module: any };
  course: any;
}

export function ExtraContentPreview({ extra, course }: Props) {
  const { kind, module: mod } = extra;

  if (kind === 'quiz') {
    const questions = mod.questions ?? [];
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-cta-from" />
          <h3 className="font-heading font-bold text-xl text-charcoal">Quiz — {mod.title}</h3>
        </div>
        <p className="text-xs text-gray-400">{questions.length} preguntas · aprobar con {mod.passingScore ?? 70}%</p>
        <div className="space-y-4">
          {questions.map((q: any, i: number) => (
            <div key={q.id ?? i} className="border border-border rounded-xl p-4">
              <p className="text-sm font-semibold text-charcoal mb-2">{i + 1}. {q.text}</p>
              <ul className="space-y-1.5">
                {(q.options ?? []).map((opt: string, oi: number) => (
                  <li key={oi} className={`text-sm flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${oi === q.correctIndex ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-gray-600'}`}>
                    {oi === q.correctIndex ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <span className="w-3.5 h-3.5 shrink-0" />}
                    {opt}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {questions.length === 0 && <p className="text-sm text-gray-400">Sin preguntas generadas todavía.</p>}
        </div>
      </div>
    );
  }

  if (kind === 'class') {
    const ev = (course.evaluationEvents ?? []).find((e: any) => e.moduleId === mod.id && e.type === 'CLASS');
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-cta-from" />
          <h3 className="font-heading font-bold text-xl text-charcoal">Clase con Lux Mentor — {mod.title}</h3>
        </div>
        {ev?.lessonScript && (
          <div className="border border-border rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Guión narrado (exposición, Amazon Polly)</p>
            <p className="text-sm text-charcoal whitespace-pre-wrap leading-relaxed">{ev.lessonScript}</p>
          </div>
        )}
        {ev?.vapiPrompt && (
          <div className="border border-border rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Prompt de la sesión de preguntas (Vapi)</p>
            <p className="text-sm text-charcoal whitespace-pre-wrap leading-relaxed">{ev.vapiPrompt}</p>
          </div>
        )}
        {ev?.closingScript && (
          <div className="border border-border rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Cierre narrado</p>
            <p className="text-sm text-charcoal whitespace-pre-wrap leading-relaxed">{ev.closingScript}</p>
          </div>
        )}
        {!ev && <p className="text-sm text-gray-400">Contenido de la clase no generado todavía.</p>}
      </div>
    );
  }

  // reflection / interview — no generated script to preview (student-authored /
  // live-voice/student-uploaded), just confirm it's planned and show the
  // evaluator-set instructions.
  const ev = (course.evaluationEvents ?? []).find((e: any) => e.moduleId === mod.id && e.type === kind.toUpperCase());
  const Icon = kind === 'reflection' ? MessageSquare : kind === 'evidence' ? FileText : Mic;
  const label = kind === 'reflection' ? 'Reflexión' : kind === 'evidence' ? (ev?.name || 'Evidencia') : 'Entrevista con Lux Mentor';
  const description = kind === 'reflection'
    ? 'El estudiante escribe esta reflexión después de aprobar el quiz — no hay contenido generado que previsualizar aquí.'
    : kind === 'evidence'
      ? 'El estudiante sube un archivo/entregable aquí — no hay contenido generado que previsualizar, solo las instrucciones de abajo.'
      : 'Esta es una entrevista de voz en vivo con Lux Mentor — no hay guión fijo que previsualizar aquí.';
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Icon className="w-5 h-5 text-cta-from" />
        <h3 className="font-heading font-bold text-xl text-charcoal">{label} — {mod.title}</h3>
      </div>
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
        {description}
      </div>
      {ev?.instructions && (
        <div className="border border-border rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Instrucciones</p>
          <p className="text-sm text-charcoal whitespace-pre-wrap leading-relaxed">{ev.instructions}</p>
        </div>
      )}
    </div>
  );
}
