'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  CalendarCheck2,
  CalendarDays,
  Users,
  UserCheck,
  Briefcase,
  UserSquare2,
  Clock,
  MessageSquare,
  Bot,
  BookOpen,
  GitBranch,
  Bell,
  BarChart3,
  FileSpreadsheet,
  Settings,
  ShieldAlert,
  CreditCard,
  FileText,
  Shield,
  Layers,
  ChevronRight,
  LogOut,
  Building2,
} from 'lucide-react';

interface SidebarItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  permission?: string;
  superAdminOnly?: boolean;
}

export function Sidebar({
  mobileOpen = false,
  onClose,
}: {
  mobileOpen?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const { user, activeTenant, hasPermission, isSuperAdmin, logout } = useAuth();

  const primaryNav: SidebarItem[] = [
    { title: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { title: 'Appointments', href: '/dashboard/appointments', icon: CalendarCheck2 },
    { title: 'Calendar', href: '/dashboard/calendar', icon: CalendarDays },
    { title: 'Customers', href: '/dashboard/customers', icon: Users, permission: 'customers:read' },
    { title: 'Leads & Enquiries', href: '/dashboard/leads', icon: UserCheck, permission: 'leads:read' },
    { title: 'Services', href: '/dashboard/services', icon: Briefcase, permission: 'services:read' },
    { title: 'Staff & Team', href: '/dashboard/staff', icon: UserSquare2, permission: 'staff:read' },
    { title: 'Availability', href: '/dashboard/availability', icon: Clock, permission: 'staff:read' },
  ];

  const automationNav: SidebarItem[] = [
    { title: 'Conversations', href: '/dashboard/conversations', icon: MessageSquare, permission: 'conversations:read' },
    { title: 'AI Assistant', href: '/dashboard/ai', icon: Bot, permission: 'ai:use' },
    { title: 'Knowledge Base', href: '/dashboard/knowledge-base', icon: BookOpen, permission: 'knowledge:read' },
    { title: 'Workflows', href: '/dashboard/workflows', icon: GitBranch, permission: 'workflows:manage' },
    { title: 'Notifications', href: '/dashboard/notifications', icon: Bell, permission: 'notifications:read' },
  ];

  const managementNav: SidebarItem[] = [
    { title: 'Reports & Analytics', href: '/dashboard/reports', icon: BarChart3 },
    { title: 'Excel Import / Export', href: '/dashboard/data-management', icon: FileSpreadsheet, permission: 'imports:run' },
    { title: 'Business Settings', href: '/dashboard/settings', icon: Settings, permission: 'business:read' },
    { title: 'Team & Permissions', href: '/dashboard/team', icon: Shield, permission: 'members:read' },
    { title: 'WhatsApp Integration', href: '/dashboard/integrations/whatsapp', icon: Layers, permission: 'integrations:manage' },
    { title: 'Billing & Usage', href: '/dashboard/billing', icon: CreditCard, permission: 'usage:read' },
    { title: 'Audit Logs', href: '/dashboard/audit-logs', icon: FileText, permission: 'audit:read' },
  ];

  const superAdminNav: SidebarItem[] = [
    { title: 'Tenant Registry', href: '/platform/tenants', icon: Building2, superAdminOnly: true },
    { title: 'Platform Users', href: '/platform/users', icon: Users, superAdminOnly: true },
    { title: 'Subscription Plans', href: '/platform/plans', icon: ShieldAlert, superAdminOnly: true },
  ];

  function renderNavItem(item: SidebarItem) {
    if (item.superAdminOnly && !isSuperAdmin) return null;
    if (item.permission && !hasPermission(item.permission)) return null;

    const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
    const Icon = item.icon;

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClose}
        className={cn(
          'group flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150',
          isActive
            ? 'bg-blue-50 text-blue-700 font-semibold shadow-xs'
            : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
        )}
      >
        <Icon
          className={cn(
            'w-4 h-4 shrink-0 transition-colors',
            isActive ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'
          )}
        />
        <span className="flex-1 truncate">{item.title}</span>
        {item.badge && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold">
            {item.badge}
          </span>
        )}
      </Link>
    );
  }

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between overflow-y-auto bg-white border-r border-slate-200/90 w-64 select-none">
      <div>
        {/* Brand Header */}
        <div className="flex h-16 items-center px-5 border-b border-slate-100 gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-base shadow-sm shadow-blue-500/25">
            B
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-slate-900 leading-tight">Bizwoke Nova</span>
            <span className="text-[10px] font-medium tracking-wide text-blue-600 uppercase">AI Automation</span>
          </div>
        </div>

        {/* Tenant context banner if active */}
        {activeTenant && (
          <div className="mx-3 mt-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200/70 flex items-center justify-between">
            <div className="truncate pr-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Tenant</p>
              <p className="text-xs font-semibold text-slate-800 truncate">{activeTenant.name}</p>
            </div>
            <Link
              href="/dashboard/settings"
              className="text-slate-400 hover:text-blue-600 p-1 rounded"
              title="Tenant Settings"
            >
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {/* Navigation Sections */}
        <div className="px-3 py-4 space-y-6">
          <div className="space-y-1">
            <p className="px-3 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">Operations</p>
            {primaryNav.map(renderNavItem)}
          </div>

          <div className="space-y-1">
            <p className="px-3 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">AI & Channels</p>
            {automationNav.map(renderNavItem)}
          </div>

          <div className="space-y-1">
            <p className="px-3 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">Management</p>
            {managementNav.map(renderNavItem)}
          </div>

          {isSuperAdmin && (
            <div className="space-y-1 border-t border-slate-100 pt-4">
              <p className="px-3 text-[10px] font-semibold tracking-wider text-indigo-500 uppercase">Platform Admin</p>
              {superAdminNav.map(renderNavItem)}
            </div>
          )}
        </div>
      </div>

      {/* User profile / Logout footer */}
      <div className="p-3 border-t border-slate-100 bg-slate-50/50">
        <div className="flex items-center justify-between gap-3 p-2 rounded-lg bg-white border border-slate-200/80 shadow-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-700 font-semibold text-xs border border-slate-200">
              {user?.name?.slice(0, 2).toUpperCase() || 'U'}
            </div>
            <div className="truncate">
              <p className="text-xs font-semibold text-slate-900 truncate">{user?.name || 'Operator'}</p>
              <p className="text-[11px] text-slate-400 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={() => logout()}
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sticky Sidebar */}
      <aside className="hidden lg:block h-screen sticky top-0 shrink-0 z-20">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={onClose} />
          <div className="fixed inset-y-0 left-0 max-w-xs w-full shadow-2xl animate-fade-in z-10">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
