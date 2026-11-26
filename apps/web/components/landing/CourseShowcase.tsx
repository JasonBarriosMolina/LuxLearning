import Link from 'next/link';
import {
  ArrowRight, Radio, PlayCircle, Users, MessagesSquare, NotebookPen, CalendarClock, HeartHandshake, Sparkles,
  type LucideIcon,
} from 'lucide-react';
import type { Course, CourseTone } from './content';

const COVERS: Record<CourseTone, string> = {
  navy: 'radial-gradient(ellipse 70% 90% at 90% 0%, rgba(47,143,219,0.75), transparent 70%), linear-gradient(150deg, #0F2D4A, #17527E)',
  royal: 'radial-gradient(ellipse 70% 90% at 10% 0%, rgba(108,180,238,0.7), transparent 70%), linear-gradient(150deg, #17527E, #2F8FDB)',
  cyan: 'radial-gradient(ellipse 70% 90% at 90% 100%, rgba(108,201,227,0.75), transparent 70%), linear-gradient(150deg, #1F6FB2, #1FA2C7)',
};

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Liderazgo: Users,
  Habilidades: MessagesSquare,
  Docencia: NotebookPen,
  Productividad: CalendarClock,
  Negocios: HeartHandshake,
};

export function CourseShowcase({ id, title, text, courses, showAllLink = true, ctaHref = '/register' }: {
  id?: string;
  title: string;
  text: string;
  courses: Course[];
  showAllLink?: boolean;
  ctaHref?: string;
}) {
  return (
    <section id={id} className="scroll-mt-24 px-5 py-24 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <h2 className="text-4xl font-extrabold leading-[1.08] tracking-[-0.03em] text-lx-navy md:text-5xl">{title}</h2>
            <p className="mt-4 text-lg leading-relaxed text-lx-muted">{text}</p>
          </div>
          {showAllLink && (
            <Link href="/cursos#catalogo" className="lx-btn lx-btn-ghost shrink-0 self-start md:self-auto">
              Ver todos los cursos
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        </div>

        <ul className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => {
            const Icon = CATEGORY_ICONS[course.category] ?? Sparkles;
            return (
              <li key={course.title}>
                <Link
                  href={ctaHref}
                  className="group flex h-full flex-col overflow-hidden rounded-3xl bg-lx-paper shadow-[0_1px_0_rgba(15,45,74,0.06),0_24px_55px_-32px_rgba(15,45,74,0.5)] ring-1 ring-lx-line transition-transform duration-300 hover:-translate-y-1"
                >
                  <div className="relative h-44 overflow-hidden" style={{ background: COVERS[course.tone] }}>
                    <div className="lx-dots absolute inset-0 opacity-50" aria-hidden="true" />
                    <span className="absolute left-5 top-5 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-lx-navy">
                      {course.modality === 'En vivo' ? (
                        <Radio className="h-3.5 w-3.5 text-[#E0533D]" aria-hidden="true" />
                      ) : (
                        <PlayCircle className="h-3.5 w-3.5 text-lx-royal" aria-hidden="true" />
                      )}
                      {course.modality}
                    </span>
                    <span className="absolute bottom-5 left-5 text-xs font-bold text-white/90">{course.category}</span>
                    <Icon
                      className="absolute -bottom-3 right-4 h-24 w-24 text-white/25 transition-transform duration-500 group-hover:scale-110"
                      strokeWidth={1.3}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-6">
                    <h3 className="text-xl font-extrabold tracking-[-0.02em] text-lx-navy">{course.title}</h3>
                    <p className="mt-2 flex-1 leading-relaxed text-lx-muted">{course.desc}</p>
                    <div className="mt-6 flex items-center justify-between border-t border-lx-line pt-4 text-sm font-semibold">
                      <span className="text-lx-soft">{course.length}</span>
                      <span className="inline-flex items-center gap-1.5 text-lx-royal">
                        Quiero tomarlo
                        <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true" />
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
