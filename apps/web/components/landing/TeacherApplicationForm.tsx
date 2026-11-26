'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import { getApiUrl } from '@/lib/api';
import { ChoiceField, TextAreaField, TextField } from './form-controls';
import { TEACHER_OPTIONS as O } from './teacher-application-options';
import { ONBOARDING_STEPS } from './content';

type Fields = {
  name: string; email: string; phone: string; country: string; city: string; profileUrl: string;
  areas: string[]; areaOther: string; yearsProfessional: string; yearsTeaching: string; education: string; certifications: string;
  liveInterest: string; audiences: string[]; hasOnlineCourses: string; onlineCourseUrl: string;
  courseTopic: string; courseAudience: string; courseOutcome: string; courseModules: string;
  roles: string[]; hoursPerWeek: string; materials: string[]; videoComfort: string; equipment: string[];
  motivation: string; consent: boolean;
};
type Key = keyof Fields;
type Errors = Partial<Record<Key, string>>;

const EMPTY: Fields = {
  name: '', email: '', phone: '', country: '', city: '', profileUrl: '',
  areas: [], areaOther: '', yearsProfessional: '', yearsTeaching: '', education: '', certifications: '',
  liveInterest: '', audiences: [], hasOnlineCourses: '', onlineCourseUrl: '',
  courseTopic: '', courseAudience: '', courseOutcome: '', courseModules: '',
  roles: [], hoursPerWeek: '', materials: [], videoComfort: '', equipment: [],
  motivation: '', consent: false,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isUrl = (v: string) => /^https?:\/\/\S+\.\S+/.test(v);
const need = (v: string | string[]) => (Array.isArray(v) ? v.length > 0 : v.trim().length > 0);

const STEPS: { title: string; check: (f: Fields) => Errors }[] = [
  {
    title: 'Sobre ti',
    check: (f) => ({
      ...(f.name.trim().length < 2 && { name: 'Escribe tu nombre completo.' }),
      ...(!EMAIL_RE.test(f.email.trim()) && { email: 'Escribe un correo válido.' }),
      ...(f.country.trim().length < 2 && { country: 'Escribe tu país.' }),
      ...(f.profileUrl.trim() && !isUrl(f.profileUrl.trim()) && { profileUrl: 'Escribe un enlace que empiece con https://' }),
    }),
  },
  {
    title: 'Tu experiencia',
    check: (f) => ({
      ...(!need(f.areas) && { areas: 'Elige al menos un área.' }),
      ...(f.areas.includes('Otra') && f.areaOther.trim().length < 2 && { areaOther: 'Cuéntanos cuál es tu otra área.' }),
      ...(!need(f.yearsProfessional) && { yearsProfessional: 'Elige una opción.' }),
      ...(!need(f.yearsTeaching) && { yearsTeaching: 'Elige una opción.' }),
      ...(!need(f.education) && { education: 'Elige tu nivel de formación.' }),
    }),
  },
  {
    title: 'Cómo enseñas',
    check: (f) => ({
      ...(!need(f.liveInterest) && { liveInterest: 'Elige una opción.' }),
      ...(!need(f.audiences) && { audiences: 'Elige al menos un público.' }),
      ...(!need(f.hasOnlineCourses) && { hasOnlineCourses: 'Elige una opción.' }),
      ...(f.hasOnlineCourses === 'Sí' && f.onlineCourseUrl.trim() && !isUrl(f.onlineCourseUrl.trim()) && { onlineCourseUrl: 'Escribe un enlace que empiece con https://' }),
    }),
  },
  {
    title: 'Tu primer curso',
    check: (f) => ({
      ...(f.courseTopic.trim().length < 3 && { courseTopic: 'Cuéntanos el tema de tu curso.' }),
      ...(f.courseAudience.trim().length < 3 && { courseAudience: 'Cuéntanos a quién va dirigido.' }),
      ...(f.courseOutcome.trim().length < 10 && { courseOutcome: 'Cuéntanos en una o dos frases qué logrará el estudiante.' }),
      ...(!need(f.courseModules) && { courseModules: 'Elige una opción.' }),
    }),
  },
  {
    title: 'Participación y recursos',
    check: (f) => ({
      ...(!need(f.roles) && { roles: 'Elige al menos una opción.' }),
      ...(!need(f.hoursPerWeek) && { hoursPerWeek: 'Elige una opción.' }),
      ...(!need(f.materials) && { materials: 'Elige al menos una opción.' }),
      ...(!need(f.videoComfort) && { videoComfort: 'Elige una opción.' }),
      ...(!need(f.equipment) && { equipment: 'Elige al menos una opción.' }),
    }),
  },
  {
    title: 'Tu motivación',
    check: (f) => ({
      ...(f.motivation.trim().length < 20 && { motivation: 'Cuéntanos en unas líneas por qué quieres enseñar con Lux.' }),
      ...(!f.consent && { consent: 'Necesitamos tu autorización para contactarte.' }),
    }),
  },
];

export function TeacherApplicationForm() {
  const [f, setF] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [step, setStep] = useState(0);
  const [honeypot, setHoneypot] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [serverError, setServerError] = useState('');
  const topRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [step, status]);

  const set = <K extends Key>(key: K) => (value: Fields[K]) => {
    setF((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const text = (key: Key) => ({
    value: f[key] as string,
    onChange: (e: { target: { value: string } }) => set(key)(e.target.value as never),
    error: errors[key],
  });
  const choice = (key: Key) => ({ value: f[key] as string | string[], onChange: (v: string | string[]) => set(key)(v as never), error: errors[key] });

  const validate = () => {
    const found = STEPS[step]!.check(f);
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) document.getElementById(`ta-${first}`)?.focus();
    return !first;
  };

  const next = () => { if (validate()) setStep((s) => s + 1); };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (step < STEPS.length - 1) return next();
    if (!validate()) return;
    setStatus('sending');
    setServerError('');
    try {
      const base = process.env.NEXT_PUBLIC_PLATFORM_API_URL ?? getApiUrl();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`${base}/public/teacher-applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, timezone, website: honeypot, source: 'landing' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setServerError(res.status === 400 && body?.error ? body.error : '');
        throw new Error(`HTTP ${res.status}`);
      }
      setStatus('sent');
    } catch (err) {
      console.error('[TeacherApplicationForm]', err);
      setStatus('failed');
    }
  };

  if (status === 'sent') {
    return (
      <div ref={topRef} className="lx-panel-in scroll-mt-28 rounded-[28px] bg-lx-paper p-8 shadow-[0_30px_80px_-40px_rgba(15,45,74,0.45)] ring-1 ring-lx-line sm:p-12" role="status">
        <CheckCircle2 className="h-14 w-14 text-lx-royal" aria-hidden="true" />
        <h2 className="mt-5 text-3xl font-extrabold tracking-[-0.02em] text-lx-navy">¡Gracias, {f.name.split(' ')[0]}! Recibimos tu postulación</h2>
        <p className="mt-3 max-w-xl leading-relaxed text-lx-muted">Te enviamos una confirmación a {f.email}. Esto es lo que sigue:</p>
        <ol className="mt-8 space-y-5">
          {ONBOARDING_STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#2F8FDB,#17527E)] font-extrabold text-white">{i + 1}</span>
              <div>
                <p className="font-bold text-lx-navy">{s.title}</p>
                <p className="mt-1 leading-relaxed text-lx-muted">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const last = step === STEPS.length - 1;
  const pct = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <div ref={topRef} className="scroll-mt-28">
      <div className="mb-6">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-lg font-extrabold text-lx-navy">{STEPS[step]!.title}</p>
          <p className="text-sm font-bold text-lx-royal">Paso {step + 1} de {STEPS.length}</p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-lx-ice" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso de la postulación">
          <div className="h-full rounded-full bg-gradient-to-r from-[#1FA2C7] via-[#2F8FDB] to-[#17527E] transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <form onSubmit={onSubmit} noValidate className="lx-edge relative rounded-[28px] bg-[rgba(255,255,255,0.92)] p-6 shadow-[0_30px_80px_-40px_rgba(15,45,74,0.45)] sm:p-10">
        <div key={step} className="lx-panel-in space-y-7">
          {step === 0 && (
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField id="ta-name" label="Nombre completo" autoComplete="name" {...text('name')} />
              <TextField id="ta-email" label="Correo" type="email" autoComplete="email" placeholder="nombre@correo.com" {...text('email')} />
              <TextField id="ta-phone" label="Teléfono o WhatsApp" type="tel" autoComplete="tel" optional {...text('phone')} />
              <TextField id="ta-country" label="País" autoComplete="country-name" {...text('country')} />
              <TextField id="ta-city" label="Ciudad" autoComplete="address-level2" optional {...text('city')} />
              <TextField id="ta-profileUrl" label="LinkedIn o portafolio" type="url" placeholder="https://" optional {...text('profileUrl')} />
            </div>
          )}

          {step === 1 && (
            <>
              <ChoiceField id="ta-areas" label="¿En qué áreas eres especialista?" options={O.areas} multiple {...choice('areas')} />
              {f.areas.includes('Otra') && <TextField id="ta-areaOther" label="¿Cuál es tu otra área?" {...text('areaOther')} />}
              <ChoiceField id="ta-yearsProfessional" label="Años de experiencia profesional en tu área" options={O.yearsProfessional} {...choice('yearsProfessional')} />
              <ChoiceField id="ta-yearsTeaching" label="Años de experiencia enseñando o capacitando" options={O.yearsTeaching} {...choice('yearsTeaching')} />
              <ChoiceField id="ta-education" label="Tu nivel de formación más alto" options={O.education} {...choice('education')} />
              <TextAreaField id="ta-certifications" label="Certificaciones o formación relevante" rows={3} optional {...text('certifications')} />
            </>
          )}

          {step === 2 && (
            <>
              <ChoiceField id="ta-liveInterest" label="¿Te interesa dar clases en vivo?" hint="Además de crear tu curso, algunos programas incluyen sesiones en vivo." options={O.liveInterest} {...choice('liveInterest')} />
              <ChoiceField id="ta-audiences" label="¿Con qué públicos has trabajado?" options={O.audiences} multiple {...choice('audiences')} />
              <ChoiceField id="ta-hasOnlineCourses" label="¿Ya has creado cursos en línea?" options={O.hasOnlineCourses} {...choice('hasOnlineCourses')} />
              {f.hasOnlineCourses === 'Sí' && (
                <TextField id="ta-onlineCourseUrl" label="Comparte un enlace a uno de tus cursos" type="url" placeholder="https://" optional {...text('onlineCourseUrl')} />
              )}
            </>
          )}

          {step === 3 && (
            <>
              <TextField id="ta-courseTopic" label="¿Sobre qué tema sería tu primer curso en Lux?" placeholder="Liderazgo para nuevos jefes" {...text('courseTopic')} />
              <TextField id="ta-courseAudience" label="¿A quién va dirigido?" placeholder="Personas recién ascendidas a un puesto de jefatura" {...text('courseAudience')} />
              <TextAreaField id="ta-courseOutcome" label="¿Qué podrá hacer el estudiante al terminarlo?" rows={3} placeholder="Dirigir reuniones efectivas y dar retroalimentación clara a su equipo." {...text('courseOutcome')} />
              <ChoiceField id="ta-courseModules" label="¿Cuántos módulos imaginas?" options={O.courseModules} {...choice('courseModules')} />
            </>
          )}

          {step === 4 && (
            <>
              <ChoiceField id="ta-roles" label="¿Cómo te gustaría participar?" options={O.roles} multiple {...choice('roles')} />
              <ChoiceField id="ta-hoursPerWeek" label="¿Cuántas horas por semana podrías dedicar?" options={O.hoursPerWeek} {...choice('hoursPerWeek')} />
              <ChoiceField id="ta-materials" label="¿Qué material tienes ya preparado?" options={O.materials} multiple {...choice('materials')} />
              <ChoiceField id="ta-videoComfort" label="¿Qué tan cómodo te sientes grabando video?" options={O.videoComfort} {...choice('videoComfort')} />
              <ChoiceField id="ta-equipment" label="¿Con qué equipo cuentas?" options={O.equipment} multiple {...choice('equipment')} />
            </>
          )}

          {step === 5 && (
            <>
              <TextAreaField id="ta-motivation" label="¿Por qué quieres enseñar con Lux?" hint="En pocas líneas: qué te mueve a enseñar y qué te gustaría lograr con nosotros." rows={5} {...text('motivation')} />
              <div>
                <label className="flex items-start gap-3 text-sm leading-relaxed text-lx-muted">
                  <input
                    id="ta-consent"
                    type="checkbox"
                    checked={f.consent}
                    onChange={(e) => set('consent')(e.target.checked)}
                    aria-invalid={errors.consent ? true : undefined}
                    className="mt-1 h-5 w-5 shrink-0 accent-[#17527E]"
                  />
                  Autorizo a Lux Learning a usar estos datos para evaluar mi postulación y contactarme sobre el proceso.
                </label>
                {errors.consent && <p className="mt-1.5 text-sm font-medium text-[#B42318]">{errors.consent}</p>}
              </div>
            </>
          )}
        </div>

        <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
          <label htmlFor="ta-website">Sitio web</label>
          <input id="ta-website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
        </div>

        {status === 'failed' && (
          <p className="mt-6 rounded-xl bg-[#FEF3F2] p-4 text-sm font-medium text-[#B42318]" role="alert">
            {serverError || 'No pudimos enviar tu postulación. Inténtalo de nuevo en unos minutos.'} Si el problema sigue, escríbenos a{' '}
            <a href="mailto:talent@luxlearning.academy" className="font-bold underline">talent@luxlearning.academy</a>.
          </p>
        )}

        <div className="mt-9 flex flex-col-reverse gap-3 border-t border-lx-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          {step > 0 ? (
            <button type="button" onClick={() => { setErrors({}); setStep((s) => s - 1); }} className="lx-btn lx-btn-ghost">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Anterior
            </button>
          ) : <span />}
          <button type="submit" disabled={status === 'sending'} className="lx-btn lx-btn-blue">
            {status === 'sending' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {last ? (status === 'sending' ? 'Enviando postulación' : 'Enviar postulación') : 'Siguiente'}
            {!last && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </form>
    </div>
  );
}
