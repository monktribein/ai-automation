'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/auth-context';
import { Menu, Bell, ExternalLink, ChevronDown, Check, Building, ShieldCheck } from 'lucide-react';

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, activeTenant, memberships, switchTenant, isSuperAdmin, logout } = useAuth();
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  const activeMemberships = memberships.filter((m) => m.status === 'ACTIVE');

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200/90 bg-white/95 px-4 lg:px-8 backdrop-blur-xs">
      <div className="flex items-center gap-3">
        {/* Mobile menu button */}
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
          aria-label="Open mobile menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Tenant selector if user belongs to multiple tenants */}
        {activeMemberships.length > 1 ? (
          <div className="relative">
            <button
              onClick={() => setTenantDropdownOpen(!tenantDropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors shadow-xs"
            >
              <Building className="w-3.5 h-3.5 text-slate-500" />
              <span className="max-w-[140px] truncate">{activeTenant?.name || 'Select Business'}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {tenantDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setTenantDropdownOpen(false)}
                />
                <div className="absolute left-0 mt-1.5 w-60 rounded-xl bg-white p-1.5 shadow-lg border border-slate-200 z-40 animate-fade-in text-xs">
                  <p className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Switch Workspace
                  </p>
                  {activeMemberships.map((m) => (
                    <button
                      key={m.tenantId}
                      onClick={() => {
                        setTenantDropdownOpen(false);
                        if (m.tenantId !== activeTenant?.tenantId) {
                          switchTenant(m.tenantId);
                        }
                      }}
                      className="flex w-full items-center justify-between px-2.5 py-2 rounded-lg text-left text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                    >
                      <span className="font-medium truncate">{m.name}</span>
                      {m.tenantId === activeTenant?.tenantId && (
                        <Check className="w-4 h-4 text-blue-600 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : activeTenant ? (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-50 border border-slate-100 text-xs font-medium text-slate-700">
            <Building className="w-3.5 h-3.5 text-slate-400" />
            <span className="truncate max-w-[180px]">{activeTenant.name}</span>
          </div>
        ) : null}

        {isSuperAdmin && (
          <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-bold uppercase tracking-wide">
            <ShieldCheck className="w-3 h-3" /> Super Admin
          </span>
        )}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-3">
        {/* Public booking preview button */}
        {activeTenant && (
          <Link
            href={`/book/${activeTenant.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors shadow-xs"
            title="View live public booking page"
          >
            <span>Booking Page</span>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
          </Link>
        )}

        {/* Notifications Shortcut */}
        <Link
          href="/dashboard/notifications"
          className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          title="Notifications"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-600" />
        </Link>

        {/* User Dropdown */}
        <div className="relative">
          <button
            onClick={() => setUserDropdownOpen(!userDropdownOpen)}
            className="flex items-center gap-2 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-xs shadow-xs">
              {user?.name?.slice(0, 2).toUpperCase() || 'U'}
            </div>
          </button>

          {userDropdownOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setUserDropdownOpen(false)} />
              <div className="absolute right-0 mt-2 w-52 rounded-xl bg-white p-1.5 shadow-lg border border-slate-200 z-40 animate-fade-in text-xs">
                <div className="px-3 py-2 border-b border-slate-100">
                  <p className="font-semibold text-slate-900 truncate">{user?.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
                </div>
                <div className="pt-1">
                  <Link
                    href="/dashboard/settings"
                    onClick={() => setUserDropdownOpen(false)}
                    className="block px-3 py-2 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Business Settings
                  </Link>
                  <Link
                    href="/dashboard/billing"
                    onClick={() => setUserDropdownOpen(false)}
                    className="block px-3 py-2 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Billing & Plan
                  </Link>
                  <button
                    onClick={() => {
                      setUserDropdownOpen(false);
                      logout();
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
