'use client';

import Link from 'next/link';
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
} from 'lucide-react';
import { PrismaLogo } from './PrismaLogo';
import { useAuth } from '@/lib/hooks/useAuth';
import { useInstallPrompt } from '@/lib/hooks/useInstallPrompt';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles: ('STUDENT' | 'EVALUATOR' | 'ADMIN')[];
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: <LayoutDashboard className="w-5 h-5" />,
    roles: ['STUDENT'],
  },
  {
    href: '/evaluator/dashboard',
    label: 'Dashboard',
    icon: <LayoutDashboard className="w-5 h-5" />,
    roles: ['EVALUATOR', 'ADMIN'],
  },
  {
    href: '/courses',
    label: 'Mis Cursos',
    icon: <BookOpen className="w-5 h-5" />,
    roles: ['STUDENT'],
  },
  {
    href: '/progress',
    label: 'Mi Progreso',
    icon: <TrendingUp className="w-5 h-5" />,
    roles: ['STUDENT'],
  },
  {
    href: '/tasks',
    label: 'Mis Tareas',
    icon: <CalendarCheck className="w-5 h-5" />,
    roles: ['STUDENT'],
  },
  {
    href: '/calendar',
    label: 'Calendario',
    icon: <CalendarDays className="w-5 h-5" />,
    roles: ['STUDENT'],
  },
  {
    href: '/evaluator/reflections',
    label: 'Evaluaciones',
    icon: <ClipboardList className="w-5 h-5" />,
    roles: ['EVALUATOR', 'ADMIN'],
  },
  {
    href: '/evaluator/students',
    label: 'Estudiantes',
    icon: <Users className="w-5 h-5" />,
    roles: ['EVALUATOR', 'ADMIN'],
  },
  {
    href: '/evaluator/tasks',
    label: 'Tareas',
    icon: <CalendarCheck className="w-5 h-5" />,
    roles: ['EVALUATOR', 'ADMIN'],
  },
  {
    href: '/evaluator/my-courses',
    label: 'Mis Cursos',
    icon: <BookOpen className="w-5 h-5" />,
    roles: ['EVALUATOR', 'ADMIN'],
  },
  {
    href: '/evaluator/my-resources',
    label: 'Mis Recursos',
    icon: <FolderOpen className="w-5 h-5" />,
    roles: ['EVALUATOR', 'ADMIN'],
  },
  {
    href: '/admin/courses',
    label: 'Gestión de Contenido',
    icon: <Settings2 className="w-5 h-5" />,
    roles: ['ADMIN'],
  },
  {
    href: '/admin/reports',
    label: 'Reportes',
    icon: <BarChart2 className="w-5 h-5" />,
    roles: ['EVALUATOR', 'ADMIN'],
  },
  {
    href: '/admin/assign-courses',
    label: 'Asignar Cursos',
    icon: <UserPlus className="w-5 h-5" />,
    roles: ['EVALUATOR', 'ADMIN'],
  },
  {
    href: '/admin/users',
    label: 'Usuarios',
    icon: <UserCog className="w-5 h-5" />,
    roles: ['ADMIN'],
  },
  {
    href: '/admin/email-templates',
    label: 'Templates de Email',
    icon: <Mail className="w-5 h-5" />,
    roles: ['ADMIN'],
  },
  {
    href: '/activity',
    label: 'Mi Actividad',
    icon: <TrendingUp className="w-5 h-5" />,
    roles: ['STUDENT'],
  },
  {
    href: '/profile',
    label: 'Mi Perfil',
    icon: <UserCircle className="w-5 h-5" />,
    roles: ['STUDENT'],
  },
  {
    href: '/communications',
    label: 'Comunicaciones',
    icon: <MessageSquare className="w-5 h-5" />,
    roles: ['STUDENT'],
  },
  {
    href: '/evaluator/communications',
    label: 'Comunicaciones',
    icon: <MessageSquare className="w-5 h-5" />,
    roles: ['EVALUATOR', 'ADMIN'],
  },
  {
    href: '/evaluator/profile',
    label: 'Mi Perfil',
    icon: <UserCircle className="w-5 h-5" />,
    roles: ['EVALUATOR', 'ADMIN'],
  },
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
  const { role, email, signOut } = useAuth();
  const { canInstall, install } = useInstallPrompt();

  const visibleItems = NAV_ITEMS.filter((item) =>
    role ? item.roles.includes(role as 'STUDENT' | 'EVALUATOR' | 'ADMIN') : false
  );

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
        <PrismaLogo size={28} />
        {onMobileClose && (
          <button
            onClick={onMobileClose}
            className="lg:hidden p-1 text-white/60 hover:text-white"
            aria-label="Cerrar menú"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* User info */}
      <div className="px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-cta-gradient flex items-center justify-center text-white font-heading font-bold text-sm">
            {email?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-medium truncate">{email ?? 'Usuario'}</p>
            <p className="text-white/50 text-xs">
              {role === 'ADMIN' ? 'Super Admin' : role === 'EVALUATOR' ? 'Evaluador' : 'Estudiante'}
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
                  ? 'bg-white/15 text-white border-l-[3px] border-cta-from pl-[13px]'
                  : 'text-white/60 hover:bg-white/10 hover:text-white'
              )}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {isCommunications && <UnreadBadge />}
            </Link>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="px-3 py-4 border-t border-white/10 space-y-1">
        {canInstall && (
          <button
            onClick={install}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm text-white/60 hover:bg-white/10 hover:text-white transition-all duration-200"
          >
            <Download className="w-5 h-5" />
            Instalar app
          </button>
        )}
        <button
          onClick={signOut}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm text-white/60 hover:bg-white/10 hover:text-white transition-all duration-200"
        >
          <LogOut className="w-5 h-5" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 bg-[#2C2C2C] dark:bg-[#0D0D1F] flex-col h-screen sticky top-0 shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onMobileClose}
          />
          <aside className="relative z-10 w-72 bg-[#2C2C2C] dark:bg-[#0D0D1F] flex flex-col h-full animate-slide-up">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
