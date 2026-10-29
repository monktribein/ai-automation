'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { appointmentsService } from '@/lib/api/services/appointments';
import { leadsService } from '@/lib/api/services/leads';
import { conversationsService } from '@/lib/api/services/conversations';
import { subscriptionsService } from '@/lib/api/services/subscriptions';
import { aiService } from '@/lib/api/services/ai';
import { Appointment, Lead, ConversationSession, UsageSummary } from '@/lib/api/types';
import { formatDateTime, formatDate } from '@/lib/utils';
import {
  CalendarCheck2,
  Users,
  Clock,
  UserPlus,
  CalendarPlus,
  MessageSquare,
  Bot,
  ArrowUpRight,
  TrendingUp,
  AlertCircle,
  Briefcase,
  Layers,
} from 'lucide-react';

export default function OverviewDashboardPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [conversations, setConversations] = useState<ConversationSession[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    const [apptsRes, leadsRes, convsRes, usageRes, aiRes] = await Promise.allSettled([
      appointmentsService.list({ limit: 10, sort: '-createdAt' }),
      leadsService.list({ limit: 5 }),
      conversationsService.list({ limit: 5 }),
      subscriptionsService.getUsage(),
      aiService.getStatus(),
    ]);

    if (apptsRes.status === 'fulfilled') {
      setAppointments(apptsRes.value.items);
    }
    if (leadsRes.status === 'fulfilled') {
      setLeads(leadsRes.value.items);
    }
    if (convsRes.status === 'fulfilled') {
      setConversations(convsRes.value.items);
    }
    if (usageRes.status === 'fulfilled') {
      setUsage(usageRes.value);
    }
    if (aiRes.status === 'fulfilled') {
      setAiAvailable(aiRes.value.available);
    }

    // If all failed, show network or backend connection issue
    if (
      apptsRes.status === 'rejected' &&
      leadsRes.status === 'rejected' &&
      usageRes.status === 'rejected'
    ) {
      setError('Unable to load dashboard data. Please ensure the backend is running and you are connected to an active tenant.');
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Derived metrics from real appointments and usage
  const totalAppointmentsCount = usage?.used?.appointments ?? appointments.length;
  const pendingAppointments = appointments.filter(
    (a) => a.status === 'PENDING_CONFIRMATION' || a.status === 'REQUESTED'
  ).length;
  const confirmedAppointments = appointments.filter((a) => a.status === 'CONFIRMED').length;
  const completedAppointments = appointments.filter((a) => a.status === 'COMPLETED').length;
  const aiMessagesCount = usage?.used?.aiMessages ?? 0;
  const newLeadsCount = leads.filter((l) => l.status === 'NEW').length;

  return (
    <DashboardLayout
      title="Business Overview"
      description="Real-time operational summary, appointments, customer enquiries, and AI automation activity"
      actions={
        <div className="flex items-center gap-2">
          <Link href="/dashboard/appointments?create=true">
            <Button size="sm" variant="primary" className="gap-1.5 shadow-xs">
              <CalendarPlus className="w-3.5 h-3.5" /> Book Appointment
            </Button>
          </Link>
          <Link href="/dashboard/customers">
            <Button size="sm" variant="outline" className="gap-1.5">
              <UserPlus className="w-3.5 h-3.5" /> Add Customer
            </Button>
          </Link>
        </div>
      }
    >
      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-900">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-semibold">Backend Connection Notice</h4>
            <p className="mt-1">{error}</p>
          </div>
          <Button size="sm" variant="outline" onClick={loadData}>
            Retry
          </Button>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        {/* Total Month Appointments */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Appointments (This Month)
              </span>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <CalendarCheck2 className="w-4 h-4" />
              </div>
            </div>
            {isLoading ? (
              <Skeleton className="h-8 w-20 mt-3" />
            ) : (
              <div className="mt-2">
                <div className="text-2xl font-bold text-slate-900">{totalAppointmentsCount}</div>
                <p className="mt-1 text-[11px] text-slate-500 flex items-center gap-1">
                  <span className="text-emerald-600 font-semibold">{confirmedAppointments} confirmed</span>,{' '}
                  <span className="text-amber-600 font-semibold">{pendingAppointments} pending</span>
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* New Leads */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                New Customer Leads
              </span>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
                <Users className="w-4 h-4" />
              </div>
            </div>
            {isLoading ? (
              <Skeleton className="h-8 w-20 mt-3" />
            ) : (
              <div className="mt-2">
                <div className="text-2xl font-bold text-slate-900">{newLeadsCount}</div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {leads.length} total captured enquiries
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Conversations */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                AI Assistant Interactions
              </span>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <Bot className="w-4 h-4" />
              </div>
            </div>
            {isLoading ? (
              <Skeleton className="h-8 w-20 mt-3" />
            ) : (
              <div className="mt-2">
                <div className="text-2xl font-bold text-slate-900">{aiMessagesCount}</div>
                <p className="mt-1 text-[11px] text-slate-500 flex items-center gap-1">
                  Status:{' '}
                  <span
                    className={
                      aiAvailable
                        ? 'font-semibold text-emerald-600'
                        : 'font-semibold text-slate-500'
                    }
                  >
                    {aiAvailable ? 'Online & Connected' : 'Configured / Standby'}
                  </span>
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Subscription Tier */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Subscription Plan
              </span>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            {isLoading ? (
              <Skeleton className="h-8 w-20 mt-3" />
            ) : (
              <div className="mt-2">
                <div className="text-xl font-bold text-slate-900 capitalize">
                  {usage?.plan ? usage.plan.replace(/-/g, ' ') : 'Standard Active'}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Period: {usage?.period || formatDate(new Date(), { month: 'long', year: 'numeric' })}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Action Shortcuts Banner */}
      <Card className="mb-6 bg-gradient-to-r from-blue-50/50 via-white to-indigo-50/30 border-blue-100/80">
        <CardContent className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Workspace Quick Actions</h4>
              <p className="text-xs text-slate-500">Fast configuration and catalog setup shortcuts</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/dashboard/services">
              <Button size="sm" variant="outline" className="text-xs gap-1">
                <Briefcase className="w-3.5 h-3.5 text-slate-500" /> Services
              </Button>
            </Link>
            <Link href="/dashboard/availability">
              <Button size="sm" variant="outline" className="text-xs gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-500" /> Availability & Hours
              </Button>
            </Link>
            <Link href="/dashboard/conversations">
              <Button size="sm" variant="outline" className="text-xs gap-1">
                <MessageSquare className="w-3.5 h-3.5 text-slate-500" /> Conversation Inbox
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Split Content: Recent Appointments & Recent Leads */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Appointments (2 cols) */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle>Recent Appointments</CardTitle>
                <CardDescription>Latest bookings committed to the system</CardDescription>
              </div>
              <Link
                href="/dashboard/appointments"
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                View all <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : appointments.length === 0 ? (
                <EmptyState
                  icon={<CalendarCheck2 className="w-6 h-6" />}
                  title="No appointments booked yet"
                  description="When appointments are booked through the public portal, staff portal, or WhatsApp AI, they will appear here."
                  actionLabel="Book First Appointment"
                  onAction={() => (window.location.href = '/dashboard/appointments?create=true')}
                />
              ) : (
                <div className="divide-y divide-slate-100">
                  {appointments.slice(0, 5).map((appt) => (
                    <div
                      key={appt._id}
                      className="py-3 flex items-center justify-between gap-4 hover:bg-slate-50/50 rounded-lg px-2 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-800">
                            {appt.reference}
                          </span>
                          <StatusBadge status={appt.status} />
                        </div>
                        <p className="text-xs text-slate-500 mt-1 truncate">
                          Start:{' '}
                          <span className="font-medium text-slate-700">
                            {formatDateTime(appt.startAt, appt.timezone)}
                          </span>
                        </p>
                      </div>
                      <Link href={`/dashboard/appointments/${appt._id}`}>
                        <Button size="sm" variant="ghost" className="text-xs">
                          Details
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Enquiries & Leads (1 col) */}
        <div>
          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle>Recent Leads</CardTitle>
                <CardDescription>Prospect enquiries and conversions</CardDescription>
              </div>
              <Link
                href="/dashboard/leads"
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                View all <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : leads.length === 0 ? (
                <EmptyState
                  icon={<Users className="w-6 h-6" />}
                  title="No enquiries yet"
                  description="Enquiries submitted via the public portal or AI conversations will be listed here."
                />
              ) : (
                <div className="divide-y divide-slate-100">
                  {leads.map((lead) => (
                    <div key={lead._id} className="py-3 px-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-900 truncate">
                          {lead.name}
                        </span>
                        <StatusBadge status={lead.status} />
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                        {lead.email || lead.phone || 'No direct contact'}
                      </p>
                      {lead.message && (
                        <p className="text-[11px] text-slate-600 mt-1 line-clamp-1 italic">
                          &ldquo;{lead.message}&rdquo;
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
