import { ApiResponse, ApiErrorResponse } from './types';

export class ApiClientError extends Error {
  public code: string;
  public status: number;
  public details?: Array<{ path?: string; message: string }>;
  public requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Array<{ path?: string; message: string }>,
    requestId?: string
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

// In-memory token management with storage backup
let inMemoryAccessToken: string | null = null;
let inMemoryRefreshToken: string | null = null;

export const tokenStorage = {
  getAccessToken(): string | null {
    if (inMemoryAccessToken) return inMemoryAccessToken;
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('bn_access_token');
    }
    return null;
  },

  getRefreshToken(): string | null {
    if (inMemoryRefreshToken) return inMemoryRefreshToken;
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('bn_refresh_token');
    }
    return null;
  },

  setTokens(accessToken: string, refreshToken: string) {
    inMemoryAccessToken = accessToken;
    inMemoryRefreshToken = refreshToken;
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('bn_access_token', accessToken);
      sessionStorage.setItem('bn_refresh_token', refreshToken);
    }
  },

  clearTokens() {
    inMemoryAccessToken = null;
    inMemoryRefreshToken = null;
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('bn_access_token');
      sessionStorage.removeItem('bn_refresh_token');
      sessionStorage.removeItem('bn_user');
      sessionStorage.removeItem('bn_active_tenant');
    }
  },

  clear() {
    this.clearTokens();
  },
};

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000/api/v1';

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined | null>;
  token?: string;
  idempotencyKey?: string;
  skipAuth?: boolean;
}

let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function onRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = tokenStorage.getRefreshToken();
  if (!refreshToken) {
    tokenStorage.clearTokens();
    return null;
  }

  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      tokenStorage.clearTokens();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/session-expired';
      }
      return null;
    }

    const json = (await res.json()) as ApiResponse<{ accessToken: string; refreshToken: string }>;
    if (json.success && json.data.accessToken) {
      tokenStorage.setTokens(json.data.accessToken, json.data.refreshToken);
      return json.data.accessToken;
    }
    tokenStorage.clearTokens();
    return null;
  } catch (err) {
    tokenStorage.clearTokens();
    return null;
  }
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const {
    body,
    params,
    token,
    idempotencyKey,
    skipAuth = false,
    headers: customHeaders = {},
    ...customOptions
  } = options;

  let url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.append(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
  }

  const reqId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
  const headers = new Headers(customHeaders);
  headers.set('X-Request-Id', reqId);

  if (!headers.has('Content-Type') && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (idempotencyKey) {
    headers.set('Idempotency-Key', idempotencyKey);
  }

  const activeToken = token || (!skipAuth ? tokenStorage.getAccessToken() : null);
  if (activeToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${activeToken}`);
  }

  let requestBody: BodyInit | undefined;
  if (body instanceof FormData) {
    requestBody = body;
  } else if (body !== undefined) {
    requestBody = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...customOptions,
      headers,
      body: requestBody,
    });
  } catch (err) {
    throw new ApiClientError(
      0,
      'NETWORK_ERROR',
      'Unable to connect to the server. Please check your network connection or verify that the backend is running.',
      [],
      reqId
    );
  }

  // Handle Token Expiry & Automatic Refresh Rotation
  if (response.status === 401 && !skipAuth && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh')) {
    if (!isRefreshing) {
      isRefreshing = true;
      const newToken = await refreshAccessToken();
      isRefreshing = false;
      if (newToken) {
        onRefreshed(newToken);
        // Retry original request with new token
        return apiClient<T>(endpoint, {
          ...options,
          token: newToken,
        });
      }
    } else {
      // Wait for ongoing refresh
      return new Promise((resolve, reject) => {
        refreshSubscribers.push(async (newToken: string) => {
          try {
            const retryRes = await apiClient<T>(endpoint, {
              ...options,
              token: newToken,
            });
            resolve(retryRes);
          } catch (retryErr) {
            reject(retryErr);
          }
        });
      });
    }
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const json = await response.json();
    if (!response.ok || json.success === false) {
      const errPayload = json as ApiErrorResponse;
      throw new ApiClientError(
        response.status,
        errPayload.error?.code || 'UNKNOWN_ERROR',
        errPayload.error?.message || 'An unexpected error occurred',
        errPayload.error?.details,
        errPayload.requestId || reqId
      );
    }
    return json as ApiResponse<T>;
  }

  // Binary/text responses (e.g., templates or exports)
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      'HTTP_ERROR',
      `Request failed with status ${response.status}`,
      [],
      reqId
    );
  }

  return {
    success: true,
    data: (await response.text()) as unknown as T,
    requestId: reqId,
  };
}

// File Download Helper
export async function downloadFile(
  endpoint: string,
  filename: string,
  options: RequestOptions = {}
): Promise<void> {
  const token = tokenStorage.getAccessToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  const res = await fetch(url, { headers });

  if (!res.ok) {
    let errMsg = 'Failed to download file';
    try {
      const json = await res.json();
      if (json.error?.message) errMsg = json.error.message;
    } catch {}
    throw new Error(errMsg);
  }

  const blob = await res.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(downloadUrl);
}
