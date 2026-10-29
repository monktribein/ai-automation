import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/lib/auth/auth-context';
import { authService } from '@/lib/api/services/auth';
import { tokenStorage } from '@/lib/api/client';

vi.mock('@/lib/api/services/auth', () => ({
  authService: {
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  },
}));

function TestConsumer() {
  const { user, hasPermission, isSuperAdmin, isLoading } = useAuth();
  if (isLoading) return <div>LOADING</div>;

  return (
    <div>
      <div data-testid="auth-status">{user ? 'AUTHENTICATED' : 'ANONYMOUS'}</div>
      <div data-testid="user-email">{user?.email || 'NONE'}</div>
      <div data-testid="is-superadmin">{isSuperAdmin ? 'YES' : 'NO'}</div>
      <div data-testid="perm-check">{hasPermission('appointments:write') ? 'ALLOWED' : 'DENIED'}</div>
    </div>
  );
}

describe('AuthContext and Permission Gates', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    tokenStorage.clear();
  });

  it('initializes as unauthenticated when no stored token exists', async () => {
    await act(async () => {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );
    });

    expect(screen.getByTestId('auth-status')).toHaveTextContent('ANONYMOUS');
    expect(screen.getByTestId('user-email')).toHaveTextContent('NONE');
    expect(screen.getByTestId('perm-check')).toHaveTextContent('DENIED');
  });

  it('hydrates user session and permissions from getMe when token is present', async () => {
    tokenStorage.setTokens('mock-valid-token', 'mock-refresh-token');

    (authService.getMe as any).mockResolvedValue({
      user: {
        id: 'usr-1',
        email: 'operator@bizwoke.com',
        name: 'Operator',
        platformRole: 'USER',
      },
      memberships: [
        {
          tenantId: 'ten-1',
          roleKeys: ['TENANT_ADMIN'],
          tenantName: 'Bizwoke Demo Clinic',
          status: 'ACTIVE',
        },
      ],
      activeTenantId: 'ten-1',
    });

    await act(async () => {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );
    });

    expect(screen.getByTestId('auth-status')).toHaveTextContent('AUTHENTICATED');
    expect(screen.getByTestId('user-email')).toHaveTextContent('operator@bizwoke.com');
    expect(screen.getByTestId('perm-check')).toHaveTextContent('ALLOWED');
    expect(screen.getByTestId('is-superadmin')).toHaveTextContent('NO');
  });

  it('correctly grants platform administrative privileges for SUPER_ADMIN role', async () => {
    tokenStorage.setTokens('mock-superadmin-token', 'mock-refresh-token');

    (authService.getMe as any).mockResolvedValue({
      user: {
        id: 'usr-super',
        email: 'superadmin@bizwoke.com',
        name: 'Platform Superadmin',
        platformRole: 'SUPER_ADMIN',
      },
      memberships: [],
      activeTenantId: null,
    });

    await act(async () => {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );
    });

    expect(screen.getByTestId('auth-status')).toHaveTextContent('AUTHENTICATED');
    expect(screen.getByTestId('is-superadmin')).toHaveTextContent('YES');
  });
});
