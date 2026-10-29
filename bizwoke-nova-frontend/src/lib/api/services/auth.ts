import { apiClient, tokenStorage } from '../client';
import { AuthSession, TokenPair, User, MembershipTenant } from '../types';

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  phone?: string;
  business?: {
    name: string;
    slug: string;
    timezone?: string;
    locale?: string;
    category?: string;
  };
}

export interface LoginInput {
  email: string;
  password: string;
  tenantSlug?: string;
}

export const authService = {
  async register(input: RegisterInput) {
    const res = await apiClient<{ user: User; tokens: TokenPair }>('/auth/register', {
      method: 'POST',
      body: input,
      skipAuth: true,
    });
    if (res.data.tokens) {
      tokenStorage.setTokens(res.data.tokens.accessToken, res.data.tokens.refreshToken);
    }
    return res.data;
  },

  async login(input: LoginInput) {
    const res = await apiClient<AuthSession>('/auth/login', {
      method: 'POST',
      body: input,
      skipAuth: true,
    });
    if (res.data.tokens) {
      tokenStorage.setTokens(res.data.tokens.accessToken, res.data.tokens.refreshToken);
    }
    return res.data;
  },

  async getMe() {
    const res = await apiClient<{ user: User; memberships: MembershipTenant[] }>('/auth/me');
    return res.data;
  },

  async switchTenant(tenantId: string) {
    const res = await apiClient<TokenPair>('/auth/switch-tenant', {
      method: 'POST',
      body: { tenantId },
    });
    if (res.data.accessToken) {
      tokenStorage.setTokens(res.data.accessToken, res.data.refreshToken);
    }
    return res.data;
  },

  async forgotPassword(email: string) {
    return apiClient<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: { email },
      skipAuth: true,
    });
  },

  async resetPassword(token: string, newPassword: string) {
    return apiClient<{ reset: boolean }>('/auth/reset-password', {
      method: 'POST',
      body: { token, newPassword },
      skipAuth: true,
    });
  },

  async logout(allSessions = false) {
    try {
      await apiClient<{ loggedOut: boolean }>('/auth/logout', {
        method: 'POST',
        body: { allSessions },
      });
    } finally {
      tokenStorage.clearTokens();
    }
  },
};
