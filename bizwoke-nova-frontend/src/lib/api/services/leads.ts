import { apiClient } from '../client';
import { Lead, LeadStatus } from '../types';

export interface ListLeadsQuery {
  page?: number;
  limit?: number;
  status?: LeadStatus;
  source?: string;
  search?: string;
  assignedMembershipId?: string;
}

export const leadsService = {
  async list(query?: ListLeadsQuery) {
    const res = await apiClient<Lead[]>('/leads', {
      params: query as Record<string, string | number>,
    });
    return {
      items: res.data,
      meta: res.meta,
    };
  },

  async getById(id: string) {
    const res = await apiClient<Lead>(`/leads/${id}`);
    return res.data;
  },

  async create(body: { name: string; email?: string; phone?: string; message?: string; interest?: string; sourceDetail?: string }) {
    const res = await apiClient<Lead>('/leads', {
      method: 'POST',
      body,
    });
    return res.data;
  },

  async update(id: string, body: { status?: LeadStatus; assignedMembershipId?: string | null; interest?: string }) {
    const res = await apiClient<Lead>(`/leads/${id}`, {
      method: 'PATCH',
      body,
    });
    return res.data;
  },
};
