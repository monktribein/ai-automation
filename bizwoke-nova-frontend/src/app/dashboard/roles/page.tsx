'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { teamService } from '@/lib/api/services/team';
import { TenantRole, PermissionCatalogItem } from '@/lib/api/types';
import {
  Shield,
  Plus,
  ArrowLeft,
  RefreshCw,
  Lock,
  Edit2,
  Trash2,
  CheckSquare,
  Square,
  Search,
} from 'lucide-react';

export default function RolesAndPermissionsPage() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<TenantRole[]>([]);
  const [permissions, setPermissions] = useState<PermissionCatalogItem[]>([]);
  const [search, setSearch] = useState('');

  // Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [savingCreate, setSavingCreate] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);

  // Edit Modal State
  const [editingRole, setEditingRole] = useState<TenantRole | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPerms, setEditPerms] = useState<string[]>([]);

  // Delete State
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [rolesData, permsData] = await Promise.all([
        teamService.listRoles(),
        teamService.getPermissionCatalog().catch(() => []),
      ]);
      setRoles(rolesData || []);
      setPermissions(permsData || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load roles and permissions';
      addToast('error', msg);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Group permissions by category
  const groupedPerms = permissions.reduce<Record<string, PermissionCatalogItem[]>>((acc, p) => {
    const cat = p.category || 'General';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const formattedKey = newKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!formattedKey) {
      addToast('error', 'Role key is required');
      return;
    }
    if (!newName.trim()) {
      addToast('error', 'Role display name is required');
      return;
    }

    try {
      setSavingCreate(true);
      await teamService.createRole({
        key: formattedKey,
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        permissions: selectedPerms,
      });
      addToast('success', 'Custom role created successfully');
      setShowCreateModal(false);
      setNewKey('');
      setNewName('');
      setNewDesc('');
      setSelectedPerms([]);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create role';
      addToast('error', msg);
    } finally {
      setSavingCreate(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRole) return;

    try {
      setSavingEdit(true);
      await teamService.updateRole(editingRole.id, {
        name: editName.trim(),
        description: editDesc.trim(),
        permissions: editPerms,
      });
      addToast('success', 'Role updated successfully');
      setEditingRole(null);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update role';
      addToast('error', msg);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (role: TenantRole) => {
    if (role.isSystem) {
      addToast('error', 'System roles cannot be deleted');
      return;
    }
    if (!confirm(`Are you sure you want to delete the role "${role.name}"?`)) return;

    try {
      setDeletingId(role.id);
      await teamService.deleteRole(role.id);
      addToast('success', 'Role deleted successfully');
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete role';
      addToast('error', msg);
    } finally {
      setDeletingId(null);
    }
  };

  const openEditModal = (role: TenantRole) => {
    setEditingRole(role);
    setEditName(role.name);
    setEditDesc(role.description || '');
    setEditPerms(role.permissions || []);
  };

  const filteredRoles = roles.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.key.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <DashboardLayout
      title="Roles & Permissions"
      description="Define granular access control privileges for team members across operations, AI tools, and settings"
      requiredPermission="members:read"
      actions={
        <div className="flex items-center gap-2.5">
          <Link href="/dashboard/team">
            <Button variant="outline" size="sm" className="gap-2">
              <ArrowLeft className="w-3.5 h-3.5" />
              Team Members
            </Button>
          </Link>
          <Button
            size="sm"
            onClick={() => {
              setNewKey('');
              setNewName('');
              setNewDesc('');
              setSelectedPerms([]);
              setShowCreateModal(true);
            }}
            className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="w-4 h-4" />
            Create Role
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Search Bar */}
        <Card>
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search roles by name or key..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadData}
              disabled={loading}
              className="gap-2 text-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </CardContent>
        </Card>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Skeleton className="h-44 w-full rounded-xl" />
            <Skeleton className="h-44 w-full rounded-xl" />
            <Skeleton className="h-44 w-full rounded-xl" />
          </div>
        ) : filteredRoles.length === 0 ? (
          <EmptyState
            title="No roles found"
            description="Create custom roles to configure specific privileges for team members."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRoles.map((role) => (
              <Card key={role.id} className="flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-sm font-semibold">{role.name}</CardTitle>
                        {role.isSystem && (
                          <Badge variant="outline" className="text-[10px] gap-1 py-0 text-slate-500">
                            <Lock className="w-2.5 h-2.5" />
                            System
                          </Badge>
                        )}
                      </div>
                      <span className="text-[11px] font-mono text-slate-400">{role.key}</span>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">
                      {role.permissions?.length || 0} Perms
                    </Badge>
                  </div>
                  <CardDescription className="text-xs line-clamp-2 mt-1">
                    {role.description || 'Custom organizational role for staff members.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-2">
                    <div className="text-[11px] text-slate-500 truncate max-w-[160px]">
                      {role.permissions?.slice(0, 3).join(', ')}
                      {(role.permissions?.length || 0) > 3 ? '...' : ''}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditModal(role)}
                        className="h-8 px-2 text-xs text-slate-600 hover:text-blue-600 gap-1"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        Edit
                      </Button>
                      {!role.isSystem && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(role)}
                          disabled={deletingId === role.id}
                          className="h-8 px-2 text-xs text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Create Role Modal */}
        <Dialog
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          title="Create New Role"
        >
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label="Role Key (Uppercase ID)"
                placeholder="e.g. CLINIC_MANAGER"
                required
                value={newKey}
                onChange={(e) => setNewKey(e.target.value.toUpperCase())}
                helperText="Permanent identifier in permissions"
              />
              <Input
                label="Display Name"
                placeholder="e.g. Clinic Manager"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>

            <Input
              label="Description (Optional)"
              placeholder="e.g. Can manage staff, appointments, and view financial reports"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 block">
                Assign Granular Permissions ({selectedPerms.length} selected)
              </label>
              <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-4">
                {Object.entries(groupedPerms).map(([category, perms]) => (
                  <div key={category} className="space-y-1.5">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{category}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                      {perms.map((p) => {
                        const checked = selectedPerms.includes(p.key);
                        return (
                          <label
                            key={p.id || p.key}
                            className="flex items-start gap-2 p-1.5 rounded-md hover:bg-white text-xs cursor-pointer border border-transparent hover:border-slate-200"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedPerms([...selectedPerms, p.key]);
                                } else {
                                  setSelectedPerms(selectedPerms.filter((k) => k !== p.key));
                                }
                              }}
                              className="mt-0.5 w-3.5 h-3.5 text-blue-600 rounded"
                            />
                            <div>
                              <p className="font-semibold text-slate-800 text-[11px]">{p.name || p.key}</p>
                              <p className="text-[10px] text-slate-400 font-mono">{p.key}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingCreate}
                className="bg-blue-600 hover:bg-blue-700 text-white min-w-[120px]"
              >
                {savingCreate ? 'Creating...' : 'Create Role'}
              </Button>
            </div>
          </form>
        </Dialog>

        {/* Edit Role Modal */}
        <Dialog
          isOpen={!!editingRole}
          onClose={() => setEditingRole(null)}
          title={`Edit Role: ${editingRole?.name}`}
        >
          <form onSubmit={handleEdit} className="space-y-4">
            <Input
              label="Display Name"
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />

            <Input
              label="Description"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
            />

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 block">
                Assigned Permissions ({editPerms.length} selected)
              </label>
              <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-4">
                {Object.entries(groupedPerms).map(([category, perms]) => (
                  <div key={category} className="space-y-1.5">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{category}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                      {perms.map((p) => {
                        const checked = editPerms.includes(p.key);
                        return (
                          <label
                            key={p.id || p.key}
                            className="flex items-start gap-2 p-1.5 rounded-md hover:bg-white text-xs cursor-pointer border border-transparent hover:border-slate-200"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setEditPerms([...editPerms, p.key]);
                                } else {
                                  setEditPerms(editPerms.filter((k) => k !== p.key));
                                }
                              }}
                              className="mt-0.5 w-3.5 h-3.5 text-blue-600 rounded"
                            />
                            <div>
                              <p className="font-semibold text-slate-800 text-[11px]">{p.name || p.key}</p>
                              <p className="text-[10px] text-slate-400 font-mono">{p.key}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => setEditingRole(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingEdit}
                className="bg-blue-600 hover:bg-blue-700 text-white min-w-[120px]"
              >
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
