'use client';

import { useState } from 'react';
import { Menu, Bell, ChevronDown } from 'lucide-react';
import { PrismaLogo } from './PrismaLogo';

interface TopbarProps {
  title?: string;
  onMenuClick?: () => void;
}

export function Topbar({ title, onMenuClick }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-border h-16 flex items-center px-4 lg:px-6 gap-4 shrink-0">
      {/* Mobile menu button */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-lg hover:bg-surface text-charcoal transition-colors"
        aria-label="Abrir menú"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile logo */}
      <div className="lg:hidden flex-1 flex items-center">
        <PrismaLogo size={24} showText textColor="#2C2C2C" />
      </div>

      {/* Desktop title */}
      {title && (
        <h1 className="hidden lg:block font-heading font-bold text-lg text-charcoal flex-1">
          {title}
        </h1>
      )}
      {!title && <div className="hidden lg:block flex-1" />}

      {/* Right actions */}
      <div className="flex items-center gap-2">
        <button
          className="relative p-2 rounded-lg hover:bg-surface text-gray-500 hover:text-charcoal transition-colors"
          aria-label="Notificaciones"
        >
          <Bell className="w-5 h-5" />
          {/* Unread indicator */}
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-cta-from rounded-full" />
        </button>
      </div>
    </header>
  );
}
