// ─── sidebar-nav-config.tsx ───────────────────────────────────────────────────
// Nav items + group definitions for Sidebar accordion.
// Flat list for STUDENT; grouped accordion for EVALUATOR and ADMIN/SUPER_ADMIN.
// ─────────────────────────────────────────────────────────────────────────────

import {
  LayoutDashboard, BookOpen, TrendingUp, ClipboardList, Users,
  UserCog, UserCircle, Settings2, BarChart2, CalendarCheck, CalendarDays,
  UserPlus, MessageSquare, Mail, FolderOpen, FolderKanban,
  FileCheck, Mic, BookCheck, ListTodo, Download,
} from 'lucide-react';
import React from 'react';

export type NavKey =
  | 'dashboard' | 'myCourses' | 'myProgress' | 'myTasks' | 'calendar'
  | 'evaluations' | 'students' | 'tasks' | 'contentMgmt' | 'reports'
  | 'assignCourses' | 'users' | 'emailTemplates' | 'myActivity' | 'myProfile'
  | 'communications' | 'myResources' | 'adminCerts' | 'groups' | 'submissions'
  | 'interviews' | 'attendance' | 'studyPlan';

export interface NavItem {
  href: string;
  labelKey: NavKey;
  icon: React.ReactNode;
}

export interface NavGroup {
  key: string;
  labelEs: string;
  labelEn: string;
  icon?: React.ReactNode;
  /** Render items directly without accordion toggle */
  flat?: boolean;
  items: NavItem[];
}

// ─── STUDENT (flat list — ~7 items, no grouping needed) ───────────────────────
export const STUDENT_NAV: NavItem[] = [
  { href: '/dashboard',       labelKey: 'dashboard',      icon: <LayoutDashboard className="w-5 h-5" /> },
  { href: '/courses',         labelKey: 'myCourses',      icon: <BookOpen        className="w-5 h-5" /> },
  { href: '/plan',            labelKey: 'studyPlan',      icon: <ListTodo        className="w-5 h-5" /> },
  { href: '/progress',        labelKey: 'myProgress',     icon: <TrendingUp      className="w-5 h-5" /> },
  { href: '/tasks',           labelKey: 'myTasks',        icon: <CalendarCheck   className="w-5 h-5" /> },
  { href: '/calendar',        labelKey: 'calendar',       icon: <CalendarDays    className="w-5 h-5" /> },
  { href: '/communications',  labelKey: 'communications', icon: <MessageSquare   className="w-5 h-5" /> },
  { href: '/activity',        labelKey: 'myActivity',     icon: <TrendingUp      className="w-5 h-5" /> },
  { href: '/profile',         labelKey: 'myProfile',      icon: <UserCircle      className="w-5 h-5" /> },
];

// ─── EVALUATOR grouped (16 items → 4 accordion + 2 flat) ─────────────────────
export const EVALUATOR_NAV_GROUPS: NavGroup[] = [
  {
    key: 'overview',
    labelEs: 'Vista General',
    labelEn: 'Overview',
    flat: true,
    items: [
      { href: '/evaluator/dashboard', labelKey: 'dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
      { href: '/evaluator/calendar',  labelKey: 'calendar',  icon: <CalendarDays    className="w-5 h-5" /> },
    ],
  },
  {
    key: 'students',
    labelEs: 'Mis Estudiantes',
    labelEn: 'My Students',
    icon: <Users className="w-5 h-5" />,
    items: [
      { href: '/evaluator/students',    labelKey: 'students',  icon: <Users         className="w-5 h-5" /> },
      { href: '/evaluator/groups',      labelKey: 'groups',    icon: <FolderKanban  className="w-5 h-5" /> },
      { href: '/evaluator/study-plans', labelKey: 'studyPlan', icon: <ListTodo      className="w-5 h-5" /> },
    ],
  },
  {
    key: 'academic',
    labelEs: 'Centro Académico',
    labelEn: 'Academic Center',
    icon: <BookOpen className="w-5 h-5" />,
    items: [
      { href: '/evaluator/my-courses',   labelKey: 'myCourses',    icon: <BookOpen   className="w-5 h-5" /> },
      { href: '/evaluator/my-resources', labelKey: 'myResources',  icon: <FolderOpen className="w-5 h-5" /> },
      { href: '/admin/assign-courses',   labelKey: 'assignCourses', icon: <UserPlus  className="w-5 h-5" /> },
    ],
  },
  {
    key: 'evaluations',
    labelEs: 'Centro de Evaluaciones',
    labelEn: 'Evaluations Center',
    icon: <ClipboardList className="w-5 h-5" />,
    items: [
      { href: '/evaluator/reflections', labelKey: 'evaluations', icon: <ClipboardList className="w-5 h-5" /> },
      { href: '/evaluator/attendance',  labelKey: 'attendance',  icon: <BookCheck     className="w-5 h-5" /> },
      { href: '/evaluator/submissions', labelKey: 'submissions', icon: <FileCheck     className="w-5 h-5" /> },
      { href: '/admin/entrevistas',     labelKey: 'interviews',  icon: <Mic           className="w-5 h-5" /> },
      { href: '/evaluator/tasks',       labelKey: 'tasks',       icon: <CalendarCheck className="w-5 h-5" /> },
    ],
  },
  {
    key: 'comms',
    labelEs: 'Comunicaciones',
    labelEn: 'Communications',
    flat: true,
    items: [
      { href: '/evaluator/communications', labelKey: 'communications', icon: <MessageSquare className="w-5 h-5" /> },
    ],
  },
  {
    key: 'reports',
    labelEs: 'Reportes',
    labelEn: 'Reports',
    flat: true,
    items: [
      { href: '/admin/reports', labelKey: 'reports', icon: <BarChart2 className="w-5 h-5" /> },
    ],
  },
];

// ─── ADMIN / SUPER_ADMIN grouped (20 items → 2 flat + 4 accordion) ────────────
export const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    key: 'overview',
    labelEs: 'Vista General',
    labelEn: 'Overview',
    flat: true,
    items: [
      { href: '/evaluator/dashboard', labelKey: 'dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
      { href: '/evaluator/calendar',  labelKey: 'calendar',  icon: <CalendarDays    className="w-5 h-5" /> },
    ],
  },
  {
    key: 'users',
    labelEs: 'Gestión de Usuarios',
    labelEn: 'User Management',
    icon: <Users className="w-5 h-5" />,
    items: [
      { href: '/evaluator/students', labelKey: 'students', icon: <Users        className="w-5 h-5" /> },
      { href: '/admin/users',        labelKey: 'users',    icon: <UserCog      className="w-5 h-5" /> },
      { href: '/admin/groups',       labelKey: 'groups',   icon: <FolderKanban className="w-5 h-5" /> },
    ],
  },
  {
    key: 'academic',
    labelEs: 'Centro Académico',
    labelEn: 'Academic Center',
    icon: <BookOpen className="w-5 h-5" />,
    items: [
      { href: '/evaluator/my-courses',   labelKey: 'myCourses',    icon: <BookOpen   className="w-5 h-5" /> },
      { href: '/admin/courses',          labelKey: 'contentMgmt',  icon: <Settings2  className="w-5 h-5" /> },
      { href: '/evaluator/my-resources', labelKey: 'myResources',  icon: <FolderOpen className="w-5 h-5" /> },
      { href: '/admin/assign-courses',   labelKey: 'assignCourses', icon: <UserPlus  className="w-5 h-5" /> },
    ],
  },
  {
    key: 'evaluations',
    labelEs: 'Centro de Evaluaciones',
    labelEn: 'Evaluations Center',
    icon: <ClipboardList className="w-5 h-5" />,
    items: [
      { href: '/evaluator/reflections', labelKey: 'evaluations', icon: <ClipboardList className="w-5 h-5" /> },
      { href: '/admin/attendance',      labelKey: 'attendance',  icon: <BookCheck     className="w-5 h-5" /> },
      { href: '/evaluator/submissions', labelKey: 'submissions', icon: <FileCheck     className="w-5 h-5" /> },
      { href: '/admin/entrevistas',     labelKey: 'interviews',  icon: <Mic           className="w-5 h-5" /> },
      { href: '/evaluator/tasks',       labelKey: 'tasks',       icon: <CalendarCheck className="w-5 h-5" /> },
      { href: '/evaluator/study-plans', labelKey: 'studyPlan',  icon: <ListTodo      className="w-5 h-5" /> },
    ],
  },
  {
    key: 'comms',
    labelEs: 'Comunicaciones',
    labelEn: 'Communications',
    icon: <MessageSquare className="w-5 h-5" />,
    items: [
      { href: '/evaluator/communications', labelKey: 'communications', icon: <MessageSquare className="w-5 h-5" /> },
      { href: '/admin/email-templates',    labelKey: 'emailTemplates', icon: <Mail          className="w-5 h-5" /> },
    ],
  },
  {
    key: 'reports',
    labelEs: 'Resultados y Reportes',
    labelEn: 'Results & Reports',
    icon: <BarChart2 className="w-5 h-5" />,
    items: [
      { href: '/admin/reports',       labelKey: 'reports',    icon: <BarChart2 className="w-5 h-5" /> },
      { href: '/admin/certificates',  labelKey: 'adminCerts', icon: <Download  className="w-5 h-5" /> },
    ],
  },
];
