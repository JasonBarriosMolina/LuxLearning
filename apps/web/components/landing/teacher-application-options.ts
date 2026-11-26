// Options must match services/api/src/platform/teacher-applications.ts (TEACHER_OPTIONS).
export const TEACHER_OPTIONS = {
  areas: ['Educación y docencia', 'Liderazgo y gestión', 'Negocios y ventas', 'Tecnología', 'Salud y bienestar', 'Idiomas', 'Arte y diseño', 'Ciencias', 'Desarrollo personal', 'Otra'],
  yearsProfessional: ['Menos de 2', '2 a 5', '6 a 10', 'Más de 10'],
  yearsTeaching: ['Aún no he enseñado', '1 a 2', '3 a 5', 'Más de 5'],
  education: ['Técnico', 'Licenciatura', 'Maestría', 'Doctorado', 'Otra'],
  liveInterest: ['Sí', 'Tal vez más adelante', 'No'],
  audiences: ['Escolar', 'Universitario', 'Empresas', 'Adultos y público general'],
  hasOnlineCourses: ['Sí', 'No'],
  courseModules: ['3 o 4', '5 o 6', '7 u 8', 'Más de 8', 'Aún no lo sé'],
  roles: ['Crear cursos', 'Revisar entregas y acompañar estudiantes'],
  hoursPerWeek: ['Menos de 5', '5 a 10', '11 a 20', 'Más de 20'],
  materials: ['Presentaciones', 'Videos', 'Guías o ejercicios', 'Aún no tengo material'],
  videoComfort: ['Muy cómodo', 'Cómodo', 'Me pone un poco nervioso', 'Prefiero no grabar'],
  equipment: ['Cámara', 'Micrófono', 'Aún no tengo equipo'],
} as const;

/** Choosing one of these clears the other options in the same question, and vice versa. */
export const EXCLUSIVE_OPTIONS = ['Aún no tengo material', 'Aún no tengo equipo'];
