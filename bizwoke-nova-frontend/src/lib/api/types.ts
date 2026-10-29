// API Response Envelopes
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: PaginationMeta & Record<string, unknown>;
  requestId?: string;
}

export interface ApiErrorDetail {
  path?: string;
  message: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: ApiErrorDetail[];
}

export interface ApiErrorResponse {
  success: false;
  error: ApiError;
  requestId?: string;
}

export interface PaginationMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  idempotentReplay?: boolean;
}

// User & Auth
export type PlatformRole = 'USER' | 'SUPER_ADMIN';

export interface User {
  id: string;
  _id?: string;
  email: string;
  name: string;
  phone?: string;
  platformRole?: PlatformRole;
  systemRole?: PlatformRole;
  status: 'ACTIVE' | 'DEACTIVATED';
  isEmailVerified?: boolean;
  createdAt?: string;
}

export interface MembershipTenant {
  tenantId: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  roleKeys: string[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  tenantId?: string;
}

export interface AuthSession {
  user: User;
  memberships: MembershipTenant[];
  tokens: TokenPair;
}

// Permissions
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

export interface PermissionCatalogItem {
  id?: string;
  key: string;
  name?: string;
  category?: string;
  description?: string;
}

// Tenants
export interface Tenant {
  id: string;
  _id?: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  timezone?: string;
  locale?: string;
  category?: string;
  ownerUserId?: string;
  createdAt?: string;
}

// Business Settings
export interface OperatingHour {
  dayOfWeek: number; // 1 = Monday, 7 = Sunday
  open: string;      // HH:mm
  close: string;     // HH:mm or "24:00"
}

export interface BookingPolicy {
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  slotIntervalMinutes: 5 | 10 | 15 | 20 | 30 | 60;
  allowGuestBooking: boolean;
  requireConfirmation: boolean;
  cancellationCutoffMinutes: number;
  rescheduleCutoffMinutes: number;
}

export interface BusinessProfile {
  displayName?: string;
  description?: string;
  category?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
}

export interface BusinessBranding {
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
}

export interface AiSettings {
  enabled: boolean;
  maxTurns: number;
  instructions: string;
  /** Optional model override; omit to use the server default (AI_MODEL). */
  model?: string;
  handoffMessage: string;
}

export type MessageTextKey =
  | 'appointment_confirmation'
  | 'appointment_reminder'
  | 'appointment_cancelled'
  | 'appointment_rescheduled';

export type WhatsAppAssistantMode = 'menu' | 'ai' | 'off';

export interface BusinessSettings {
  _id?: string;
  tenantId?: string;
  profile: BusinessProfile;
  branding: BusinessBranding;
  timezone: string;
  locale: string;
  currency: string;
  operatingHours: OperatingHour[];
  bookingPolicy: BookingPolicy;
  ai: AiSettings;
  notifications?: {
    reminderLeadMinutes?: number;
    texts?: Partial<Record<MessageTextKey, string>>;
  };
  whatsappAssistant?: { mode?: WhatsAppAssistantMode; welcomeText?: string };
  features?: {
    publicBooking?: boolean;
    whatsapp?: boolean;
    aiAssistant?: boolean;
    excel?: boolean;
  };
  integrations?: {
    whatsapp?: {
      phoneNumberId?: string;
      displayNumber?: string;
      enabled?: boolean;
      templates?: Array<{ key: string; name: string; language: string }>;
    };
  };
}

// Service
export interface Service {
  id: string;
  _id?: string;
  name: string;
  description?: string;
  durationMinutes: number;
  bufferMinutes?: number;
  price?: number;
  priceInr?: number;
  currency?: string;
  category?: string;
  status: 'ACTIVE' | 'ARCHIVED';
  isActive?: boolean;
  isPublic?: boolean;
  locationIds?: string[];
  publiclyBookable: boolean;
  assignedStaffIds?: string[];
  metadata?: Record<string, string | number | boolean>;
  createdAt?: string;
  updatedAt?: string;
}

// Staff & Availability
export interface Staff {
  id: string;
  _id?: string;
  name: string;
  email?: string;
  phone?: string;
  title?: string;
  bio?: string;
  locationId?: string;
  capacity: number;
  publiclyVisible: boolean;
  serviceIds?: string[];
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  createdAt?: string;
  updatedAt?: string;
}

export type StaffMember = Staff;

export interface TimeRange {
  dayOfWeek: number;
  start: string; // HH:mm
  end: string;   // HH:mm
}

export interface StaffAvailability {
  weekly: TimeRange[];
  breaks: TimeRange[];
}

export interface AvailabilityException {
  _id: string;
  staffId?: string;
  type: 'LEAVE' | 'HOLIDAY' | 'BLOCK';
  startsAt: string;
  endsAt: string;
  reason?: string;
  createdAt?: string;
}

// Appointments
export type AppointmentStatus =
  | 'REQUESTED'
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type AppointmentSource = 'STAFF' | 'PUBLIC' | 'AI' | 'WHATSAPP' | 'IMPORT';

export interface Appointment {
  id: string;
  _id?: string;
  reference: string;
  customerId: string;
  serviceId: string;
  staffId: string;
  locationId?: string;
  startAt: string;
  endAt: string;
  blockEndAt: string;
  timezone: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  seat: number;
  customerNotes?: string;
  cancellation?: {
    reason?: string;
    at: string;
    by: string;
  };
  rescheduledFrom?: Array<{ startAt: string; endAt: string; staffId: string }>;
  customer?: Customer;
  service?: Service;
  staff?: Staff;
  createdAt?: string;
  updatedAt?: string;
}

export interface Slot {
  startAt: string;
  endAt: string;
  staffId: string;
  staffName?: string;
}

// Customers & Leads
export interface CustomerConsent {
  email?: boolean;
  whatsapp?: boolean;
  sms?: boolean;
  marketing?: boolean;
}

export interface Customer {
  _id: string;
  id?: string;
  name: string;
  email?: string;
  phone?: string;
  preferredLanguage?: string;
  consent?: CustomerConsent;
  tags?: string[];
  notes?: string;
  status: 'ACTIVE' | 'ANONYMIZED';
  createdAt?: string;
  updatedAt?: string;
}

export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED' | 'LOST';

export interface Lead {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  message?: string;
  interest?: string;
  source: 'PUBLIC' | 'STAFF' | 'AI' | 'WHATSAPP';
  sourceDetail?: string;
  status: LeadStatus;
  assignedMembershipId?: string;
  convertedCustomerId?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Conversations & AI
export type ConversationStatus = 'OPEN' | 'HANDOFF' | 'CLOSED';
export type ConversationChannel = 'API' | 'WHATSAPP';

export interface ConversationMessage {
  _id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'agent' | 'system';
  text: string;
  channel: ConversationChannel;
  createdAt: string;
}

export interface ConversationSession {
  _id: string;
  customerId?: string;
  contactName?: string;
  contactPhone?: string;
  channel: ConversationChannel;
  status: ConversationStatus;
  handoff?: {
    reason: string;
    at: string;
    assignedMembershipId?: string;
  };
  lastMessageAt?: string;
  createdAt: string;
}

export interface AiToolExecution {
  _id: string;
  sessionId: string;
  toolName: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
}

// Knowledge Base
export type KnowledgeStatus = 'DRAFT' | 'APPROVED' | 'ARCHIVED';

export interface KnowledgeArticle {
  _id: string;
  title: string;
  content: string;
  tags: string[];
  status: KnowledgeStatus;
  approvedBy?: string;
  approvedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Workflows & Automations
export type WorkflowTrigger =
  | 'appointment.created'
  | 'appointment.status_changed'
  | 'appointment.rescheduled'
  | 'lead.created';

export interface WorkflowAction {
  type: 'send_notification';
  channel: 'EMAIL' | 'WHATSAPP';
  recipient: 'customer' | 'fixed';
  fixedTo?: string;
  subject?: string;
  text: string;
  offsetMinutes: number;
  relativeTo: 'event' | 'appointment_start';
}

export interface Workflow {
  _id: string;
  name: string;
  trigger: WorkflowTrigger;
  conditions?: {
    toStatus?: AppointmentStatus;
  };
  actions: WorkflowAction[];
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkflowExecution {
  _id: string;
  workflowId: string;
  trigger: string;
  status: 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
  actionsCompleted?: number;
  error?: string;
  createdAt: string;
}

// Notifications
export type NotificationStatus =
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED';

export interface NotificationLog {
  _id: string;
  channel: 'EMAIL' | 'WHATSAPP';
  to: string;
  templateKey?: string;
  status: NotificationStatus;
  appointmentId?: string;
  customerId?: string;
  error?: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  createdAt: string;
}

// Import & Export
export type ExcelResource = 'customers' | 'leads' | 'services' | 'staff' | 'appointments';

export interface ImportJob {
  _id: string;
  id?: string;
  resource: ExcelResource;
  filename?: string;
  status: 'PENDING' | 'VALIDATING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  duplicateStrategy: 'skip' | 'update' | 'fail';
  totalRows?: number;
  processedRows?: number;
  successCount?: number;
  errorCount?: number;
  rowErrors?: Array<{ row: number; column?: string; message: string }>;
  createdAt: string;
  completedAt?: string;
}

export interface ExportJob {
  _id: string;
  id?: string;
  resource: ExcelResource;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  columns?: string[];
  filename?: string;
  downloadPath?: string | null;
  expiresAt?: string;
  createdAt: string;
}

// Team & Roles
export interface TenantMember {
  id: string;
  _id?: string;
  tenantId?: string;
  userId?: string;
  email: string;
  roleKeys: string[];
  staffId?: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  invitedAt?: string;
  joinedAt?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface TenantRole {
  id: string;
  _id?: string;
  key: string;
  name: string;
  description?: string;
  permissions: any[];
  isSystem?: boolean;
  createdAt?: string;
}

// Subscriptions & Usage
export interface PlanLimits {
  appointmentsPerMonth?: number;
  maxAppointmentsPerMonth?: number;
  aiMessagesPerMonth?: number;
  aiTokensPerMonth?: number;
  maxAiTokensPerMonth?: number;
  whatsappMessagesPerMonth?: number;
  maxWhatsAppMessages?: number;
  exportsPerMonth?: number;
  importsPerMonth?: number;
  staff?: number;
  maxStaff?: number;
  services?: number;
  maxServices?: number;
}

export interface SubscriptionPlan {
  id: string;
  _id?: string;
  code?: string;
  key?: string;
  name: string;
  description?: string;
  features: string[];
  limits: PlanLimits;
  isDefault?: boolean;
  active?: boolean;
  price?: number;
  priceMonthlyInr?: number;
  currency?: string;
}

export interface TenantSubscription {
  _id?: string;
  id?: string;
  tenantId: string;
  planId: string;
  plan?: SubscriptionPlan;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'CANCELED' | 'TRIALING';
  limitOverrides?: PlanLimits;
  startedAt?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
}

export interface UsageSummary {
  tenantId?: string;
  period: string; // YYYY-MM
  plan?: string | null;
  limits?: PlanLimits;
  effectiveLimits?: PlanLimits;
  used?: Record<string, number>;
  counters?: {
    appointmentsCount?: number;
    leadsCount?: number;
    staffCount?: number;
    servicesCount?: number;
    whatsappOutboundCount?: number;
    aiTokensUsed?: number;
    storageBytesUsed?: number;
  };
}

// Audit Logs
export interface AuditLog {
  _id?: string;
  id?: string;
  tenantId?: string;
  actorType?: 'user' | 'public' | 'system';
  actorUserId?: string;
  actorEmail?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  outcome?: 'SUCCESS' | 'FAILURE';
  metadata?: Record<string, unknown>;
  diff?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}
