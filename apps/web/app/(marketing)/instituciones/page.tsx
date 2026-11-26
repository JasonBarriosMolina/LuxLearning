import type { Metadata } from 'next';
import { CalendarCheck, MessagesSquare, Rocket, Users } from 'lucide-react';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { PageHero, FeatureGrid, StepsSection } from '@/components/landing/sections';
import { DemoForm } from '@/components/landing/DemoForm';

export const metadata: Metadata = {
  title: 'Para instituciones',
  description: 'Agenda una demo y conoce cómo reunir cursos, grupos, asistencia y reportes de avance de tu escuela o empresa en una sola plataforma.',
};

const DEMO_ANCHOR = '#agendar-demo';

const GROUPS = [
  { name: 'Docentes · Primaria', students: 28, attendance: 94, progress: 68, bar: 'from-[#17527E] to-[#2F8FDB]' },
  { name: 'Liderazgo · Mandos medios', students: 19, attendance: 89, progress: 81, bar: 'from-[#1F6FB2] to-[#1FA2C7]' },
  { name: 'Servicio al cliente', students: 34, attendance: 91, progress: 45, bar: 'from-[#0F2D4A] to-[#1F6FB2]' },
];

/** A glimpse of what an institution sees: each group's attendance and progress. */
function GroupsPreview() {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -left-8 -top-10 h-60 w-60 rounded-full bg-[radial-gradient(circle,rgba(47,143,219,0.3),transparent_70%)] blur-2xl" aria-hidden="true" />
      <div className="lx-edge relative rounded-[28px] bg-[rgba(255,255,255,0.88)] p-6 shadow-[0_30px_80px_-40px_rgba(15,45,74,0.45)] backdrop-blur-sm sm:p-8">
        <div className="flex items-center justify-between">
          <p className="text-lg font-extrabold text-lx-navy">Avance por grupo</p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-lx-ice px-3 py-1 text-xs font-bold text-lx-royal">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            81 estudiantes
          </span>
        </div>
        <ul className="mt-6 space-y-5">
          {GROUPS.map((g) => (
            <li key={g.name}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-bold text-lx-navy">{g.name}</p>
                <p className="text-sm font-bold text-lx-royal">{g.progress}%</p>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-lx-ice">
                <div className={`h-full rounded-full bg-gradient-to-r ${g.bar}`} style={{ width: `${g.progress}%` }} />
              </div>
              <p className="mt-1.5 text-xs font-semibold text-lx-muted">
                {g.students} estudiantes · asistencia {g.attendance}%
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const NEXT_STEPS = [
  { icon: MessagesSquare, title: 'Te contactamos', text: 'En menos de un día hábil te escribimos para elegir el mejor horario.' },
  { icon: CalendarCheck, title: 'Conversamos 30 minutos', text: 'Conocemos tus programas y te mostramos Lux con ejemplos de tu área.' },
  { icon: Rocket, title: 'Arrancas con un piloto', text: 'Si te convence, configuramos un primer grupo para que lo pruebes.' },
];

export default function InstitucionesPage() {
  return (
    <>
      <LandingNav />
      <main>
        <PageHero
          title="Tus programas de formación, en un solo lugar"
          subtitle="Crea cursos, organiza a tus grupos y conoce el avance de cada estudiante, con profesionales que acompañan su aprendizaje."
          primary={{ label: 'Agendar una demo', href: DEMO_ANCHOR }}
          secondary={{ label: 'Ver cómo funciona', href: '#como-funciona' }}
          aside={<GroupsPreview />}
        />
        <FeatureGrid
          title="Todo tu programa, sin hojas de cálculo"
          intro="Lo que hoy tienes repartido entre archivos, correos y planillas, ordenado en una sola plataforma."
          features={[
            { title: 'Cursos a la medida', desc: 'Diseña cursos con lecciones, quizzes, reflexiones y material de apoyo.' },
            { title: 'Grupos organizados', desc: 'Agrupa a tus estudiantes y asigna cursos por grupo o por período.' },
            { title: 'Asistencia al día', desc: 'Registra asistencia por sesión y detecta a tiempo a quién hay que apoyar.' },
            { title: 'Clases bien planeadas', desc: 'Programa sesiones y asigna evaluadores antes de publicarlas.' },
            { title: 'Reportes que se entienden', desc: 'Consulta avance y resultados por estudiante, grupo o curso.' },
            { title: 'Certificados con tu nombre', desc: 'Tus estudiantes reciben un certificado verificable al completar su programa.' },
          ]}
        />
        <div id="como-funciona" className="scroll-mt-24">
          <StepsSection
            title="Así empezamos juntos"
            intro="Sin instalaciones ni procesos largos. Empezamos pequeño y crecemos contigo."
            steps={[
              { title: 'Agenda tu demo', desc: 'Conversamos sobre tus programas y te mostramos Lux con ejemplos reales.' },
              { title: 'Arrancamos con un grupo piloto', desc: 'Configuramos tus cursos y damos acceso a tus primeros estudiantes.' },
              { title: 'Creces con resultados', desc: 'Sigues el avance en los reportes y sumas grupos cuando estés listo.' },
            ]}
          />
        </div>

        <section id="agendar-demo" className="lx-band-deep relative scroll-mt-20 overflow-hidden px-5 py-24 lg:px-10">
          <div className="lx-dots pointer-events-none absolute inset-y-0 left-0 w-1/2 opacity-40" aria-hidden="true" />
          <div className="relative mx-auto grid max-w-7xl gap-14 lg:grid-cols-[1fr_1.35fr]">
            <div>
              <h2 className="text-4xl font-extrabold leading-[1.06] tracking-[-0.035em] sm:text-5xl">Agenda tu demo</h2>
              <p className="mt-5 max-w-lg text-lg leading-relaxed text-white/80">
                Cuéntanos un poco sobre tu institución y te mostramos cómo Lux puede ayudarte a formar mejor a tus estudiantes y
                colaboradores.
              </p>
              <ol className="mt-10 space-y-6">
                {NEXT_STEPS.map(({ icon: Icon, title, text }) => (
                  <li key={title} className="flex gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-[#9FD3F5] ring-1 ring-white/20">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="font-bold">{title}</p>
                      <p className="mt-1 leading-relaxed text-white/75">{text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="text-lx-ink">
              <DemoForm />
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
    </>
  );
}
