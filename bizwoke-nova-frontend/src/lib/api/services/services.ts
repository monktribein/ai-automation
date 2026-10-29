import { apiClient } from '../client';
import { Service } from '../types';

export interface ListServicesQuery {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  sort?: string;
}

export const servicesService = {
  async list(query?: ListServicesQuery) {
    const res = await apiClient<Service[]>('/services', {
      params: query as Record<string, string | number>,
    });
    return {
      items: res.data,
      meta: res.meta,
    };
  },

  async getById(id: string) {
    const res = await apiClient<Service & { assignedStaffIds: string[] }>(`/services/${id}`);
    return res.data;
  },

  async create(body: Omit<Service, '_id' | 'id' | 'createdAt' | 'updatedAt' | 'status'>) {
    const res = await apiClient<Service>('/services', {
      method: 'POST',
      body,
    });
    return res.data;
  },

  async update(id: string, body: Partial<Service>) {
    const res = await apiClient<Service>(`/services/${id}`, {
      method: 'PATCH',
      body,
    });
    return res.data;
  },

  async delete(id: string) {
    const res = await apiClient<Service>(`/services/${id}`, {
      method: 'DELETE',
    });
    return res.data;
  },
};
