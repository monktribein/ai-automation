'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { subscriptionsService } from '@/lib/api/services/team';
import { platformService } from '@/lib/api/services/platform';
import { SubscriptionPlan, PlanLimits } from '@/lib/api/types';
import { formatCurrency } from '@/lib/utils';
import {
  ShieldAlert,
  Plus,
  RefreshCw,
  Edit2,
  CheckCircle2,
  Star,
  Zap,
} from 'lucide-react';

export default function PlatformPlansPage() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);

  // Create Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [savingCreate, setSavingCreate] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPrice, setNewPrice] = useState('2499');
  const [newFeatures, setNewFeatures] = useState('Online Booking, Calendar Sync, Email Confirmations');
  const [newStaffLimit, setNewStaffLimit] = useState('5');
  const [newApptsLimit, setNewApptsLimit] = useState('500');
  const [newWaLimit, setNewWaLimit] = useState('1000');
  const [newAiTokensLimit, setNewAiTokensLimit] = useState('500000');
  const [newIsDefault, setNewIsDefault] = useState(false);

  // Edit Modal
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPrice, setEditPrice] = useState('0');
  const [editFeatures, setEditFeatures] = useState('');
  const [editStaffLimit, setEditStaffLimit] = useState('10');
  const [editApptsLimit, setEditApptsLimit] = useState('1000');
  const [editWaLimit, setEditWaLimit] = useState('5000');
  const [editAiTokensLimit, setEditAiTokensLimit] = useState('1000000');
  const [editIsDefault, setEditIsDefault] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await subscriptionsService.listPlans();
      setPlans(res || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load platform subscription plans';
      addToast('error', msg);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const formattedKey = newKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!formattedKey || !newName.trim()) {
      addToast('error', 'Plan key and display name are required');
      return;
    }

    try {
      setSavingCreate(true);
      const featuresArr = newFeatures
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);

      await platformService.createPlan({
        key: formattedKey,
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        priceMonthlyInr: Number(newPrice) || 0,
        features: featuresArr,
        limits: {
          maxStaff: Number(newStaffLimit) || 1,
          maxAppointmentsPerMonth: Number(newApptsLimit) || 100,
          maxWhatsAppMessages: Number(newWaLimit) || 0,
          maxAiTokensPerMonth: Number(newAiTokensLimit) || 0,
        },
        isDefault: newIsDefault,
      });

      addToast('success', `Plan "${newName}" created successfully`);
      setShowCreateModal(false);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create subscription plan';
      addToast('error', msg);
    } finally {
      setSavingCreate(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlan) return;

    try {
      setSavingEdit(true);
      const featuresArr = editFeatures
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);

      await platformService.updatePlan(editingPlan.id, {
        name: editName.trim(),
        description: editDesc.trim(),
        priceMonthlyInr: Number(editPrice) || 0,
        features: featuresArr,
        limits: {
          maxStaff: Number(editStaffLimit) || 1,
          maxAppointmentsPerMonth: Number(editApptsLimit) || 100,
          maxWhatsAppMessages: Number(editWaLimit) || 0,
          maxAiTokensPerMonth: Number(editAiTokensLimit) || 0,
        },
        isDefault: editIsDefault,
      });

      addToast('success', 'Plan updated successfully');
      setEditingPlan(null);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update plan';
      addToast('error', msg);
    } finally {
      setSavingEdit(false);
    }
  };

  const openEditModal = (p: SubscriptionPlan) => {
    setEditingPlan(p);
    setEditName(p.name);
    setEditDesc(p.description || '');
    setEditPrice(String(p.priceMonthlyInr || 0));
    setEditFeatures((p.features || []).join(', '));
    setEditStaffLimit(String(p.limits?.maxStaff || 10));
    setEditApptsLimit(String(p.limits?.maxAppointmentsPerMonth || 1000));
    setEditWaLimit(String(p.limits?.maxWhatsAppMessages || 5000));
    setEditAiTokensLimit(String(p.limits?.maxAiTokensPerMonth || 1000000));
    setEditIsDefault(!!p.isDefault);
  };

  return (
    <DashboardLayout
      title="Platform Subscription Plans"
      description="Super Administrator catalog of configurable tenant packages, resource limits, and pricing"
      superAdminOnly
      actions={
        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setShowCreateModal(true)}
            className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            <Plus className="w-4 h-4" />
            Create Plan
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : plans.length === 0 ? (
          <EmptyState
            title="No subscription plans configured"
            description="Create subscription tiers such as Appointment Lite, AI Lead Assistant, and Business Pro."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {plans.map((plan) => (
              <Card key={plan.id} className="flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base font-bold">{plan.name}</CardTitle>
                        {plan.isDefault && (
                          <Badge variant="default" className="text-[10px] gap-1 bg-amber-500 text-white">
                            <Star className="w-3 h-3 fill-current" />
                            Default
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] font-mono text-slate-400 mt-0.5">{plan.key}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditModal(plan)}
                      className="h-8 px-2 text-xs text-indigo-600 hover:text-indigo-800"
                    >
                      <Edit2 className="w-3.5 h-3.5 mr-1" />
                      Edit
                    </Button>
                  </div>
                  <CardDescription className="text-xs min-h-[36px] mt-1">
                    {plan.description}
                  </CardDescription>
                  <div className="pt-2">
                    <span className="text-xl font-bold text-slate-900">
                      {formatCurrency(plan.priceMonthlyInr || 0)}
                    </span>
                    <span className="text-xs text-slate-500"> / month</span>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-4">
                  {/* Quota Limits */}
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200/80 space-y-1.5 text-xs text-slate-700">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Appointments / mo:</span>
                      <span className="font-semibold">{plan.limits?.maxAppointmentsPerMonth?.toLocaleString() || 'Unlimited'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Staff Providers:</span>
                      <span className="font-semibold">{plan.limits?.maxStaff || 'Unlimited'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">WhatsApp Messages:</span>
                      <span className="font-semibold">{plan.limits?.maxWhatsAppMessages?.toLocaleString() || '0'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">AI Tokens / mo:</span>
                      <span className="font-semibold">{plan.limits?.maxAiTokensPerMonth?.toLocaleString() || '0'}</span>
                    </div>
                  </div>

                  {/* Feature Checklist */}
                  <div className="space-y-1.5 border-t border-slate-100 pt-3">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Features</span>
                    <div className="space-y-1 text-xs text-slate-600">
                      {plan.features?.map((f, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{f}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Create Plan Modal */}
        <Dialog
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          title="Create Subscription Plan"
        >
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label="Plan Key (Uppercase)"
                placeholder="e.g. BUSINESS_PRO"
                required
                value={newKey}
                onChange={(e) => setNewKey(e.target.value.toUpperCase())}
              />
              <Input
                label="Display Name"
                placeholder="e.g. Business Pro"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label="Monthly Price (INR)"
                type="number"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
              />
              <div className="flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  id="defaultPlanCheck"
                  checked={newIsDefault}
                  onChange={(e) => setNewIsDefault(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 rounded"
                />
                <label htmlFor="defaultPlanCheck" className="text-xs font-semibold text-slate-700 cursor-pointer">
                  Assign as Default for New Tenants
                </label>
              </div>
            </div>

            <Input
              label="Description"
              placeholder="e.g. Complete AI Automation & WhatsApp Suite for growing clinics"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />

            <Input
              label="Features (Comma separated)"
              placeholder="e.g. AI WhatsApp Assistant, Unlimited Bookings, Multi-Staff"
              value={newFeatures}
              onChange={(e) => setNewFeatures(e.target.value)}
            />

            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-700 block">Quota Quotas & Limits</span>
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                <Input
                  label="Max Appointments/mo"
                  type="number"
                  value={newApptsLimit}
                  onChange={(e) => setNewApptsLimit(e.target.value)}
                  className="text-xs"
                />
                <Input
                  label="Max Staff Members"
                  type="number"
                  value={newStaffLimit}
                  onChange={(e) => setNewStaffLimit(e.target.value)}
                  className="text-xs"
                />
                <Input
                  label="Max WhatsApp Messages"
                  type="number"
                  value={newWaLimit}
                  onChange={(e) => setNewWaLimit(e.target.value)}
                  className="text-xs"
                />
                <Input
                  label="Max AI Tokens/mo"
                  type="number"
                  value={newAiTokensLimit}
                  onChange={(e) => setNewAiTokensLimit(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingCreate}
                className="bg-indigo-600 hover:bg-indigo-700 text-white min-w-[120px]"
              >
                {savingCreate ? 'Creating...' : 'Create Plan'}
              </Button>
            </div>
          </form>
        </Dialog>

        {/* Edit Plan Modal */}
        <Dialog
          isOpen={!!editingPlan}
          onClose={() => setEditingPlan(null)}
          title={`Edit Plan: ${editingPlan?.name}`}
        >
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label="Display Name"
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <Input
                label="Monthly Price (INR)"
                type="number"
                value={editPrice}
                onChange={(e) => setEditPrice(e.target.value)}
              />
            </div>

            <Input
              label="Description"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
            />

            <Input
              label="Features (Comma separated)"
              value={editFeatures}
              onChange={(e) => setEditFeatures(e.target.value)}
            />

            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-700 block">Quota Quotas & Limits</span>
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                <Input
                  label="Max Appointments/mo"
                  type="number"
                  value={editApptsLimit}
                  onChange={(e) => setEditApptsLimit(e.target.value)}
                  className="text-xs"
                />
                <Input
                  label="Max Staff Members"
                  type="number"
                  value={editStaffLimit}
                  onChange={(e) => setEditStaffLimit(e.target.value)}
                  className="text-xs"
                />
                <Input
                  label="Max WhatsApp Messages"
                  type="number"
                  value={editWaLimit}
                  onChange={(e) => setNewWaLimit(e.target.value)}
                  className="text-xs"
                />
                <Input
                  label="Max AI Tokens/mo"
                  type="number"
                  value={editAiTokensLimit}
                  onChange={(e) => setEditAiTokensLimit(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="editDefaultPlanCheck"
                checked={editIsDefault}
                onChange={(e) => setEditIsDefault(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded"
              />
              <label htmlFor="editDefaultPlanCheck" className="text-xs font-semibold text-slate-700 cursor-pointer">
                Set as Default Plan for New Tenants
              </label>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => setEditingPlan(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingEdit}
                className="bg-indigo-600 hover:bg-indigo-700 text-white min-w-[120px]"
              >
                {savingEdit ? 'Saving...' : 'Save Plan Changes'}
              </Button>
            </div>
          </form>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
