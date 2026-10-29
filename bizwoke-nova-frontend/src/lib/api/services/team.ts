import { apiClient } from '../client';
import { TenantMember, TenantRole, Permission, PermissionCatalogItem, AuditLog, SubscriptionPlan, TenantSubscription, UsageSummary } from '../types';

export const teamService = {
  async listMembers(page = 1, limit = 50) {
    const res = await apiClient<TenantMember[]>('/members', {
      params: { page, limit },
    });
    return {
      items: res.data,
      meta: res.meta,
    };
  },

  async addMember(body: { email: string; roleKeys: string[]; staffId?: string }) {
    const res = await apiClient<TenantMember>('/members', {
      method: 'POST',
      body,
    });
    return res.data;
  },

  async updateMember(id: string, body: { roleKeys?: string[]; status?: 'ACTIVE' | 'SUSPENDED' | 'REVOKED'; staffId?: string | null }) {
    const res = await apiClient<TenantMember>(`/members/${id}`, {
      method: 'PATCH',
      body,
    });
    return res.data;
  },

  async listRoles() {
    const res = await apiClient<TenantRole[]>('/roles');
    return res.data;
  },

  async getPermissionCatalog() {
    const res = await apiClient<PermissionCatalogItem[]>('/roles/permissions');
    return res.data;
  },

  async createRole(body: { key: string; name: string; description?: string; permissions: string[] }) {
    const res = await apiClient<TenantRole>('/roles', {
      method: 'POST',
      body,
    });
    return res.data;
  },

  async updateRole(id: string, body: Partial<TenantRole>) {
    const res = await apiClient<TenantRole>(`/roles/${id}`, {
      method: 'PATCH',
      body,
    });
    return res.data;
  },

  async deleteRole(id: string) {
    const res = await apiClient<{ success: boolean }>(`/roles/${id}`, {
      method: 'DELETE',
    });
    return res.data;
  },
};

export const auditLogsService = {
  async list(query?: {
    page?: number;
    limit?: number;
    action?: string;
    resourceType?: string;
    actorUserId?: string;
    from?: string;
    to?: string;
  }) {
    const res = await apiClient<AuditLog[]>('/audit-logs', {
      params: query as Record<string, string | number>,
    });
    return {
      items: res.data,
      meta: res.meta,
    };
  },
};

export const subscriptionsService = {
  async listPlans() {
    const res = await apiClient<SubscriptionPlan[]>('/subscriptions/plans');
    return res.data;
  },

  async getCurrentSubscription() {
    const res = await apiClient<{ subscription: TenantSubscription | null; effectiveLimits: Record<string, number> }>(
      '/subscriptions/current'
    );
    return res.data;
  },

  async getUsage(period?: string) {
    const res = await apiClient<UsageSummary>('/usage', {
      params: period ? { period } : undefined,
    });
    return res.data;
  },
};
