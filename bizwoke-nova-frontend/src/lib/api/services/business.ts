import { apiClient } from '../client';
import { BusinessSettings, Tenant, PlanLimits, AvailabilityException } from '../types';

export interface BusinessData {
  tenant: Tenant;
  settings: BusinessSettings;
  limits: PlanLimits;
}

export const businessService = {
  async getSettings() {
    const res = await apiClient<BusinessData>('/business');
    return res.data;
  },

  async updateSettings(patch: Partial<BusinessSettings>) {
    const res = await apiClient<BusinessSettings>('/business', {
      method: 'PATCH',
      body: patch,
    });
    return res.data;
  },

  async updateSlug(slug: string) {
    const res = await apiClient<{ slug: string }>('/business/slug', {
      method: 'PATCH',
      body: { slug },
    });
    return res.data;
  },

  async updateWhatsAppIntegration(body: {
    phoneNumberId: string;
    displayNumber?: string;
    enabled: boolean;
    templates?: Array<{ key: string; name: string; language: string }>;
  }) {
    const res = await apiClient<BusinessSettings['integrations']>('/business/integrations/whatsapp', {
      method: 'PUT',
      body,
    });
    return res.data;
  },

  // Business-wide closures
  async getClosures() {
    const res = await apiClient<AvailabilityException[]>('/business/closures');
    return res.data;
  },

  async addClosure(closure: {
    type: 'LEAVE' | 'HOLIDAY' | 'BLOCK';
    startsAt: string;
    endsAt: string;
    reason?: string;
  }) {
    const res = await apiClient<AvailabilityException>('/business/closures', {
      method: 'POST',
      body: closure,
    });
    return res.data;
  },

  async deleteClosure(id: string) {
    const res = await apiClient<{ deleted: boolean }>(`/business/closures/${id}`, {
      method: 'DELETE',
    });
    return res.data;
  },
};
