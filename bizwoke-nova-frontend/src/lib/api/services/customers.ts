import { apiClient } from '../client';
import { Customer, Appointment } from '../types';

export interface ListCustomersQuery {
  page?: number;
  limit?: number;
  search?: string;
  tag?: string;
  sort?: string;
}

export const customersService = {
  async list(query?: ListCustomersQuery) {
    const res = await apiClient<Customer[]>('/customers', {
      params: query as Record<string, string | number>,
    });
    return {
      items: res.data,
      meta: res.meta,
    };
  },

  async getById(id: string) {
    const res = await apiClient<Customer>(`/customers/${id}`);
    return res.data;
  },

  async create(body: Partial<Customer>) {
    const res = await apiClient<Customer>('/customers', {
      method: 'POST',
      body,
    });
    return res.data;
  },

  async update(id: string, body: Partial<Customer>) {
    const res = await apiClient<Customer>(`/customers/${id}`, {
      method: 'PATCH',
      body,
    });
    return res.data;
  },

  async delete(id: string) {
    const res = await apiClient<{ success: boolean }>(`/customers/${id}`, {
      method: 'DELETE',
    });
    return res.data;
  },

  async getAppointments(id: string, page = 1, limit = 20) {
    const res = await apiClient<Appointment[]>(`/customers/${id}/appointments`, {
      params: { page, limit },
    });
    return {
      items: res.data,
      meta: res.meta,
    };
  },
};
