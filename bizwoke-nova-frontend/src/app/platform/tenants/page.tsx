'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { platformService } from '@/lib/api/services/platform';
import { subscriptionsService } from '@/lib/api/services/team';
import { Tenant, SubscriptionPlan, PaginationMeta } from '@/lib/api/types';
import { formatDate } from '@/lib/utils';
import {
  Building2,
  Plus,
  Search,
  RefreshCw,
  ShieldCheck,
  CreditCard,
  Edit,
  Power,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';

export default function PlatformTenantsPage() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Create Tenant Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [savingCreate, setSavingCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newCategory, setNewCategory] = useState('CLINIC');
  const [newTimezone, setNewTimezone] = useState('Asia/Kolkata');

  // Status Change Modal
  const [statusTenant, setStatusTenant] = useState<Tenant | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'>('ACTIVE');
  const [statusReason, setStatusReason] = useState('');

  // Assign Plan Modal
  const [planTenant, setPlanTenant] = useState<Tenant | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [tenantsRes, plansRes] = await Promise.all([
        platformService.listTenants({
          page,
          limit: 25,
          search: search.trim() || undefined,
          status: statusFilter !== 'ALL' ? statusFilter : undefined,
        }),
        subscriptionsService.listPlans().catch(() => []),
      ]);

      setTenants(tenantsRes.items || []);
      if (tenantsRes.meta) setMeta(tenantsRes.meta);
      setPlans(plansRes || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load platform tenants';
      addToast('error', msg);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, addToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const sanitizedSlug = newSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!newName.trim() || !sanitizedSlug) {
      addToast('error', 'Business name and valid slug are required');
      return;
    }

    try {
      setSavingCreate(true);
      await platformService.createTenant({
        name: newName.trim(),
        slug: sanitizedSlug,
        category: newCategory,
        timezone: newTimezone,
      });
      addToast('success', `Tenant "${newName}" provisioned successfully`);
      setShowCreateModal(false);
      setNewName('');
      setNewSlug('');
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to provision tenant';
      addToast('error', msg);
    } finally {
      setSavingCreate(false);
    }
  };

  const handleUpdateStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusTenant) return;

    try {
      setSavingStatus(true);
      await platformService.updateTenantStatus(statusTenant.id, selectedStatus, statusReason.trim() || undefined);
      addToast('success', `Tenant status updated to ${selectedStatus}`);
      setStatusTenant(null);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update tenant status';
      addToast('error', msg);
    } finally {
      setSavingStatus(false);
    }
  };

  const handleAssignPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planTenant || !selectedPlanId) return;

    try {
      setSavingPlan(true);
      await platformService.assignSubscription(planTenant.id, {
        planId: selectedPlanId,
      });
      addToast('success', 'Subscription plan assigned to tenant');
      setPlanTenant(null);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to assign plan';
      addToast('error', msg);
    } finally {
      setSavingPlan(false);
    }
  };

  const getStatusBadge = (status: Tenant['status']) => {
    switch (status) {
      case 'ACTIVE':
        return <Badge variant="success">Active</Badge>;
      case 'SUSPENDED':
        return <Badge variant="warning">Suspended</Badge>;
      case 'DEACTIVATED':
        return <Badge variant="destructive">Deactivated</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <DashboardLayout
      title="Platform Tenant Registry"
      description="Super Administrator registry of provisioned organizations, operational statuses, and subscription tiers"
      superAdminOnly
      actions={
        <Button
          size="sm"
          onClick={() => {
            setNewName('');
            setNewSlug('');
            setNewCategory('CLINIC');
            setNewTimezone('Asia/Kolkata');
            setShowCreateModal(true);
          }}
          className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
        >
          <Plus className="w-4 h-4" />
          Provision Tenant
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Filters */}
        <Card>
          <CardContent className="p-4 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="relative flex-1 w-full md:max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search tenants by name or slug..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
              <Select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                options={[
                  { value: 'ALL', label: 'All Statuses' },
                  { value: 'ACTIVE', label: 'Active Only' },
                  { value: 'SUSPENDED', label: 'Suspended' },
                  { value: 'DEACTIVATED', label: 'Deactivated' },
                ]}
                className="text-xs h-9"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={loadData}
                disabled={loading}
                className="p-2 h-9 w-9 shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Tenant Table */}
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : tenants.length === 0 ? (
          <EmptyState
            title="No tenants found"
            description="No provisioned organizations match your current search criteria."
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Organization</th>
                    <th className="py-3 px-4">Public Slug</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Created Date</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {tenants.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs shrink-0">
                            <Building2 className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900">{t.name}</p>
                            <p className="text-[11px] text-slate-400 font-mono">ID: {t.id.slice(-6)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">
                        <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px]">{t.slug}</span>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className="text-[10px]">
                          {t.category || 'General'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">{getStatusBadge(t.status)}</td>
                      <td className="py-3 px-4 text-slate-500">{formatDate(t.createdAt)}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setPlanTenant(t);
                              setSelectedPlanId(plans[0]?.id || '');
                            }}
                            className="h-8 px-2 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                            title="Assign Plan"
                          >
                            <CreditCard className="w-3.5 h-3.5 mr-1" />
                            Plan
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setStatusTenant(t);
                              setSelectedStatus(t.status);
                              setStatusReason('');
                            }}
                            className="h-8 px-2 text-xs"
                          >
                            <Power className="w-3.5 h-3.5 mr-1" />
                            Status
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50 text-xs text-slate-500">
              <span>
                Showing {tenants.length} of {meta.total} tenants
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="h-8 px-2.5 text-xs"
                >
                  <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= (meta.totalPages || 1)}
                  className="h-8 px-2.5 text-xs"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Provision Tenant Modal */}
        <Dialog
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          title="Provision New Tenant Organization"
        >
          <form onSubmit={handleCreate} className="space-y-4">
            <Input
              label="Business / Organization Name"
              placeholder="e.g. Apollo Healthcare Clinic"
              required
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (!newSlug) {
                  setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                }
              }}
            />

            <Input
              label="URL Slug (Permanent Path)"
              placeholder="e.g. apollo-clinic"
              required
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              helperText="Determines public booking URL: /book/apollo-clinic"
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select
                label="Industry Category"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                options={[
                  { value: 'CLINIC', label: 'Healthcare & Clinic' },
                  { value: 'SALON', label: 'Salon & Spa' },
                  { value: 'CONSULTING', label: 'Consulting & Legal' },
                  { value: 'COACHING', label: 'Education & Coaching' },
                  { value: 'HOTEL', label: 'Hospitality & Hotel' },
                  { value: 'GENERAL', label: 'General Service Business' },
                ]}
              />

              <Input
                label="Primary Timezone"
                value={newTimezone}
                onChange={(e) => setNewTimezone(e.target.value)}
                helperText="e.g. Asia/Kolkata, America/New_York"
              />
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
                {savingCreate ? 'Provisioning...' : 'Provision Tenant'}
              </Button>
            </div>
          </form>
        </Dialog>

        {/* Change Status Modal */}
        <Dialog
          isOpen={!!statusTenant}
          onClose={() => setStatusTenant(null)}
          title={`Update Status: ${statusTenant?.name}`}
        >
          <form onSubmit={handleUpdateStatus} className="space-y-4">
            <Select
              label="Operational Status"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED')}
              options={[
                { value: 'ACTIVE', label: 'Active - Full operational access' },
                { value: 'SUSPENDED', label: 'Suspended - Temporary hold (e.g. billing failure)' },
                { value: 'DEACTIVATED', label: 'Deactivated - Permanent shutdown' },
              ]}
            />

            <Input
              label="Reason / Audit Note (Optional)"
              placeholder="e.g. Customer request or policy violation"
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
            />

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => setStatusTenant(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingStatus}
                className="bg-indigo-600 hover:bg-indigo-700 text-white min-w-[120px]"
              >
                {savingStatus ? 'Updating...' : 'Update Status'}
              </Button>
            </div>
          </form>
        </Dialog>

        {/* Assign Plan Modal */}
        <Dialog
          isOpen={!!planTenant}
          onClose={() => setPlanTenant(null)}
          title={`Assign Subscription Plan: ${planTenant?.name}`}
        >
          <form onSubmit={handleAssignPlan} className="space-y-4">
            <Select
              label="Select Subscription Plan"
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value)}
              options={plans.map((p) => ({
                value: p.id,
                label: `${p.name} (${p.key})`,
              }))}
            />

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => setPlanTenant(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingPlan}
                className="bg-indigo-600 hover:bg-indigo-700 text-white min-w-[120px]"
              >
                {savingPlan ? 'Assigning...' : 'Assign Plan'}
              </Button>
            </div>
          </form>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
