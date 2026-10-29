/**
 * Tenant-level permission catalog. Platform privileges (SUPER_ADMIN) are NOT part of this
 * catalog and can never be granted through tenant roles.
 */
export const PERMISSIONS = {
  BUSINESS_READ: 'business:read',
  BUSINESS_MANAGE: 'business:manage',
  MEMBERS_READ: 'members:read',
  MEMBERS_MANAGE: 'members:manage',
  ROLES_MANAGE: 'roles:manage',
  LOCATIONS_READ: 'locations:read',
  LOCATIONS_WRITE: 'locations:write',
  SERVICES_READ: 'services:read',
  SERVICES_WRITE: 'services:write',
  STAFF_READ: 'staff:read',
  STAFF_WRITE: 'staff:write',
  AVAILABILITY_WRITE: 'availability:write',
  CUSTOMERS_READ: 'customers:read',
  CUSTOMERS_WRITE: 'customers:write',
  CUSTOMERS_PII: 'customers:pii',
  CUSTOMERS_DELETE: 'customers:delete',
  APPOINTMENTS_READ: 'appointments:read',
  APPOINTMENTS_READ_OWN: 'appointments:read:own',
  APPOINTMENTS_WRITE: 'appointments:write',
  LEADS_READ: 'leads:read',
  LEADS_WRITE: 'leads:write',
  CONVERSATIONS_READ: 'conversations:read',
  CONVERSATIONS_WRITE: 'conversations:write',
  KNOWLEDGE_READ: 'knowledge:read',
  KNOWLEDGE_WRITE: 'knowledge:write',
  AI_USE: 'ai:use',
  AI_CONFIGURE: 'ai:configure',
  WORKFLOWS_MANAGE: 'workflows:manage',
  NOTIFICATIONS_READ: 'notifications:read',
  INTEGRATIONS_MANAGE: 'integrations:manage',
  IMPORTS_RUN: 'imports:run',
  EXPORTS_RUN: 'exports:run',
  AUDIT_READ: 'audit:read',
  USAGE_READ: 'usage:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];
export const isPermission = (p: string): p is Permission => (ALL_PERMISSIONS as string[]).includes(p);

const P = PERMISSIONS;

export const SYSTEM_ROLES: Record<string, { name: string; permissions: Permission[] }> = {
  TENANT_ADMIN: { name: 'Tenant administrator', permissions: ALL_PERMISSIONS },
  OPERATOR: {
    name: 'Operator',
    permissions: ALL_PERMISSIONS.filter(
      (p) =>
        !(
          [
            P.MEMBERS_MANAGE,
            P.ROLES_MANAGE,
            P.BUSINESS_MANAGE,
            P.AI_CONFIGURE,
            P.INTEGRATIONS_MANAGE,
            P.CUSTOMERS_DELETE,
            P.AUDIT_READ,
          ] as Permission[]
        ).includes(p),
    ),
  },
  SERVICE_PROVIDER: {
    name: 'Service provider',
    permissions: [
      P.BUSINESS_READ,
      P.LOCATIONS_READ,
      P.SERVICES_READ,
      P.STAFF_READ,
      P.AVAILABILITY_WRITE,
      P.CUSTOMERS_READ,
      P.CUSTOMERS_PII,
      P.APPOINTMENTS_READ,
      P.APPOINTMENTS_WRITE,
    ],
  },
  CUSTOMER: { name: 'Customer', permissions: [P.BUSINESS_READ, P.SERVICES_READ, P.APPOINTMENTS_READ_OWN] },
};

export const SYSTEM_ROLE_KEYS = Object.keys(SYSTEM_ROLES);
