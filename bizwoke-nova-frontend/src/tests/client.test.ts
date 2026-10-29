import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, ApiClientError, tokenStorage } from '@/lib/api/client';

describe('Centralized apiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    tokenStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws ApiClientError when the backend returns a structured error envelope', async () => {
    const mockResponse = {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid email address format',
        details: [{ path: ['email'], message: 'Must be a valid email' }],
      },
      requestId: 'req-123',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockResponse,
    });

    await expect(apiClient('/test-endpoint')).rejects.toThrow(ApiClientError);

    try {
      await apiClient('/test-endpoint');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      const apiErr = err as ApiClientError;
      expect(apiErr.code).toBe('VALIDATION_FAILED');
      expect(apiErr.message).toBe('Invalid email address format');
      expect(apiErr.status).toBe(400);
      expect(apiErr.requestId).toBe('req-123');
    }
  });

  it('unwraps data envelope when backend returns success: true', async () => {
    const mockData = { id: 'usr-1', name: 'John Doe', email: 'john@example.com' };
    const mockEnvelope = {
      success: true,
      data: mockData,
      meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
      requestId: 'req-456',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockEnvelope,
    });

    const res = await apiClient<typeof mockData>('/users/me');
    expect(res.data).toEqual(mockData);
    expect(res.requestId).toBe('req-456');
    expect(res.meta?.total).toBe(1);
  });

  it('includes Authorization header when token exists and skipAuth is false', async () => {
    tokenStorage.setTokens('test-jwt-token-123', 'test-refresh-token-456');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, data: { ok: true } }),
    });

    await apiClient('/protected');

    const callArgs = (global.fetch as any).mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers.get('authorization')).toBe('Bearer test-jwt-token-123');
  });

  it('omits Authorization header when skipAuth is true', async () => {
    tokenStorage.setTokens('test-jwt-token-123', 'test-refresh-token-456');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, data: { ok: true } }),
    });

    await apiClient('/public/endpoint', { skipAuth: true });

    const callArgs = (global.fetch as any).mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers['Authorization']).toBeUndefined();
  });
});
