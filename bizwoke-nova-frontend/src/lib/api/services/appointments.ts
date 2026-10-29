import { apiClient } from '../client';
import { Appointment, AppointmentStatus, Slot, Customer } from '../types';

export interface ListAppointmentsQuery {
  page?: number;
  limit?: number;
  status?: AppointmentStatus;
  staffId?: string;
  serviceId?: string;
  customerId?: string;
  from?: string;
  to?: string;
  sort?: string;
}

export interface CreateAppointmentInput {
  serviceId: string;
  staffId?: string;
  startAt: string;
  customerId?: string;
  customer?: Partial<Customer>;
  customerNotes?: string;
}

export interface GetSlotsQuery {
  serviceId: string;
  from: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  staffId?: string;
}

export const appointmentsService = {
  async list(query?: ListAppointmentsQuery) {
    const res = await apiClient<Appointment[]>('/appointments', {
      params: query as Record<string, string | number>,
    });
    return {
      items: res.data,
      meta: res.meta,
    };
  },

  async getSlots(query: GetSlotsQuery) {
    const res = await apiClient<Slot[]>('/appointments/slots', {
      params: query as unknown as Record<string, string>,
    });
    return res.data;
  },

  async getById(id: string) {
    const res = await apiClient<Appointment>(`/appointments/${id}`);
    return res.data;
  },

  async getHistory(id: string) {
    const res = await apiClient<Array<{
      _id: string;
      type: string;
      fromStatus?: string;
      toStatus: string;
      actorType: string;
      actorUserId?: string;
      data?: Record<string, unknown>;
      createdAt: string;
    }>>(`/appointments/${id}/history`);
    return res.data;
  },

  async create(body: CreateAppointmentInput, idempotencyKey?: string) {
    const res = await apiClient<Appointment>('/appointments', {
      method: 'POST',
      body,
      idempotencyKey,
    });
    return {
      appointment: res.data,
      meta: res.meta,
    };
  },

  async updateStatus(id: string, status: AppointmentStatus, reason?: string) {
    const res = await apiClient<Appointment>(`/appointments/${id}/status`, {
      method: 'PATCH',
      body: { status, reason },
    });
    return res.data;
  },

  async reschedule(id: string, body: { startAt: string; staffId?: string }) {
    const res = await apiClient<Appointment>(`/appointments/${id}/reschedule`, {
      method: 'POST',
      body,
    });
    return res.data;
  },
};
