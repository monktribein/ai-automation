'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { subscriptionsService } from '@/lib/api/services/team';
import { SubscriptionPlan, TenantSubscription, UsageSummary, PlanLimits } from '@/lib/api/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  CreditCard,
  Zap,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  Cpu,
  Users,
  Calendar,
  MessageSquare,
  ShieldCheck,
  Info,
} from 'lucide-react';

export default function BillingAndUsagePage() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<TenantSubscription | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [effectiveLimits, setEffectiveLimits] = useState<PlanLimits | Record<string, number>>({});

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [currentSubRes, plansRes, usageRes] = await Promise.all([
        subscriptionsService.getCurrentSubscription().catch(() => ({ subscription: null, effectiveLimits: {} })),
        subscriptionsService.listPlans().catch(() => []),
        subscriptionsService.getUsage().catch(() => null),
      ]);

      setSubscription(currentSubRes.subscription);
      setEffectiveLimits(currentSubRes.effectiveLimits || {});
      setPlans(plansRes || []);
      setUsage(usageRes);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load subscription details';
      addToast('error', msg);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activePlan = plans.find((p) => p.id === subscription?.planId) || subscription?.plan;

  const renderUsageBar = (label: string, current: number, max: number | undefined, unit = '') => {
    const isUnlimited = !max || max <= 0;
    const percentage = isUnlimited ? 0 : Math.min(100, Math.round((current / max) * 100));
    const isNearLimit = percentage >= 85;
    const isExceeded = percentage >= 100;

    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-slate-700">{label}</span>
          <span className="text-slate-500 font-mono text-[11px]">
            {current.toLocaleString()} {unit} / {isUnlimited ? 'Unlimited' : `${max.toLocaleString()} ${unit}`}
          </span>
        </div>
        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 rounded-full ${
              isExceeded
                ? 'bg-rose-500'
                : isNearLimit
                ? 'bg-amber-500'
                : 'bg-blue-600'
            }`}
            style={{ width: isUnlimited ? '5%' : `${Math.max(2, percentage)}%` }}
          />
        </div>
        {isNearLimit && !isUnlimited && (
          <p className="text-[10px] text-amber-600 flex items-center gap-1 font-medium">
            <AlertTriangle className="w-3 h-3" />
            Approaching configured tenant quota ({percentage}%)
          </p>
        )}
      </div>
    );
  };

  return (
    <DashboardLayout
      title="Subscription & Resource Usage"
      description="Monitor active plan quotas, automated resource consumption, and effective tenant limits"
      requiredPermission="usage:read"
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={loadData}
          disabled={loading}
          className="gap-2"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Usage
        </Button>
      }
    >
      <div className="space-y-6 max-w-5xl">
        {/* Current Plan Overview Card */}
        <div className="bg-gradient-to-r from-blue-900 via-indigo-950 to-slate-900 rounded-xl p-6 text-white shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] font-bold tracking-wider uppercase text-blue-400">Current Plan</span>
              <Badge variant="success" className="text-[10px] uppercase font-bold py-0.5">
                {subscription?.status || 'Active'}
              </Badge>
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              {activePlan?.name || 'Standard Tenant Plan'}
            </h2>
            <p className="text-xs text-slate-300 max-w-md">
              {activePlan?.description || 'Core automated booking and omnichannel business platform.'}
            </p>
            {activePlan?.priceMonthlyInr !== undefined && (
              <p className="text-sm font-semibold text-blue-200 pt-1">
                {formatCurrency(activePlan.priceMonthlyInr)} / month
              </p>
            )}
          </div>

          <div className="p-4 bg-white/10 backdrop-blur-xs rounded-xl border border-white/10 text-xs space-y-2 shrink-0 min-w-[200px]">
            <div>
              <span className="text-[10px] uppercase font-semibold text-slate-300">Billing Cycle</span>
              <p className="font-semibold text-white">
                {subscription?.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : 'Managed Subscription'}
              </p>
            </div>
            <div>
              <span className="text-[10px] uppercase font-semibold text-slate-300">Managed Provisioning</span>
              <p className="text-slate-300 text-[11px]">Contact enterprise account manager to upgrade limits.</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : (
          <>
            {/* Live Monthly Consumption Metrics */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-blue-600" />
                      Live Quota & Resource Usage
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Consumption metrics for billing period {usage?.period || new Date().toISOString().slice(0, 7)}
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    Period: {usage?.period || 'Current'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {renderUsageBar(
                    'Booked Appointments',
                    usage?.counters?.appointmentsCount || 0,
                    (effectiveLimits as Record<string, number>)?.maxAppointmentsPerMonth || 1000,
                    'bookings'
                  )}
                  {renderUsageBar(
                    'Staff & Resource Profiles',
                    usage?.counters?.staffCount || 0,
                    (effectiveLimits as Record<string, number>)?.maxStaff || 10,
                    'staff'
                  )}
                  {renderUsageBar(
                    'WhatsApp Automated Messages',
                    usage?.counters?.whatsappOutboundCount || 0,
                    (effectiveLimits as Record<string, number>)?.maxWhatsAppMessages || 5000,
                    'messages'
                  )}
                  {renderUsageBar(
                    'AI Token Invocations',
                    usage?.counters?.aiTokensUsed || 0,
                    (effectiveLimits as Record<string, number>)?.maxAiTokensPerMonth || 1000000,
                    'tokens'
                  )}
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-lg flex items-start gap-2.5 text-xs text-slate-600">
                  <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-800">Authoritative Backend Quotas:</span>{' '}
                    Resource consumption is tracked accurately by the core Express API. In compliance with enterprise billing controls, when a tenant approaches 100% of their limit, additional booking or AI requests are safely rate-limited without data loss.
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Configured Platform Packages Comparison */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Available Platform Packages</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {plans.map((p) => {
                  const isCurrent = p.id === subscription?.planId || p.key === activePlan?.key;
                  return (
                    <Card
                      key={p.id}
                      className={`flex flex-col justify-between transition-all ${
                        isCurrent ? 'border-2 border-blue-600 shadow-sm shadow-blue-500/10' : ''
                      }`}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">{p.name}</CardTitle>
                          {isCurrent && (
                            <Badge variant="success" className="text-[10px]">
                              Current
                            </Badge>
                          )}
                        </div>
                        <CardDescription className="text-xs min-h-[36px]">
                          {p.description}
                        </CardDescription>
                        {p.priceMonthlyInr !== undefined && (
                          <div className="pt-2">
                            <span className="text-xl font-bold text-slate-900">
                              {formatCurrency(p.priceMonthlyInr)}
                            </span>
                            <span className="text-xs text-slate-500"> / month</span>
                          </div>
                        )}
                      </CardHeader>
                      <CardContent className="pt-0 space-y-3">
                        <div className="border-t border-slate-100 pt-3 space-y-2 text-xs">
                          {p.features?.map((f, idx) => (
                            <div key={idx} className="flex items-start gap-2 text-slate-600">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                              <span>{f}</span>
                            </div>
                          ))}
                        </div>
                        {isCurrent ? (
                          <Button disabled variant="outline" className="w-full text-xs">
                            Active Subscription
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            onClick={() =>
                              addToast('info', 'Enterprise plan changes are managed by your administrator.')
                            }
                            className="w-full text-xs"
                          >
                            Plan Details
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
