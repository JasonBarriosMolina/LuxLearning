// Copy and data for the public landing pages. Edit text here, not in the components.

export type RouteStep = { label: string; text: string; quote?: { body: string; author: string } };

export const ROUTE_STEPS: RouteStep[] = [
  { label: 'Aprende', text: 'Clases claras y material práctico que puedes ver desde tu celular o tu computadora.' },
  { label: 'Practica', text: 'Pon a prueba lo que aprendiste con un quiz al final de cada módulo.' },
  { label: 'Reflexiona', text: 'Cuéntanos con tus palabras cómo aplicarías lo aprendido en tu día a día.' },
  {
    label: 'Recibe guía',
    text: 'Un profesional lee tu trabajo y te responde.',
    quote: { body: 'Muy buen ejemplo. Te sugiero agregar cómo medirías el resultado.', author: 'Ana, tu evaluadora' },
  },
  { label: 'Certifícate', text: 'Tu certificado está listo: compártelo con tu empresa o en LinkedIn.' },
];

export const VALUE_POINTS = [
  { icon: 'clock', title: 'En vivo o a tu ritmo', text: 'Elige clases con horario o avanza cuando y donde quieras.' },
  { icon: 'guide', title: 'Guiado por profesionales', text: 'Cada entrega la revisa alguien con experiencia real en el tema.' },
  { icon: 'badge', title: 'Certificado verificable', text: 'Al terminar, un certificado que cualquiera puede comprobar en línea.' },
] as const;

export type Modality = 'En vivo' | 'A tu ritmo';
export type CourseTone = 'navy' | 'royal' | 'cyan';
export type Course = { title: string; desc: string; category: string; modality: Modality; length: string; tone: CourseTone };

// TODO: sample catalog. Replace with real published courses before promoting to prod.
export const COURSES: Course[] = [
  { title: 'Liderazgo que inspira', desc: 'Guía a tu equipo con claridad, escucha activa y decisiones que se sostienen.', category: 'Liderazgo', modality: 'A tu ritmo', length: '6 módulos', tone: 'navy' },
  { title: 'Comunicación efectiva', desc: 'Explica tus ideas con seguridad en reuniones, presentaciones y por escrito.', category: 'Habilidades', modality: 'En vivo', length: '4 semanas', tone: 'royal' },
  { title: 'Planeación didáctica', desc: 'Diseña clases con objetivos claros y actividades que de verdad enganchan.', category: 'Docencia', modality: 'A tu ritmo', length: '5 módulos', tone: 'cyan' },
  { title: 'Gestión del tiempo', desc: 'Organiza tu semana, prioriza lo importante y termina lo que empiezas.', category: 'Productividad', modality: 'A tu ritmo', length: '4 módulos', tone: 'royal' },
  { title: 'Servicio al cliente', desc: 'Atiende con empatía, resuelve con criterio y convierte quejas en confianza.', category: 'Negocios', modality: 'En vivo', length: '3 semanas', tone: 'cyan' },
  { title: 'Inteligencia emocional', desc: 'Reconoce tus emociones y úsalas a tu favor en el trabajo y en tu vida.', category: 'Desarrollo personal', modality: 'A tu ritmo', length: '5 módulos', tone: 'navy' },
];

export const MENTOR_POINTS = [
  'Comentarios concretos sobre tu trabajo, no solo una calificación.',
  'Profesionales con experiencia en el área de tu curso.',
  'Sabes qué hiciste bien y cuál es tu siguiente paso.',
];

export type AudienceCard = { href: string; label: string; title: string; text: string; cta: string; tone: 'deep' | 'royal' | 'cyan' };

export const AUDIENCE_CARDS: AudienceCard[] = [
  {
    href: '/cursos',
    label: 'Para ti',
    title: 'Aprende algo nuevo y certifícalo',
    text: 'Cursos prácticos, en vivo o a tu ritmo, con la guía de un profesional en cada paso.',
    cta: 'Ver cursos',
    tone: 'royal',
  },
  {
    href: '/instituciones',
    label: 'Escuelas y empresas',
    title: 'Forma a tu equipo o a tus estudiantes',
    text: 'Cursos, grupos, asistencia y reportes de avance en una sola plataforma.',
    cta: 'Conocer la solución',
    tone: 'deep',
  },
  {
    href: '/profesores',
    label: 'Profesores',
    title: 'Enseña con mejores herramientas',
    text: 'Usa nuestras mini apps para tu día a día o súmate a nuestro equipo de profesionales.',
    cta: 'Ver opciones',
    tone: 'cyan',
  },
];

export type FaqItem = { q: string; a: string };

export const HOME_FAQ: FaqItem[] = [
  { q: '¿Necesito experiencia previa?', a: 'No. Cada curso indica desde dónde empieza y qué vas a lograr al terminarlo, para que elijas el que va contigo.' },
  {
    q: '¿Cuánto tiempo me toma terminar un curso?',
    a: 'Depende de cómo prefieras aprender. Algunos cursos tienen clases en vivo con fechas definidas, y otros los avanzas a tu propio ritmo, cuando y donde quieras. En cada curso verás su modalidad y duración antes de inscribirte.',
  },
  {
    q: '¿Quién revisa mis trabajos?',
    a: 'Profesionales con experiencia en distintas áreas. Su trabajo es asegurarse de que lo que aprendes no solo sea correcto, sino útil para tu vida y tu trabajo.',
  },
  { q: '¿Puedo estudiar desde el celular?', a: 'Sí. Lux funciona en tu celular, tableta o computadora, y retomas justo donde te quedaste.' },
  {
    q: '¿Cómo comparto mi certificado?',
    a: 'Cada certificado tiene una dirección pública que cualquiera puede abrir para verificarlo. Puedes enviarla a tu empresa o agregarla a tu perfil de LinkedIn.',
  },
];

export const COURSES_FAQ: FaqItem[] = [
  { q: '¿Cómo me inscribo a un curso?', a: 'Crea tu cuenta, elige el curso que te interesa y empieza. Todo tu avance queda guardado en tu perfil.' },
  HOME_FAQ[1]!,
  HOME_FAQ[2]!,
  { q: '¿Qué pasa si me atraso?', a: 'Tu plan de estudio se ajusta para que retomes sin presión, y tu evaluador puede orientarte si necesitas apoyo.' },
  HOME_FAQ[4]!,
];

export type MiniApp = { icon: 'chart' | 'plan' | 'check'; title: string; text: string };

// Details still to be defined with the product owner; shown as "coming soon".
export const MINI_APPS: MiniApp[] = [
  { icon: 'chart', title: 'Control académico', text: 'Lleva calificaciones, asistencia y avance de cada estudiante en un solo lugar.' },
  { icon: 'plan', title: 'Planeamientos por nivel', text: 'Crea planeaciones para distintos niveles en minutos, listas para usar en clase.' },
  { icon: 'check', title: 'Seguimiento de entregas', text: 'Revisa tareas y reflexiones con contexto y devuelve comentarios claros.' },
];

export const TEACH_WITH_US = {
  title: 'Enseña con Lux',
  text: 'Buscamos profesionales con experiencia real que disfruten acompañar a otros a aprender. Tú pones tu conocimiento; nosotros, la plataforma y los estudiantes.',
  points: ['Trabaja de forma remota y con horarios flexibles', 'Revisa entregas y acompaña a estudiantes de tu área', 'Forma parte de una comunidad de profesionales'],
  applyHref: '/profesores/postular',
};

// First draft of the teacher onboarding path; keep in sync with the confirmation email
// (services/api/src/platform/emails.ts) until the onboarding is designed in detail.
export const ONBOARDING_STEPS = [
  { title: 'Revisamos tu perfil', text: 'Leemos tu postulación con calma. Te escribiremos en un máximo de 5 días hábiles.' },
  { title: 'Conversamos contigo', text: 'Si tu perfil encaja, agendamos una entrevista corta para conocerte y hablar de tu curso.' },
  { title: 'Onboarding', text: 'Te mostramos la plataforma y te acompañamos a diseñar tu primer curso paso a paso.' },
  { title: 'Publicas tu curso', text: 'Cuando tu curso esté listo, lo publicamos y empiezas a acompañar a tus estudiantes.' },
];

// TODO: replace with an interest form stored in Lux HQ once mini apps pricing is defined.
export const MINI_APPS_NOTIFY_HREF = 'mailto:sales@luxlearning.academy?subject=Quiero%20conocer%20las%20mini%20apps';
