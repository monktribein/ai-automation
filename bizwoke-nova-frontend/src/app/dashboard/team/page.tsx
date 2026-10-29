'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
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
import { teamService } from '@/lib/api/services/team';
import { staffService } from '@/lib/api/services/staff';
import { TenantMember, TenantRole, StaffMember } from '@/lib/api/types';
import { formatDate } from '@/lib/utils';
import {
  Users,
  UserPlus,
  Shield,
  Search,
  RefreshCw,
  MoreVertical,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Mail,
  UserCheck,
} from 'lucide-react';

export default function TeamManagementPage() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [roles, setRoles] = useState<TenantRole[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Add Member Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [savingAdd, setSavingAdd] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRoles, setNewRoles] = useState<string[]>([]);
  const [newStaffId, setNewStaffId] = useState('');

  // Edit Member Modal
  const [editingMember, setEditingMember] = useState<TenantMember | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [editStatus, setEditStatus] = useState<'ACTIVE' | 'SUSPENDED' | 'REVOKED'>('ACTIVE');
  const [editStaffId, setEditStaffId] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [membersRes, rolesRes, staffRes] = await Promise.all([
        teamService.listMembers(1, 100),
        teamService.listRoles().catch(() => []),
        staffService.list().catch(() => ({ items: [] })),
      ]);
      setMembers(membersRes.items || []);
      setRoles(rolesRes || []);
      setStaffList(staffRes.items || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load team members';
      addToast('error', msg);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) {
      addToast('error', 'Please enter a valid member email');
      return;
    }
    if (newRoles.length === 0) {
      addToast('error', 'Please assign at least one role to the member');
      return;
    }

    try {
      setSavingAdd(true);
      await teamService.addMember({
        email: newEmail.trim().toLowerCase(),
        roleKeys: newRoles,
        staffId: newStaffId || undefined,
      });
      addToast('success', 'Team member invited successfully');
      setShowAddModal(false);
      setNewEmail('');
      setNewRoles([]);
      setNewStaffId('');
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to invite member';
      addToast('error', msg);
    } finally {
      setSavingAdd(false);
    }
  };

  const handleEditMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;
    if (editRoles.length === 0) {
      addToast('error', 'Member must retain at least one role');
      return;
    }

    try {
      setSavingEdit(true);
      await teamService.updateMember(editingMember.id, {
        roleKeys: editRoles,
        status: editStatus,
        staffId: editStaffId || null,
      });
      addToast('success', 'Member updated successfully');
      setEditingMember(null);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update member';
      addToast('error', msg);
    } finally {
      setSavingEdit(false);
    }
  };

  const openEditModal = (member: TenantMember) => {
    setEditingMember(member);
    setEditRoles(member.roleKeys || []);
    setEditStatus(member.status);
    setEditStaffId(member.staffId || '');
  };

  const filteredMembers = members.filter((m) => {
    const matchesSearch = m.email.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || m.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: TenantMember['status']) => {
    switch (status) {
      case 'ACTIVE':
        return <Badge variant="success">Active</Badge>;
      case 'SUSPENDED':
        return <Badge variant="warning">Suspended</Badge>;
      case 'REVOKED':
        return <Badge variant="destructive">Revoked</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <DashboardLayout
      title="Team Members & Access"
      description="Manage authorized users, assign operational roles, and link staff calendar profiles"
      requiredPermission="members:read"
      actions={
        <div className="flex items-center gap-2.5">
          <Link href="/dashboard/roles">
            <Button variant="outline" size="sm" className="gap-2">
              <Shield className="w-3.5 h-3.5 text-blue-600" />
              Role Catalog
            </Button>
          </Link>
          <Button
            size="sm"
            onClick={() => {
              setNewEmail('');
              setNewRoles(roles.length > 0 ? [roles[0].key] : ['TENANT_MEMBER']);
              setNewStaffId('');
              setShowAddModal(true);
            }}
            className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <UserPlus className="w-4 h-4" />
            Invite Member
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Filter Bar */}
        <Card>
          <CardContent className="p-4 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search team members by email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                options={[
                  { value: 'ALL', label: 'All Statuses' },
                  { value: 'ACTIVE', label: 'Active Only' },
                  { value: 'SUSPENDED', label: 'Suspended' },
                  { value: 'REVOKED', label: 'Revoked' },
                ]}
                className="text-xs h-9"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={loadData}
                disabled={loading}
                className="p-2 h-9 w-9 shrink-0"
                title="Refresh list"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Member Table */}
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : filteredMembers.length === 0 ? (
          <EmptyState
            title="No team members found"
            description={search ? 'No members match your current filters.' : 'Invite team members to collaborate on Bizwoke Nova.'}
            action={
              <Button
                size="sm"
                onClick={() => setShowAddModal(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
              >
                <UserPlus className="w-4 h-4" />
                Invite Member
              </Button>
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Member Email</th>
                    <th className="py-3 px-4">Assigned Roles</th>
                    <th className="py-3 px-4">Staff Profile</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Joined Date</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredMembers.map((member) => {
                    const linkedStaff = staffList.find((s) => s.id === member.staffId);
                    return (
                      <tr key={member.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4 font-medium text-slate-900">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
                              {member.email.slice(0, 1).toUpperCase()}
                            </div>
                            <span className="truncate">{member.email}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {member.roleKeys?.map((rk) => (
                              <Badge key={rk} variant="secondary" className="text-[10px]">
                                {rk}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {linkedStaff ? (
                            <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                              <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                              {linkedStaff.name}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px]">Unlinked</span>
                          )}
                        </td>
                        <td className="py-3 px-4">{getStatusBadge(member.status)}</td>
                        <td className="py-3 px-4 text-slate-500">{formatDate(member.createdAt)}</td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditModal(member)}
                            className="h-8 text-xs font-medium"
                          >
                            Edit Access
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Invite Member Dialog */}
        <Dialog
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          title="Invite New Team Member"
        >
          <form onSubmit={handleAddMember} className="space-y-4">
            <Input
              label="Member Email Address"
              type="email"
              required
              placeholder="colleague@yourcompany.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              helperText="The user will receive tenant access upon registration or next sign-in."
            />

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 block">
                Assign Roles (Select at least one)
              </label>
              <div className="space-y-2 max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-3 bg-slate-50">
                {roles.map((r) => {
                  const checked = newRoles.includes(r.key);
                  return (
                    <label
                      key={r.id}
                      className="flex items-start gap-2.5 p-2 rounded-md hover:bg-white cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewRoles([...newRoles, r.key]);
                          } else {
                            setNewRoles(newRoles.filter((k) => k !== r.key));
                          }
                        }}
                        className="mt-0.5 w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <div>
                        <p className="text-xs font-semibold text-slate-800">{r.name}</p>
                        <p className="text-[11px] text-slate-500">{r.description || `Key: ${r.key}`}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <Select
              label="Link to Staff Profile (Optional)"
              value={newStaffId}
              onChange={(e) => setNewStaffId(e.target.value)}
              options={[
                { value: '', label: 'None (Administrative / Non-booking user)' },
                ...staffList.map((s) => ({ value: s.id, label: `${s.name} (${s.title || 'Staff'})` })),
              ]}
              helperText="Links this user account to a bookable calendar staff provider."
            />

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingAdd}
                className="bg-blue-600 hover:bg-blue-700 text-white min-w-[120px]"
              >
                {savingAdd ? 'Inviting...' : 'Send Invitation'}
              </Button>
            </div>
          </form>
        </Dialog>

        {/* Edit Member Dialog */}
        <Dialog
          isOpen={!!editingMember}
          onClose={() => setEditingMember(null)}
          title={`Edit Member: ${editingMember?.email}`}
        >
          <form onSubmit={handleEditMember} className="space-y-4">
            <Select
              label="Membership Status"
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value as 'ACTIVE' | 'SUSPENDED' | 'REVOKED')}
              options={[
                { value: 'ACTIVE', label: 'Active - Full permitted access' },
                { value: 'SUSPENDED', label: 'Suspended - Temporary freeze' },
                { value: 'REVOKED', label: 'Revoked - Access blocked' },
              ]}
            />

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 block">
                Assigned Roles
              </label>
              <div className="space-y-2 max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-3 bg-slate-50">
                {roles.map((r) => {
                  const checked = editRoles.includes(r.key);
                  return (
                    <label
                      key={r.id}
                      className="flex items-start gap-2.5 p-2 rounded-md hover:bg-white cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setEditRoles([...editRoles, r.key]);
                          } else {
                            setEditRoles(editRoles.filter((k) => k !== r.key));
                          }
                        }}
                        className="mt-0.5 w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <div>
                        <p className="text-xs font-semibold text-slate-800">{r.name}</p>
                        <p className="text-[11px] text-slate-500">{r.description || `Key: ${r.key}`}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <Select
              label="Link to Staff Profile"
              value={editStaffId}
              onChange={(e) => setEditStaffId(e.target.value)}
              options={[
                { value: '', label: 'None (Administrative / Non-booking user)' },
                ...staffList.map((s) => ({ value: s.id, label: `${s.name} (${s.title || 'Staff'})` })),
              ]}
            />

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => setEditingMember(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingEdit}
                className="bg-blue-600 hover:bg-blue-700 text-white min-w-[120px]"
              >
                {savingEdit ? 'Saving...' : 'Update Member'}
              </Button>
            </div>
          </form>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
