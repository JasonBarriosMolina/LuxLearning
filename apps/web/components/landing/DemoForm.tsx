'use client';

import { useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { getApiUrl } from '@/lib/api';

const ORG_TYPES = ['Colegio o escuela', 'Universidad', 'Empresa', 'Gobierno u ONG', 'Otro'];
const SIZES = ['Menos de 50', '50 a 200', '201 a 1,000', 'Más de 1,000'];

type Fields = { name: string; email: string; phone: string; organization: string; orgType: string; size: string; message: string };
type Errors = Partial<Record<keyof Fields, string>>;

const EMPTY: Fields = { name: '', email: '', phone: '', organization: '', orgType: '', size: '', message: '' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(f: Fields): Errors {
  const e: Errors = {};
  if (f.name.trim().length < 2) e.name = 'Escribe tu nombre completo.';
  if (!EMAIL_RE.test(f.email.trim())) e.email = 'Escribe un correo válido, por ejemplo nombre@institucion.edu.';
  if (f.organization.trim().length < 2) e.organization = 'Escribe el nombre de tu institución o empresa.';
  if (!f.orgType) e.orgType = 'Elige el tipo de institución.';
  if (!f.size) e.size = 'Elige un número aproximado.';
  return e;
}

const inputCls =
  'mt-2 w-full rounded-xl border bg-lx-paper px-4 py-3 text-base text-lx-ink outline-none transition-colors placeholder:text-lx-soft focus:border-[#3E8FD0] focus:shadow-[0_0_0_4px_rgba(62,143,208,0.18)]';

export function DemoForm() {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [honeypot, setHoneypot] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  const set = (key: keyof Fields) => (value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validate(fields);
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(`demo-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    setStatus('sending');
    try {
      // The platform routes (lux-platform) live on each environment's API Gateway, next to the tenant API.
      const base = process.env.NEXT_PUBLIC_PLATFORM_API_URL ?? getApiUrl();
      const res = await fetch(`${base}/public/demo-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, website: honeypot, source: 'landing' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('sent');
    } catch (err) {
      console.error('[DemoForm]', err);
      setStatus('failed');
    }
  };

  if (status === 'sent') {
    return (
      <div className="lx-panel-in rounded-[28px] bg-lx-paper p-10 text-center shadow-[0_30px_80px_-40px_rgba(29,50,71,0.35)]" role="status">
        <CheckCircle2 className="mx-auto h-14 w-14 text-cta-from" aria-hidden="true" />
        <h2 className="mt-5 text-3xl font-extrabold tracking-[-0.02em]">Recibimos tu solicitud</h2>
        <p className="mx-auto mt-3 max-w-md leading-relaxed text-lx-muted">
          Gracias, {fields.name.split(' ')[0]}. Te escribiremos a {fields.email} en menos de un día hábil para agendar tu demo.
        </p>
      </div>
    );
  }

  const field = (key: keyof Fields, label: string, input: React.ReactNode, optional = false) => (
    <div>
      <label htmlFor={`demo-${key}`} className="text-sm font-bold text-lx-ink">
        {label}
        {optional && <span className="font-medium text-lx-soft"> (opcional)</span>}
      </label>
      {input}
      {errors[key] && (
        <p id={`demo-${key}-error`} className="mt-1.5 text-sm font-medium text-[#B42318]">
          {errors[key]}
        </p>
      )}
    </div>
  );

  const aria = (key: keyof Fields) => ({
    id: `demo-${key}`,
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `demo-${key}-error` : undefined,
    className: `${inputCls} ${errors[key] ? 'border-[#F04438]' : 'border-lx-line'}`,
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="lx-edge rounded-[28px] bg-[rgba(255,255,255,0.88)] p-6 shadow-[0_30px_80px_-40px_rgba(29,50,71,0.35)] backdrop-blur-sm sm:p-10"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {field('name', 'Nombre completo', <input {...aria('name')} autoComplete="name" value={fields.name} onChange={(e) => set('name')(e.target.value)} />)}
        {field('email', 'Correo de trabajo', <input {...aria('email')} type="email" autoComplete="email" placeholder="nombre@institucion.edu" value={fields.email} onChange={(e) => set('email')(e.target.value)} />)}
        {field('phone', 'Teléfono o WhatsApp', <input {...aria('phone')} type="tel" autoComplete="tel" value={fields.phone} onChange={(e) => set('phone')(e.target.value)} />, true)}
        {field('organization', 'Institución o empresa', <input {...aria('organization')} autoComplete="organization" value={fields.organization} onChange={(e) => set('organization')(e.target.value)} />)}
        {field(
          'orgType',
          'Tipo de institución',
          <select {...aria('orgType')} value={fields.orgType} onChange={(e) => set('orgType')(e.target.value)}>
            <option value="">Elige una opción</option>
            {ORG_TYPES.map((o) => <option key={o}>{o}</option>)}
          </select>,
        )}
        {field(
          'size',
          '¿Cuántos estudiantes o colaboradores?',
          <select {...aria('size')} value={fields.size} onChange={(e) => set('size')(e.target.value)}>
            <option value="">Elige un rango</option>
            {SIZES.map((o) => <option key={o}>{o}</option>)}
          </select>,
        )}
      </div>

      <div className="mt-5">
        {field(
          'message',
          '¿Qué te gustaría lograr con Lux?',
          <textarea {...aria('message')} rows={4} placeholder="Queremos capacitar a nuestros docentes en planeación didáctica…" value={fields.message} onChange={(e) => set('message')(e.target.value)} />,
          true,
        )}
      </div>

      {/* Honeypot: hidden from people, filled by bots */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="demo-website">Sitio web</label>
        <input id="demo-website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
      </div>

      {status === 'failed' && (
        <p className="mt-6 rounded-xl bg-[#FEF3F2] p-4 text-sm font-medium text-[#B42318]" role="alert">
          No pudimos enviar tu solicitud. Inténtalo de nuevo en unos minutos o escríbenos a{' '}
          <a href="mailto:sales@luxlearning.academy" className="font-bold underline">sales@luxlearning.academy</a>.
        </p>
      )}

      <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-sm text-sm leading-relaxed text-lx-soft">Usaremos tus datos solo para contactarte sobre tu demo.</p>
        <button type="submit" disabled={status === 'sending'} className="lx-btn lx-btn-blue w-full sm:w-auto">
          {status === 'sending' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {status === 'sending' ? 'Enviando solicitud' : 'Agendar mi demo'}
        </button>
      </div>
    </form>
  );
}
