'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BookOpen,
  TrendingUp,
  ClipboardList,
  Users,
  UserCog,
  UserCircle,
  LogOut,
  X,
  Download,
  Settings2,
  BarChart2,
  CalendarCheck,
  CalendarDays,
  UserPlus,
  MessageSquare,
  Mail,
  FolderOpen,
  FolderKanban,
  FileCheck,
} from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useInstallPrompt } from '@/lib/hooks/useInstallPrompt';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

type NavKey =
  | 'dashboard' | 'myCourses' | 'myProgress' | 'myTasks' | 'calendar'
  | 'evaluations' | 'students' | 'tasks' | 'contentMgmt' | 'reports'
  | 'assignCourses' | 'users' | 'emailTemplates' | 'myActivity' | 'myProfile'
  | 'communications' | 'myResources' | 'adminCerts' | 'groups';

type AllRole = 'STUDENT' | 'EVALUATOR' | 'ADMIN' | 'SUPER_ADMIN';

interface NavItem {
  href: string;
  labelKey: NavKey;
  icon: React.ReactNode;
  roles: AllRole[];
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', labelKey: 'dashboard', icon: <LayoutDashboard className="w-5 h-5" />, roles: ['STUDENT'] },
  { href: '/evaluator/dashboard', labelKey: 'dashboard', icon: <LayoutDashboard className="w-5 h-5" />, roles: ['EVALUATOR', 'ADMIN', 'SUPER_ADMIN'] },
  { href: '/courses', labelKey: 'myCourses', icon: <BookOpen className="w-5 h-5" />, roles: ['STUDENT'] },
  { href: '/progress', labelKey: 'myProgress', icon: <TrendingUp className="w-5 h-5" />, roles: ['STUDENT'] },
  { href: '/tasks', labelKey: 'myTasks', icon: <CalendarCheck className="w-5 h-5" />, roles: ['STUDENT'] },
  { href: '/calendar', labelKey: 'calendar', icon: <CalendarDays className="w-5 h-5" />, roles: ['STUDENT'] },
  { href: '/evaluator/calendar', labelKey: 'calendar', icon: <CalendarDays className="w-5 h-5" />, roles: ['EVALUATOR', 'ADMIN', 'SUPER_ADMIN'] },
  { href: '/evaluator/reflections', labelKey: 'evaluations', icon: <ClipboardList className="w-5 h-5" />, roles: ['EVALUATOR', 'ADMIN', 'SUPER_ADMIN'] },
  { href: '/evaluator/submissions', labelKey: 'submissions', icon: <FileCheck className="w-5 h-5" />, roles: ['EVALUATOR', 'ADMIN', 'SUPER_ADMIN'] },
  { href: '/evaluator/students', labelKey: 'students', icon: <Users className="w-5 h-5" />, roles: ['EVALUATOR', 'ADMIN', 'SUPER_ADMIN'] },
  { href: '/evaluator/tasks', labelKey: 'tasks', icon: <CalendarCheck className="w-5 h-5" />, roles: ['EVALUATOR', 'ADMIN', 'SUPER_ADMIN'] },
  { href: '/evaluator/my-courses', labelKey: 'myCourses', icon: <BookOpen className="w-5 h-5" />, roles: ['EVALUATOR', 'ADMIN', 'SUPER_ADMIN'] },
  { href: '/evaluator/my-resources', labelKey: 'myResources', icon: <FolderOpen className="w-5 h-5" />, roles: ['EVALUATOR', 'ADMIN', 'SUPER_ADMIN'] },
  { href: '/admin/courses', labelKey: 'contentMgmt', icon: <Settings2 className="w-5 h-5" />, roles: ['ADMIN', 'SUPER_ADMIN'] },
  { href: '/admin/reports', labelKey: 'reports', icon: <BarChart2 className="w-5 h-5" />, roles: ['EVALUATOR', 'ADMIN', 'SUPER_ADMIN'] },
  { href: '/admin/assign-courses', labelKey: 'assignCourses', icon: <UserPlus className="w-5 h-5" />, roles: ['EVALUATOR', 'ADMIN', 'SUPER_ADMIN'] },
  { href: '/admin/users', labelKey: 'users', icon: <UserCog className="w-5 h-5" />, roles: ['ADMIN', 'SUPER_ADMIN'] },
  { href: '/admin/email-templates', labelKey: 'emailTemplates', icon: <Mail className="w-5 h-5" />, roles: ['ADMIN', 'SUPER_ADMIN'] },
  { href: '/admin/certificates', labelKey: 'adminCerts', icon: <Download className="w-5 h-5" />, roles: ['ADMIN', 'SUPER_ADMIN'] },
  { href: '/admin/groups', labelKey: 'groups', icon: <FolderKanban className="w-5 h-5" />, roles: ['ADMIN', 'SUPER_ADMIN'] },
  { href: '/evaluator/groups', labelKey: 'groups', icon: <FolderKanban className="w-5 h-5" />, roles: ['EVALUATOR'] },
  { href: '/activity', labelKey: 'myActivity', icon: <TrendingUp className="w-5 h-5" />, roles: ['STUDENT'] },
  { href: '/profile', labelKey: 'myProfile', icon: <UserCircle className="w-5 h-5" />, roles: ['STUDENT'] },
  { href: '/communications', labelKey: 'communications', icon: <MessageSquare className="w-5 h-5" />, roles: ['STUDENT'] },
  { href: '/evaluator/communications', labelKey: 'communications', icon: <MessageSquare className="w-5 h-5" />, roles: ['EVALUATOR', 'ADMIN', 'SUPER_ADMIN'] },
  { href: '/evaluator/profile', labelKey: 'myProfile', icon: <UserCircle className="w-5 h-5" />, roles: ['EVALUATOR'] },
  { href: '/admin/profile', labelKey: 'myProfile', icon: <UserCircle className="w-5 h-5" />, roles: ['ADMIN', 'SUPER_ADMIN'] },
];

function UnreadBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const poll = () => {
      api.messages.chats.list()
        .then((res: any) => {
          const items: any[] = Array.isArray(res) ? res : (res?.data ?? []);
          const total = items.reduce((s: number, c: any) => s + (c.unread ?? 0), 0);
          setCount(total);
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 15000);
    return () => clearInterval(id);
  }, []);

  if (count === 0) return null;
  return (
    <span className="ml-auto bg-red-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0">
      {count > 9 ? '9+' : count}
    </span>
  );
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const { role, email, name, signOut } = useAuth();
  const { canInstall, install } = useInstallPrompt();
  const { t } = useLanguage();

  const visibleItems = NAV_ITEMS.filter((item) =>
    role ? (item.roles as string[]).includes(role) : false
  );

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center justify-center px-6 py-5 border-b border-gray-200 dark:border-white/10 relative">
        {/* Light mode: full color logo */}
        <Image
          src="/lux-logo-fullcolor.svg"
          alt="Lux Learning"
          width={160}
          height={47}
          style={{ objectFit: 'contain' }}
          priority
          className="block dark:hidden"
        />
        {/* Dark mode: white logo */}
        <Image
          src="/lux-logo-white.svg"
          alt="Lux Learning"
          width={160}
          height={47}
          style={{ objectFit: 'contain' }}
          priority
          className="hidden dark:block"
        />
        {onMobileClose && (
          <button
            onClick={onMobileClose}
            className="lg:hidden absolute right-4 top-1/2 -translate-y-1/2 p-1 text-gray-500 dark:text-white/60 hover:text-gray-900 dark:hover:text-white"
            aria-label="Cerrar menú"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* User info */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-cta-gradient flex items-center justify-center text-white font-heading font-bold text-sm">
            {(name ?? email)?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="min-w-0">
            <p className="text-gray-900 dark:text-white text-sm font-medium truncate">{name ?? email ?? 'Usuario'}</p>
            <p className="text-gray-500 dark:text-white/50 text-xs">
              {role === 'SUPER_ADMIN' || role === 'ADMIN' ? t.roles.superAdmin : role === 'EVALUATOR' ? t.roles.evaluator : t.roles.student}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
        {visibleItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          const isCommunications = item.href.includes('communications');
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onMobileClose}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-all duration-200',
                isActive
                  ? 'bg-blue-50 dark:bg-white/15 text-[#17527E] dark:text-white border-l-[3px] border-cta-from pl-[13px]'
                  : 'text-gray-500 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'
              )}
            >
              {item.icon}
              <span className="flex-1">{t.nav[item.labelKey]}</span>
              {isCommunications && <UnreadBadge />}
            </Link>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="px-3 py-4 border-t border-gray-200 dark:border-white/10 space-y-1">
        {canInstall && (
          <button
            onClick={install}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm text-gray-500 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white transition-all duration-200"
          >
            <Download className="w-5 h-5" />
            {t.nav.installApp}
          </button>
        )}
        <button
          onClick={signOut}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm text-gray-500 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white transition-all duration-200"
        >
          <LogOut className="w-5 h-5" />
          {t.nav.signOut}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 bg-[#EFEFEF] dark:bg-[#1A1A2E] flex-col h-screen sticky top-0 shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onMobileClose}
          />
          <aside className="relative z-10 w-72 bg-[#EFEFEF] dark:bg-[#1A1A2E] flex flex-col h-full animate-slide-up">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
