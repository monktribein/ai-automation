import type { AuthContext, TenantContext } from './context';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
      tenant?: TenantContext;
      rawBody?: Buffer;
    }
  }
}

export {};
