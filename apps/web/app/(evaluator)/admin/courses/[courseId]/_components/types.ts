// ─── types.ts ─────────────────────────────────────────────────────────────────
// Shared form interfaces and factory helpers for the admin course-detail page.
// ─────────────────────────────────────────────────────────────────────────────

export interface ModuleForm {
  title: string; description: string; duration: string; passingScore: number; order: number;
}
export interface LessonForm {
  title: string; duration: string; youtubeId: string; imageUrl: string;
  content: string; points: string[]; tip: string; order: number;
}
export interface QuestionForm {
  text: string; options: string[]; correctIndex: number; order: number;
}

export const EMPTY_MODULE: ModuleForm = { title: '', description: '', duration: '', passingScore: 70, order: 1 };
export const newLessonForm = (order = 1): LessonForm => ({ title: '', duration: '', youtubeId: '', imageUrl: '', content: '', points: [''], tip: '', order });
export const newQuestionForm = (order = 1): QuestionForm => ({ text: '', options: ['', '', '', ''], correctIndex: 0, order });
