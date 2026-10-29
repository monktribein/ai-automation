import { apiClient } from '../client';
import { Workflow, WorkflowExecution, NotificationLog, NotificationStatus } from '../types';

export const workflowsService = {
  async list(query?: { page?: number; limit?: number }) {
    const res = await apiClient<Workflow[]>('/workflows', {
      params: query as Record<string, string | number>,
    });
    return {
      items: res.data,
      meta: res.meta,
    };
  },

  async getById(id: string) {
    const res = await apiClient<Workflow>(`/workflows/${id}`);
    return res.data;
  },

  async create(body: Omit<Workflow, '_id' | 'createdAt' | 'updatedAt'>) {
    const res = await apiClient<Workflow>('/workflows', {
      method: 'POST',
      body,
    });
    return res.data;
  },

  async update(id: string, body: Partial<Workflow>) {
    const res = await apiClient<Workflow>(`/workflows/${id}`, {
      method: 'PATCH',
      body,
    });
    return res.data;
  },

  async delete(id: string) {
    const res = await apiClient<{ deleted: boolean }>(`/workflows/${id}`, {
      method: 'DELETE',
    });
    return res.data;
  },

  async getExecutions(id: string, page = 1, limit = 20) {
    const res = await apiClient<WorkflowExecution[]>(`/workflows/${id}/executions`, {
      params: { page, limit },
    });
    return {
      items: res.data,
      meta: res.meta,
    };
  },
};

export const notificationsService = {
  async list(query?: {
    page?: number;
    limit?: number;
    status?: NotificationStatus;
    channel?: 'EMAIL' | 'WHATSAPP';
    appointmentId?: string;
  }) {
    const res = await apiClient<NotificationLog[]>('/notifications', {
      params: query as Record<string, string | number>,
    });
    return {
      items: res.data,
      meta: res.meta,
    };
  },
};
