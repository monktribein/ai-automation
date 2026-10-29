'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { Loader2 } from 'lucide-react';

export interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  requiredPermission?: string;
  superAdminOnly?: boolean;
}

export function DashboardLayout({
  children,
  title,
  description,
  actions,
  breadcrumbs,
  requiredPermission,
  superAdminOnly,
}: DashboardLayoutProps) {
  const { user, isLoading, isSuperAdmin, hasPermission } = useAuth();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        router.push('/login');
        return;
      }
      if (superAdminOnly && !isSuperAdmin) {
        router.push('/unauthorized');
        return;
      }
      if (requiredPermission && !hasPermission(requiredPermission)) {
        router.push('/unauthorized');
        return;
      }
    }
  }, [user, isLoading, isSuperAdmin, hasPermission, superAdminOnly, requiredPermission, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <p className="text-xs font-medium text-slate-500">Loading Bizwoke Nova...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Sidebar */}
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      {/* Main Column */}
      <div className="flex flex-1 flex-col min-w-0">
        <Header onMenuClick={() => setMobileOpen(true)} />

        <main className="flex-1 p-4 lg:p-8 max-w-7xl w-full mx-auto">
          {/* Breadcrumbs */}
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav className="flex items-center gap-2 text-xs text-slate-400 mb-3" aria-label="Breadcrumbs">
              {breadcrumbs.map((b, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span>/</span>}
                  {b.href ? (
                    <a href={b.href} className="hover:text-slate-700 transition-colors">
                      {b.label}
                    </a>
                  ) : (
                    <span className="text-slate-600 font-medium">{b.label}</span>
                  )}
                </React.Fragment>
              ))}
            </nav>
          )}

          {/* Page Heading & Contextual Actions */}
          {(title || actions) && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-200/60">
              <div>
                {title && <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>}
                {description && <p className="text-xs text-slate-500 mt-1">{description}</p>}
              </div>
              {actions && <div className="flex items-center gap-2.5 shrink-0">{actions}</div>}
            </div>
          )}

          {/* Children View */}
          <div className="w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
