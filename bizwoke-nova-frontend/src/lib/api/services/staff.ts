import { apiClient } from '../client';
import { Staff, StaffAvailability, AvailabilityException } from '../types';

export interface ListStaffQuery {
  page?: number;
  limit?: number;
  serviceId?: string;
  status?: string;
}

export const staffService = {
  async list(query?: ListStaffQuery) {
    const res = await apiClient<Staff[]>('/staff', {
      params: query as Record<string, string | number>,
    });
    return {
      items: res.data,
      meta: res.meta,
    };
  },

  async getById(id: string) {
    const res = await apiClient<Staff>(`/staff/${id}`);
    return res.data;
  },

  async create(body: Partial<Staff>) {
    const res = await apiClient<Staff>('/staff', {
      method: 'POST',
      body,
    });
    return res.data;
  },

  async update(id: string, body: Partial<Staff>) {
    const res = await apiClient<Staff>(`/staff/${id}`, {
      method: 'PATCH',
      body,
    });
    return res.data;
  },

  async delete(id: string) {
    const res = await apiClient<Staff>(`/staff/${id}`, {
      method: 'DELETE',
    });
    return res.data;
  },

  // Staff Availability
  async getAvailability(staffId: string) {
    // Backend shape: { schedule: { weekly, breaks } | null, followsBusinessHours, exceptions }.
    // `schedule` is null until a custom schedule is saved (business hours apply meanwhile).
    const res = await apiClient<{
      schedule: Partial<StaffAvailability> | null;
      followsBusinessHours: boolean;
      exceptions: AvailabilityException[];
    }>(`/staff/${staffId}/availability`);
    const d = res.data;
    return {
      weekly: d?.schedule?.weekly ?? [],
      breaks: d?.schedule?.breaks ?? [],
      followsBusinessHours: d?.followsBusinessHours ?? true,
      exceptions: d?.exceptions ?? [],
    };
  },

  async setAvailability(staffId: string, availability: StaffAvailability) {
    const res = await apiClient<StaffAvailability>(`/staff/${staffId}/availability`, {
      method: 'PUT',
      body: availability,
    });
    return res.data;
  },

  async addException(
    staffId: string,
    exception: { type: 'LEAVE' | 'HOLIDAY' | 'BLOCK'; startsAt: string; endsAt: string; reason?: string }
  ) {
    const res = await apiClient<AvailabilityException>(`/staff/${staffId}/exceptions`, {
      method: 'POST',
      body: exception,
    });
    return res.data;
  },

  async deleteException(staffId: string, exceptionId: string) {
    const res = await apiClient<{ deleted: boolean }>(`/staff/${staffId}/exceptions/${exceptionId}`, {
      method: 'DELETE',
    });
    return res.data;
  },
};
