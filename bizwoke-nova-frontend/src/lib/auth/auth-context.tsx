'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { User, MembershipTenant, Permission } from '../api/types';
import { authService, LoginInput, RegisterInput } from '../api/services/auth';
import { tokenStorage } from '../api/client';

interface AuthContextType {
  user: User | null;
  activeTenant: MembershipTenant | null;
  memberships: MembershipTenant[];
  permissions: Set<string>;
  hasPermission: (p: Permission | string) => boolean;
  isSuperAdmin: boolean;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  logout: (allSessions?: boolean) => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<MembershipTenant[]>([]);
  const [activeTenant, setActiveTenant] = useState<MembershipTenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Sync active tenant and permissions
  const permissions = useMemo(() => {
    // In our backend, roleKeys on the membership identify roles
    // If the user is TENANT_ADMIN, they have all permissions
    const set = new Set<string>();
    if (!activeTenant) return set;

    if (activeTenant.roleKeys?.includes('TENANT_ADMIN')) {
      // Grant full tenant admin permissions
      set.add('*');
    }
    activeTenant.roleKeys?.forEach((r) => set.add(r));
    return set;
  }, [activeTenant]);

  const hasPermission = useCallback((p: Permission | string) => {
    if (!activeTenant) return false;
    if (activeTenant.roleKeys?.includes('TENANT_ADMIN')) return true;
    return permissions.has(p) || permissions.has('*');
  }, [activeTenant, permissions]);

  const isSuperAdmin = useMemo(() => {
    return user?.platformRole === 'SUPER_ADMIN';
  }, [user]);

  const refreshSession = useCallback(async () => {
    const token = tokenStorage.getAccessToken();
    if (!token) {
      setUser(null);
      setMemberships([]);
      setActiveTenant(null);
      setIsLoading(false);
      return;
    }

    try {
      const data = await authService.getMe();
      setUser(data.user);
      setMemberships(data.memberships);

      // Restore or pick active tenant
      const savedTenantId = typeof window !== 'undefined' ? sessionStorage.getItem('bn_active_tenant_id') : null;
      let matched = data.memberships.find((m) => m.tenantId === savedTenantId && m.status === 'ACTIVE');
      if (!matched && data.memberships.length > 0) {
        matched = data.memberships.find((m) => m.status === 'ACTIVE') || data.memberships[0];
      }

      if (matched) {
        setActiveTenant(matched);
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('bn_active_tenant_id', matched.tenantId);
        }
      } else {
        setActiveTenant(null);
      }
    } catch (err) {
      tokenStorage.clearTokens();
      setUser(null);
      setMemberships([]);
      setActiveTenant(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = async (input: LoginInput) => {
    setIsLoading(true);
    try {
      const data = await authService.login(input);
      setUser(data.user);
      setMemberships(data.memberships);

      // Determine active tenant
      let selected: MembershipTenant | undefined;
      if (data.tokens.tenantId) {
        selected = data.memberships.find((m) => m.tenantId === data.tokens.tenantId);
      }
      if (!selected && data.memberships.length > 0) {
        selected = data.memberships.find((m) => m.status === 'ACTIVE') || data.memberships[0];
      }

      if (selected) {
        setActiveTenant(selected);
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('bn_active_tenant_id', selected.tenantId);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (input: RegisterInput) => {
    setIsLoading(true);
    try {
      const data = await authService.register(input);
      setUser(data.user);
      await refreshSession();
    } finally {
      setIsLoading(false);
    }
  };

  const switchTenant = async (tenantId: string) => {
    setIsLoading(true);
    try {
      await authService.switchTenant(tenantId);
      const target = memberships.find((m) => m.tenantId === tenantId);
      if (target) {
        setActiveTenant(target);
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('bn_active_tenant_id', target.tenantId);
        }
      }
      // Re-fetch to guarantee pristine fresh state
      await refreshSession();
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async (allSessions = false) => {
    setIsLoading(true);
    try {
      await authService.logout(allSessions);
    } catch {
      // Continue cleanup on failure
    } finally {
      setUser(null);
      setMemberships([]);
      setActiveTenant(null);
      setIsLoading(false);
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        activeTenant,
        memberships,
        permissions,
        hasPermission,
        isSuperAdmin,
        isLoading,
        login,
        register,
        switchTenant,
        logout,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
