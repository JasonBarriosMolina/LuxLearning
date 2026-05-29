import { getIdToken } from './auth';
import type {
  GetCoursesResponse,
  GetCourseResponse,
  MarkLessonCompleteRequest,
  SubmitQuizRequest,
  SubmitReflectionRequest,
  ReviewReflectionRequest,
  GetProgressResponse,
  GetNotificationsResponse,
} from '@lux/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getIdToken();

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error ?? 'API error'), {
      statusCode: res.status,
      body: err,
    });
  }

  return res.json() as Promise<T>;
}

// ─── Courses ──────────────────────────────────────────────────────────────────

export const api = {
  courses: {
    list: () => request<GetCoursesResponse>('/courses'),
    get: (courseId: string) => request<GetCourseResponse>(`/courses/${courseId}`),
  },

  lessons: {
    highlights: (lessonId: string) => request<any>(`/lessons/highlights?lessonId=${lessonId}`),
    saveHighlights: (lessonId: string, items: any[]) =>
      request<any>('/lessons/highlights', { method: 'POST', body: JSON.stringify({ lessonId, items }) }),
    favorites: () => request<any>('/lessons/favorites'),
    toggleFavorite: (body: { type: string; id: string; title: string; courseId?: string; moduleId?: string }) =>
      request<any>('/lessons/favorites/toggle', { method: 'POST', body: JSON.stringify(body) }),
    transcript: (lessonId: string, youtubeId: string) =>
      request<any>(`/lessons/transcript?lessonId=${lessonId}&youtubeId=${youtubeId}`),
    chat: (body: { lessonId: string; lessonTitle?: string; lessonContent?: string; moduleTitle?: string; history: { role: string; content: string }[]; message: string }) =>
      request<any>('/lessons/chat', { method: 'POST', body: JSON.stringify(body) }),
    complete: (body: MarkLessonCompleteRequest) =>
      request('/lessons/complete', { method: 'POST', body: JSON.stringify(body) }),
    progress: (courseId: string) =>
      request(`/lessons/progress?courseId=${courseId}`),
  },

  quiz: {
    submit: (moduleId: string, body: SubmitQuizRequest) =>
      request(`/quiz/${moduleId}/submit`, { method: 'POST', body: JSON.stringify(body) }),
    attempts: (moduleId: string) =>
      request(`/quiz/${moduleId}/attempts`),
  },

  reflection: {
    submit: (body: SubmitReflectionRequest) =>
      request('/reflection', { method: 'POST', body: JSON.stringify(body) }),
    get: (moduleId: string) =>
      request(`/reflection/${moduleId}`),
    aiPreview: (text: string, moduleTitle?: string) =>
      request<any>('/reflection/ai-preview', { method: 'POST', body: JSON.stringify({ text, moduleTitle }) }),
  },

  evaluator: {
    myCourses: () => request<any>('/evaluator/my-courses'),
    reflections: () => request('/evaluator/reflections'),
    review: (body: ReviewReflectionRequest) =>
      request('/evaluator/reflections/review', { method: 'POST', body: JSON.stringify(body) }),
    students: () => request('/evaluator/students'),
    studentCertificates: (userId: string) => request<any>(`/evaluator/students/${userId}/certificates`),
    sendReminder: (body: { userId: string; studentEmail: string; studentName?: string; hoursInactive?: number; courseTitle?: string }) =>
      request<any>('/evaluator/reminder', { method: 'POST', body: JSON.stringify(body) }),
    aiFeedback: (text: string, moduleTitle?: string) =>
      request<any>('/evaluator/ai-feedback', { method: 'POST', body: JSON.stringify({ text, moduleTitle }) }),
    quizAudit: (userId: string, moduleId: string) =>
      request<any>(`/evaluator/quiz-audit?userId=${encodeURIComponent(userId)}&moduleId=${encodeURIComponent(moduleId)}`),
    setPriority: (userId: string, moduleId: string, priority: boolean) =>
      request<any>('/evaluator/reflections/priority', { method: 'POST', body: JSON.stringify({ userId, moduleId, priority }) }),
    reconsiderReflection: (userId: string, moduleId: string, reason: string) =>
      request<any>('/evaluator/reflections/reconsider', { method: 'POST', body: JSON.stringify({ userId, moduleId, reason }) }),
    aiCheck: (userId: string, moduleId: string) =>
      request<any>('/evaluator/ai-check', { method: 'POST', body: JSON.stringify({ userId, moduleId }) }),
    tasks: {
      list: () => request<any>('/evaluator/tasks'),
      create: (body: { title: string; description?: string; type?: string; dueDate: string; courseId?: string; moduleId?: string; courseTitle?: string; moduleTitle?: string; assignTo: 'individual' | 'course'; userId?: string; targetCourseId?: string }) =>
        request<any>('/evaluator/tasks', { method: 'POST', body: JSON.stringify(body) }),
      update: (taskId: string, body: { userId: string; title?: string; description?: string; dueDate?: string }) =>
        request<any>(`/evaluator/tasks/${taskId}`, { method: 'PUT', body: JSON.stringify(body) }),
      delete: (taskId: string, userId: string) =>
        request<any>(`/evaluator/tasks/${taskId}`, { method: 'DELETE', body: JSON.stringify({ userId }) }),
    },
    signature: {
      get: () => request<any>('/evaluator/signature'),
      save: (signature: string) => request<any>('/evaluator/signature', { method: 'PUT', body: JSON.stringify({ signature }) }),
    },
  },

  tasks: {
    list: () => request<any>('/tasks'),
    complete: (taskId: string) => request<any>(`/tasks/${taskId}/complete`, { method: 'POST' }),
    submit: (taskId: string) => request<any>(`/tasks/${taskId}/submit`, { method: 'POST' }),
    undo: (taskId: string) => request<any>(`/tasks/${taskId}/undo`, { method: 'POST' }),
    importIcs: (events: { summary: string; dtstart: string; description?: string }[]) =>
      request<any>('/student/tasks/import', { method: 'POST', body: JSON.stringify({ events }) }),
    calendarUrl: async () => {
      const { getIdToken } = await import('./auth');
      const token = await getIdToken();
      const base = process.env.NEXT_PUBLIC_API_URL ?? '';
      return `${base}/tasks/calendar.ics${token ? `?token=${token}` : ''}`;
    },
  },

  notifications: {
    list: () => request<GetNotificationsResponse>('/notifications'),
    markRead: (notifId: string) =>
      request('/notifications/read', { method: 'POST', body: JSON.stringify({ notifId }) }),
  },

  certificates: {
    get: (certId: string) => fetch(`${API_URL}/certificates/${certId}`).then((r) => r.json()),
    mine: () => request<any>('/my-certificates'),
    generate: (courseId: string) =>
      request<any>('/my-certificates/generate', { method: 'POST', body: JSON.stringify({ courseId }) }),
    pdfUrl: (certId: string) => `${API_URL}/certificates/${certId}/pdf`,
    template: {
      get: () => request<any>('/admin/certificates/template'),
      save: (body: { logoUrl?: string; watermarkText?: string; primaryColor?: string; secondaryColor?: string; fields?: any; footerText?: string }) =>
        request<any>('/admin/certificates/template', { method: 'PUT', body: JSON.stringify(body) }),
    },
  },

  heartbeat: () => request('/student/heartbeat', { method: 'POST' }).catch(() => {}),

  student: {
    onboarding: {
      check: () => request<any>('/student/onboarding'),
      complete: () => request<any>('/student/onboarding', { method: 'POST' }),
    },
    activity: {
      start: (sessionId: string) => request<any>('/student/activity/start', { method: 'POST', body: JSON.stringify({ sessionId }) }).catch(() => {}),
      update: (sessionId: string, durationSeconds: number) => request<any>('/student/activity/update', { method: 'PUT', body: JSON.stringify({ sessionId, durationSeconds }) }).catch(() => {}),
      end: (sessionId: string) => request<any>('/student/activity/end', { method: 'POST', body: JSON.stringify({ sessionId }) }).catch(() => {}),
      get: (days?: number) => request<any>(`/student/activity${days ? `?days=${days}` : ''}`),
    },
    tasks: {
      submit: (taskId: string, submissionUrl: string) => request<any>(`/student/tasks/${taskId}/submit`, { method: 'PUT', body: JSON.stringify({ submissionUrl }) }),
    },
  },

  push: {
    vapidKey: () => fetch(`${API_URL}/push/vapid-key`).then((r) => r.json()),
    subscribe: (body: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
      request<any>('/push/subscribe', { method: 'POST', body: JSON.stringify(body) }),
    unsubscribe: (body: { endpoint: string }) =>
      request<any>('/push/subscribe', { method: 'DELETE', body: JSON.stringify(body) }),
  },

  admin: {
    // Courses
    courses: {
      list: () => request<any>('/admin/courses'),
      get: (courseId: string) => request<any>(`/admin/courses/${courseId}`),
      create: (body: any) => request<any>('/admin/courses', { method: 'POST', body: JSON.stringify(body) }),
      update: (courseId: string, body: any) => request<any>(`/admin/courses/${courseId}`, { method: 'PUT', body: JSON.stringify(body) }),
      delete: (courseId: string) => request<any>(`/admin/courses/${courseId}`, { method: 'DELETE' }),
      aiGenerate: (body: { method: 'topic' | 'url'; input: string }) =>
        request<any>('/admin/courses/ai-generate', { method: 'POST', body: JSON.stringify(body) }),
      aiGenerateModule: (body: { topic: string; courseTitle?: string }) =>
        request<any>('/admin/courses/ai-generate-module', { method: 'POST', body: JSON.stringify(body) }),
      aiJob: (jobId: string) =>
        request<any>(`/admin/courses/ai-job?jobId=${encodeURIComponent(jobId)}`),
      aiPublish: (body: any) =>
        request<any>('/admin/courses/ai-publish', { method: 'POST', body: JSON.stringify(body) }),
      regenerate: (courseId: string) =>
        request<any>(`/admin/courses/${courseId}/regenerate`, { method: 'POST' }),
      assignEvaluator: (courseId: string, body: { evaluatorId: string; evaluatorName: string }) =>
        request<any>(`/admin/courses/${courseId}/evaluator`, { method: 'PUT', body: JSON.stringify(body) }),
      validateVideos: (courseId: string) => request<any>(`/admin/courses/${courseId}/validate-videos`),
      publish: (courseId: string) =>
        request<any>(`/admin/courses/${courseId}/publish`, { method: 'PUT' }),
      archive: (courseId: string) =>
        request<any>(`/admin/courses/${courseId}/archive`, { method: 'PUT' }),
      restore: (courseId: string) =>
        request<any>(`/admin/courses/${courseId}/restore`, { method: 'PUT' }),
      listByStatus: (status: 'active' | 'draft' | 'archived') =>
        request<any>(`/admin/courses?status=${status}`),
    },
    // Modules
    modules: {
      create: (courseId: string, body: any) => request<any>(`/admin/courses/${courseId}/modules`, { method: 'POST', body: JSON.stringify(body) }),
      update: (moduleId: string, body: any) => request<any>(`/admin/modules/${moduleId}`, { method: 'PUT', body: JSON.stringify(body) }),
      delete: (moduleId: string) => request<any>(`/admin/modules/${moduleId}`, { method: 'DELETE' }),
      regenerate: (moduleId: string) =>
        request<any>(`/admin/modules/${moduleId}/regenerate`, { method: 'POST' }),
      aiGenerate: (courseId: string, body: { topic: string; description?: string }) =>
        request<any>(`/admin/courses/${courseId}/modules/ai-generate`, { method: 'POST', body: JSON.stringify(body) }),
    },
    // Lessons
    lessons: {
      create: (moduleId: string, body: any) => request<any>(`/admin/modules/${moduleId}/lessons`, { method: 'POST', body: JSON.stringify(body) }),
      update: (lessonId: string, body: any) => request<any>(`/admin/lessons/${lessonId}`, { method: 'PUT', body: JSON.stringify(body) }),
      delete: (lessonId: string) => request<any>(`/admin/lessons/${lessonId}`, { method: 'DELETE' }),
      regenerate: (lessonId: string) =>
        request<any>(`/admin/lessons/${lessonId}/regenerate`, { method: 'POST' }),
      regenerateFormat: (lessonId: string, body: { type: 'text' | 'image' | 'infographic'; level?: 'basic' | 'intermediate' | 'advanced'; style?: string; preview?: boolean; combineMode?: boolean; previewData?: any }) =>
        request<any>(`/admin/lessons/${lessonId}/regenerate`, { method: 'POST', body: JSON.stringify(body) }),
      generateAudio: (lessonId: string, voiceId = 'Mia') =>
        request<any>(`/admin/lessons/${lessonId}/audio`, { method: 'POST', body: JSON.stringify({ voiceId }) }),
      aiGenerate: (moduleId: string, body: { topic: string }) =>
        request<any>(`/admin/modules/${moduleId}/lessons/ai-generate`, { method: 'POST', body: JSON.stringify(body) }),
    },
    // Questions
    questions: {
      create: (moduleId: string, body: any) => request<any>(`/admin/modules/${moduleId}/questions`, { method: 'POST', body: JSON.stringify(body) }),
      update: (questionId: string, body: any) => request<any>(`/admin/questions/${questionId}`, { method: 'PUT', body: JSON.stringify(body) }),
      delete: (questionId: string) => request<any>(`/admin/questions/${questionId}`, { method: 'DELETE' }),
    },
    // Reports (legacy)
    reports: () => request<any>('/admin/reports'),
    // Reports v2
    reportsV2: (params?: { mode?: string; studentId?: string; courseId?: string }) => {
      const qs = new URLSearchParams();
      if (params?.mode) qs.set('mode', params.mode);
      if (params?.studentId) qs.set('studentId', params.studentId);
      if (params?.courseId) qs.set('courseId', params.courseId);
      const q = qs.toString();
      return request<any>(`/reports${q ? '?' + q : ''}`);
    },
    sendReportEmail: (body: { to: string; subject: string; htmlBody: string }) =>
      request<any>('/reports/email', { method: 'POST', body: JSON.stringify(body) }),
    getRecommendations: (moduleId: string) => request<any>(`/reports/recommendations/${moduleId}`),
    updateRecommendations: (moduleId: string, items: any[]) =>
      request<any>(`/reports/recommendations/${moduleId}`, { method: 'PUT', body: JSON.stringify({ items }) }),
    // Users
    users: {
      list: () => request<any>('/admin/users'),
      invite: (body: { email: string; role: string; name?: string; courseIds?: string[] }) =>
        request<any>('/admin/users', { method: 'POST', body: JSON.stringify(body) }),
      changeRole: (username: string, role: string) =>
        request<any>(`/admin/users/${encodeURIComponent(username)}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
      setStatus: (username: string, enabled: boolean) =>
        request<any>(`/admin/users/${encodeURIComponent(username)}/status`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
      delete: (username: string) =>
        request<any>(`/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' }),
      getEnrollments: (username: string) =>
        request<any>(`/admin/users/${encodeURIComponent(username)}/enrollments`),
      addEnrollment: (username: string, courseId: string) =>
        request<any>(`/admin/users/${encodeURIComponent(username)}/enrollments`, { method: 'POST', body: JSON.stringify({ courseId }) }),
      removeEnrollment: (username: string, courseId: string) =>
        request<any>(`/admin/users/${encodeURIComponent(username)}/enrollments`, { method: 'DELETE', body: JSON.stringify({ courseId }) }),
    },
    emailTemplates: {
      list: () => request<any>('/admin/email-templates'),
      update: (type: string, subject: string, htmlBody: string) =>
        request<any>(`/admin/email-templates/${type}`, { method: 'PUT', body: JSON.stringify({ subject, htmlBody }) }),
    },
  },
  profile: {
    get: () => request<any>('/user/profile'),
    update: (body: { name?: string; phone?: string; bio?: string; picture?: string }) =>
      request<any>('/user/profile', { method: 'PUT', body: JSON.stringify(body) }),
  },
  messages: {
    contacts: () => request<any>('/messages/contacts'),
    chats: {
      list: () => request<any>('/messages/chats'),
      create: (body: { type: string; targetUserId?: string; courseId?: string; name?: string; participantIds?: string[] }) =>
        request<any>('/messages/chats', { method: 'POST', body: JSON.stringify(body) }),
    },
    get: (chatId: string) => request<any>(`/messages/${chatId}`),
    send: (chatId: string, text: string) =>
      request<any>(`/messages/${chatId}`, { method: 'POST', body: JSON.stringify({ text }) }),
    markRead: (chatId: string) =>
      request<any>(`/messages/${chatId}/read`, { method: 'PUT' }),
    react: (chatId: string, ts: string, emoji: string) =>
      request<any>(`/messages/${chatId}/react`, { method: 'POST', body: JSON.stringify({ ts, emoji }) }),
  },
};
