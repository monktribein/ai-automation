import { apiClient } from '../client';
import { Service, Staff, Slot, Appointment } from '../types';

export interface PublicBusinessInfo {
  slug: string;
  profile: {
    displayName?: string;
    description?: string;
    category?: string;
    email?: string;
    phone?: string;
    website?: string;
    address?: string;
  };
  branding: {
    logoUrl?: string;
    primaryColor?: string;
    accentColor?: string;
  };
  timezone: string;
  locale: string;
  currency: string;
  operatingHours: Array<{ dayOfWeek: number; open: string; close: string }>;
  booking: {
    enabled: boolean;
    allowGuestBooking: boolean;
    minNoticeMinutes: number;
    maxAdvanceDays: number;
    cancellationCutoffMinutes: number;
  };
}

export interface PublicBookingInput {
  serviceId: string;
  staffId?: string;
  startAt: string;
  customer: {
    name: string;
    email?: string;
    phone?: string;
    consent?: { email?: boolean; whatsapp?: boolean; marketing?: boolean };
  };
  customerNotes?: string;
}

export const publicBookingService = {
  async getBusinessInfo(slug: string) {
    const res = await apiClient<PublicBusinessInfo>(`/public/${slug}`, { skipAuth: true });
    return res.data;
  },

  async getServices(slug: string) {
    const res = await apiClient<Service[]>(`/public/${slug}/services`, { skipAuth: true });
    return res.data;
  },

  async getStaff(slug: string, serviceId?: string) {
    const res = await apiClient<Array<Pick<Staff, '_id' | 'name' | 'title' | 'bio'>>>(`/public/${slug}/staff`, {
      params: serviceId ? { serviceId } : undefined,
      skipAuth: true,
    });
    return res.data;
  },

  async getSlots(slug: string, query: { serviceId: string; from: string; to?: string; staffId?: string }) {
    const res = await apiClient<Slot[]>(`/public/${slug}/slots`, {
      params: query as unknown as Record<string, string>,
      skipAuth: true,
    });
    return res.data;
  },

  async bookAppointment(slug: string, body: PublicBookingInput, idempotencyKey?: string) {
    const res = await apiClient<{ appointment: Partial<Appointment>; manageToken: string }>(
      `/public/${slug}/appointments`,
      {
        method: 'POST',
        body,
        idempotencyKey,
        skipAuth: true,
      }
    );
    return res.data;
  },

  async requestAccess(slug: string, body: { reference: string; email?: string; phone?: string }) {
    const res = await apiClient<{ message: string }>(`/public/${slug}/appointment-access`, {
      method: 'POST',
      body,
      skipAuth: true,
    });
    return res.data;
  },

  async getAppointment(slug: string, appointmentId: string, manageToken: string) {
    const res = await apiClient<Partial<Appointment>>(`/public/${slug}/appointments/${appointmentId}`, {
      headers: { 'X-Appointment-Token': manageToken },
      skipAuth: true,
    });
    return res.data;
  },

  async modifyAppointment(
    slug: string,
    appointmentId: string,
    manageToken: string,
    body: { action: 'cancel'; reason?: string } | { action: 'reschedule'; startAt: string; staffId?: string }
  ) {
    const res = await apiClient<Partial<Appointment>>(`/public/${slug}/appointments/${appointmentId}`, {
      method: 'PATCH',
      headers: { 'X-Appointment-Token': manageToken },
      body,
      skipAuth: true,
    });
    return res.data;
  },

  async submitEnquiry(slug: string, body: { name: string; email?: string; phone?: string; message?: string; interest?: string }) {
    const res = await apiClient<{ received: boolean; id: string }>(`/public/${slug}/enquiries`, {
      method: 'POST',
      body,
      skipAuth: true,
    });
    return res.data;
  },
};
