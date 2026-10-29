export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SLOT_UNAVAILABLE'
  | 'INVALID_STATE_TRANSITION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'FEATURE_DISABLED'
  | 'TENANT_INACTIVE'
  | 'INTEGRATION_UNAVAILABLE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PROVIDER_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details: unknown[] = [],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  validation: (message = 'Request validation failed', details: unknown[] = []) =>
    new AppError(422, 'VALIDATION_ERROR', message, details),
  unauthenticated: (message = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', message),
  forbidden: (message = 'You do not have permission to perform this action') =>
    new AppError(403, 'FORBIDDEN', message),
  notFound: (resource = 'Resource') => new AppError(404, 'NOT_FOUND', `${resource} not found`),
  conflict: (message: string, details: unknown[] = []) => new AppError(409, 'CONFLICT', message, details),
  slotUnavailable: (message = 'The requested time slot is not available') =>
    new AppError(409, 'SLOT_UNAVAILABLE', message),
  invalidTransition: (from: string, to: string) =>
    new AppError(409, 'INVALID_STATE_TRANSITION', `Cannot transition appointment from ${from} to ${to}`),
  idempotencyConflict: () =>
    new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different request'),
  quotaExceeded: (metric: string) =>
    new AppError(429, 'QUOTA_EXCEEDED', `Usage quota exceeded for ${metric}`),
  featureDisabled: (feature: string) =>
    new AppError(403, 'FEATURE_DISABLED', `Feature '${feature}' is not enabled for this tenant`),
  tenantInactive: () => new AppError(403, 'TENANT_INACTIVE', 'Tenant is not active'),
  integrationUnavailable: (name: string) =>
    new AppError(503, 'INTEGRATION_UNAVAILABLE', `${name} integration is not configured or unavailable`),
  provider: (message: string) => new AppError(502, 'PROVIDER_ERROR', message),
};
