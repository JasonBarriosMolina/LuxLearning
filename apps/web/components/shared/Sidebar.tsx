'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { LogOut, X, Download, ChevronDown, UserCircle } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useInstallPrompt } from '@/lib/hooks/useInstallPrompt';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';
import {
  STUDENT_NAV,
  EVALUATOR_NAV_GROUPS,
  ADMIN_NAV_GROUPS,
  type NavItem,
  type NavGroup,
} from './sidebar-nav-config';

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

// ─── Unread badge for communications ─────────────────────────────────────────
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

// ─── Single nav link ──────────────────────────────────────────────────────────
function NavLink({ item, t, onClose, size = 'normal' }: {
  item: NavItem;
  t: any;
  onClose?: () => void;
  size?: 'normal' | 'small';
}) {
  const pathname = usePathname();
  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
  const isCommunications = item.href.includes('communications');

  return (
    <Link
      href={item.href}
      onClick={onClose}
      className={cn(
        'flex items-center gap-3 rounded-xl font-medium text-sm transition-all duration-200',
        size === 'small' ? 'px-3 py-2' : 'px-4 py-3',
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
}

// ─── Accordion group ──────────────────────────────────────────────────────────
function NavGroupSection({ group, t, lang, onClose, isOpen, onToggle }: {
  group: NavGroup;
  t: any;
  lang: string;
  onClose?: () => void;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const label = lang === 'en' ? group.labelEn : group.labelEs;
  const hasActive = group.items.some(
    item => pathname === item.href || pathname.startsWith(item.href + '/')
  );

  // flat = always-visible items (no toggle), used for Vista General, single-item sections
  if (group.flat) {
    return (
      <div className="space-y-0.5">
        {group.items.map(item => (
          <NavLink key={item.href} item={item} t={t} onClose={onClose} />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Group trigger */}
      <button
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium text-sm transition-all duration-200',
          hasActive
            ? 'text-[#17527E] dark:text-white bg-blue-50/60 dark:bg-white/8'
            : 'text-gray-600 dark:text-white/70 hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'
        )}
      >
        {group.icon && <span className="shrink-0 opacity-80">{group.icon}</span>}
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown
          className={cn(
            'w-4 h-4 shrink-0 transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {/* Collapsible children */}
      {isOpen && (
        <div className="mt-0.5 ml-3 pl-3 border-l border-gray-300 dark:border-white/10 space-y-0.5">
          {group.items.map(item => (
            <NavLink key={item.href} item={item} t={t} onClose={onClose} size="small" />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const { role, email, name, signOut } = useAuth();
  const { canInstall, install } = useInstallPrompt();
  const { t, lang } = useLanguage();
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const isEvaluator = role === 'EVALUATOR';
  const isGroupedRole = isAdmin || isEvaluator;

  const groups = isAdmin ? ADMIN_NAV_GROUPS : isEvaluator ? EVALUATOR_NAV_GROUPS : null;

  const profileHref = isAdmin
    ? '/admin/profile'
    : isEvaluator
    ? '/evaluator/profile'
    : '/profile';

  // Auto-open the group that contains the active path.
  // Include `role` so a role change (edge case) re-evaluates with the correct group set.
  useEffect(() => {
    if (!groups) return;
    const active = groups.find(
      g => !g.flat && g.items.some(
        item => pathname === item.href || pathname.startsWith(item.href + '/')
      )
    );
    if (active) setOpenGroup(active.key);
  }, [pathname, role]);

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center justify-center px-6 py-5 border-b border-gray-200 dark:border-white/10 relative">
        <Image
          src="/lux-logo-fullcolor.svg"
          alt="Lux Learning"
          width={160}
          height={47}
          style={{ objectFit: 'contain' }}
          priority
          className="block dark:hidden"
        />
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
            <p className="text-gray-900 dark:text-white text-sm font-medium truncate">
              {name ?? email ?? 'Usuario'}
            </p>
            <p className="text-gray-500 dark:text-white/50 text-xs">
              {isAdmin
                ? t.roles.superAdmin
                : isEvaluator
                ? t.roles.evaluator
                : t.roles.student}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
        {isGroupedRole && groups ? (
          groups.map(group => (
            <NavGroupSection
              key={group.key}
              group={group}
              t={t}
              lang={lang}
              onClose={onMobileClose}
              isOpen={openGroup === group.key}
              onToggle={() =>
                setOpenGroup(prev => (prev === group.key ? null : group.key))
              }
            />
          ))
        ) : (
          STUDENT_NAV.map(item => (
            <NavLink key={item.href} item={item} t={t} onClose={onMobileClose} />
          ))
        )}
      </nav>

      {/* Bottom actions */}
      <div className="px-3 py-4 border-t border-gray-200 dark:border-white/10 space-y-1">
        {/* Profile link for non-students (moved here to de-clutter nav) */}
        {isGroupedRole && (
          <Link
            href={profileHref}
            onClick={onMobileClose}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-all duration-200',
              pathname === profileHref || pathname.startsWith(profileHref + '/')
                ? 'bg-blue-50 dark:bg-white/15 text-[#17527E] dark:text-white'
                : 'text-gray-500 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'
            )}
          >
            <UserCircle className="w-5 h-5" />
            {t.nav.myProfile}
          </Link>
        )}
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
      {/* Desktop */}
      <aside className="hidden lg:flex w-64 bg-[#EFEFEF] dark:bg-[#1A1A2E] flex-col h-screen sticky top-0 shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
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
