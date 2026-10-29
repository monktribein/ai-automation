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
import { User, PaginationMeta } from '@/lib/api/types';
import { formatDate } from '@/lib/utils';
import {
  Users,
  Search,
  RefreshCw,
  ShieldAlert,
  Power,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

export default function PlatformUsersPage() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Status Modal
  const [statusUser, setStatusUser] = useState<User | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<'ACTIVE' | 'DEACTIVATED'>('ACTIVE');
  const [statusReason, setStatusReason] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await platformService.listUsers({
        page,
        limit: 25,
        search: search.trim() || undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
      });
      setUsers(res.items || []);
      if (res.meta) setMeta(res.meta);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load platform users';
      addToast('error', msg);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, addToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleUpdateStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusUser) return;

    try {
      setSavingStatus(true);
      await platformService.updateUserStatus(statusUser.id, selectedStatus, statusReason.trim() || undefined);
      addToast('success', `User account status updated to ${selectedStatus}`);
      setStatusUser(null);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update user status';
      addToast('error', msg);
    } finally {
      setSavingStatus(false);
    }
  };

  return (
    <DashboardLayout
      title="Platform Users & Identities"
      description="Super Administrator governance of global user credentials, system privileges, and access states"
      superAdminOnly
      actions={
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
      }
    >
      <div className="space-y-6">
        {/* Search & Filters */}
        <Card>
          <CardContent className="p-4 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="relative flex-1 w-full md:max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by user name or email..."
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
                  { value: 'ACTIVE', label: 'Active Users' },
                  { value: 'DEACTIVATED', label: 'Deactivated' },
                ]}
                className="text-xs h-9"
              />
            </div>
          </CardContent>
        </Card>

        {/* Users Table */}
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : users.length === 0 ? (
          <EmptyState
            title="No users found"
            description="No user accounts match your search filters."
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">User</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">System Role</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Joined Date</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-900">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-xs">
                            {u.name?.slice(0, 1).toUpperCase() || 'U'}
                          </div>
                          <span>{u.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">{u.email}</td>
                      <td className="py-3 px-4">
                        {u.systemRole === 'SUPER_ADMIN' ? (
                          <Badge variant="default" className="bg-indigo-600 text-white text-[10px] gap-1">
                            <ShieldAlert className="w-3 h-3" />
                            SUPER_ADMIN
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            USER
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {u.status === 'ACTIVE' ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="destructive">Deactivated</Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500">{formatDate(u.createdAt)}</td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setStatusUser(u);
                            setSelectedStatus(u.status);
                            setStatusReason('');
                          }}
                          className="h-8 px-2 text-xs"
                        >
                          <Power className="w-3.5 h-3.5 mr-1" />
                          Change Status
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50 text-xs text-slate-500">
              <span>
                Showing {users.length} of {meta.total} users
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

        {/* Change User Status Modal */}
        <Dialog
          isOpen={!!statusUser}
          onClose={() => setStatusUser(null)}
          title={`Update User Status: ${statusUser?.email}`}
        >
          <form onSubmit={handleUpdateStatus} className="space-y-4">
            <Select
              label="Account Access Status"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as 'ACTIVE' | 'DEACTIVATED')}
              options={[
                { value: 'ACTIVE', label: 'Active - User can log in normally' },
                { value: 'DEACTIVATED', label: 'Deactivated - Invalidate active sessions and prevent login' },
              ]}
            />

            <Input
              label="Reason for Status Change (Optional)"
              placeholder="e.g. Account security review or request"
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
            />

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => setStatusUser(null)}>
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
      </div>
    </DashboardLayout>
  );
}
