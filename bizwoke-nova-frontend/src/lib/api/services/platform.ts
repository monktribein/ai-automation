import { apiClient } from '../client';
import { Tenant, User, SubscriptionPlan, TenantSubscription } from '../types';

export const platformService = {
  async listTenants(query?: { page?: number; limit?: number; status?: string; search?: string }) {
    const res = await apiClient<Tenant[]>('/tenants', {
      params: query as Record<string, string | number>,
    });
    return {
      items: res.data,
      meta: res.meta,
    };
  },

  async getTenant(id: string) {
    const res = await apiClient<Tenant>(`/tenants/${id}`);
    return res.data;
  },

  async createTenant(body: { name: string; slug: string; timezone?: string; locale?: string; category?: string; ownerUserId?: string }) {
    const res = await apiClient<Tenant>('/tenants', {
      method: 'POST',
      body,
    });
    return res.data;
  },

  async updateTenant(id: string, body: Partial<Tenant>) {
    const res = await apiClient<Tenant>(`/tenants/${id}`, {
      method: 'PATCH',
      body,
    });
    return res.data;
  },

  async updateTenantStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED', reason?: string) {
    const res = await apiClient<Tenant>(`/tenants/${id}/status`, {
      method: 'PATCH',
      body: { status, reason },
    });
    return res.data;
  },

  async listUsers(query?: { page?: number; limit?: number; search?: string; status?: string }) {
    const res = await apiClient<User[]>('/users', {
      params: query as Record<string, string | number>,
    });
    return {
      items: res.data,
      meta: res.meta,
    };
  },

  async updateUserStatus(id: string, status: 'ACTIVE' | 'DEACTIVATED', reason?: string) {
    const res = await apiClient<User>(`/users/${id}/status`, {
      method: 'PATCH',
      body: { status, reason },
    });
    return res.data;
  },

  async createPlan(body: Partial<SubscriptionPlan>) {
    const res = await apiClient<SubscriptionPlan>('/subscriptions/plans', {
      method: 'POST',
      body,
    });
    return res.data;
  },

  async updatePlan(id: string, body: Partial<SubscriptionPlan>) {
    const res = await apiClient<SubscriptionPlan>(`/subscriptions/plans/${id}`, {
      method: 'PATCH',
      body,
    });
    return res.data;
  },

  async assignSubscription(tenantId: string, body: { planId: string; status?: string; limitOverrides?: Record<string, number> }) {
    const res = await apiClient<TenantSubscription>(`/subscriptions/tenants/${tenantId}`, {
      method: 'PUT',
      body,
    });
    return res.data;
  },
};
