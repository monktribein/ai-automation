'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { appointmentsService } from '@/lib/api/services/appointments';
import { leadsService } from '@/lib/api/services/leads';
import { subscriptionsService } from '@/lib/api/services/subscriptions';
import { Appointment, Lead, UsageSummary } from '@/lib/api/types';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { BarChart3, TrendingUp, FileSpreadsheet, Calendar, AlertCircle } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: '#10b981',
  CHECKED_IN: '#0284c7',
  COMPLETED: '#64748b',
  REQUESTED: '#f59e0b',
  PENDING_CONFIRMATION: '#d97706',
  CANCELLED: '#ef4444',
  NO_SHOW: '#dc2626',
};

export default function ReportsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'30' | '90' | 'all'>('30');

  const loadData = useCallback(async () => {
    setIsLoading(true);

    const now = new Date();
    const pastDays = timeRange === '30' ? 30 : timeRange === '90' ? 90 : 365;
    const from = new Date(now.getTime() - pastDays * 24 * 3600 * 1000).toISOString();

    try {
      const [apptsRes, leadsRes, usageRes] = await Promise.all([
        appointmentsService.list({ limit: 100, from }),
        leadsService.list({ limit: 100 }),
        subscriptionsService.getUsage(),
      ]);
      setAppointments(apptsRes.items);
      setLeads(leadsRes.items);
      setUsage(usageRes);
    } catch {
      // Error handling
    } finally {
      setIsLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Aggregate Appointment Status Distribution from actual backend data
  const statusCounts: Record<string, number> = {};
  appointments.forEach((a) => {
    statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
  });

  const pieData = Object.entries(statusCounts).map(([name, value]) => ({
    name,
    value,
  }));

  // Aggregate Lead status distribution
  const leadStatusCounts: Record<string, number> = {};
  leads.forEach((l) => {
    leadStatusCounts[l.status] = (leadStatusCounts[l.status] || 0) + 1;
  });

  const leadBarData = Object.entries(leadStatusCounts).map(([status, count]) => ({
    status,
    count,
  }));

  return (
    <DashboardLayout
      title="Reports & Analytics"
      description="Visual metrics computed from actual business appointments, leads, and monthly plan consumption"
      actions={
        <Link href="/dashboard/data-management">
          <Button size="sm" variant="outline" className="gap-1.5">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Export Excel Reports
          </Button>
        </Link>
      }
      breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Reports' }]}
    >
      {/* Date Filter & Notice */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 p-4 rounded-xl bg-white border border-slate-200">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-700">Analytics Range:</span>
          <Select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as '30' | '90' | 'all')}
            options={[
              { value: '30', label: 'Last 30 Days' },
              { value: '90', label: 'Last 90 Days' },
              { value: 'all', label: 'All Recorded Events' },
            ]}
          />
        </div>
        <p className="text-[11px] text-slate-400 italic">
          Metrics are calculated directly from verified database records.
        </p>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Appointment Status Distribution (PieChart) */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Appointment Status Distribution</CardTitle>
            <CardDescription>Breakdown of booked slots by current status</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex items-center justify-center p-4 min-h-[300px]">
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : pieData.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No appointments recorded in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={STATUS_COLORS[entry.name] || '#94a3b8'}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Lead Funnel Distribution (BarChart) */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Lead Qualification Funnel</CardTitle>
            <CardDescription>Prospect volume by pipeline qualification stage</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex items-center justify-center p-4 min-h-[300px]">
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : leadBarData.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No leads captured in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={leadBarData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="status" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Monthly Quota Consumption Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Platform Resource Usage</CardTitle>
          <CardDescription>Current consumption counters vs plan limits</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !usage ? (
            <p className="text-xs text-slate-400 italic">Usage data unavailable.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {[
                { label: 'Appointments', key: 'appointments', limitKey: 'appointmentsPerMonth' },
                { label: 'AI Messages', key: 'aiMessages', limitKey: 'aiMessagesPerMonth' },
                { label: 'WhatsApp Msgs', key: 'whatsappMessages', limitKey: 'whatsappMessagesPerMonth' },
                { label: 'AI Tokens', key: 'aiTokens', limitKey: 'aiTokensPerMonth' },
                { label: 'Excel Imports', key: 'imports', limitKey: 'importsPerMonth' },
                { label: 'Excel Exports', key: 'exports', limitKey: 'exportsPerMonth' },
              ].map((item) => {
                const usedVal = usage.used?.[item.key] || 0;
                const limitVal = (usage.limits as Record<string, number>)?.[item.limitKey];
                return (
                  <div key={item.key} className="p-3 bg-slate-50 rounded-lg border text-xs">
                    <span className="text-slate-500 font-medium">{item.label}</span>
                    <div className="text-base font-bold text-slate-900 mt-1">{usedVal}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      Limit: {limitVal !== undefined ? limitVal : 'Unlimited'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
