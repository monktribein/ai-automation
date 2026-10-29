import { EventEmitter } from 'node:events';
import { logger } from '../logging/logger';

export interface DomainEvents {
  'appointment.created': { tenantId: string; appointmentId: string; status: string };
  'appointment.status_changed': { tenantId: string; appointmentId: string; from: string; to: string };
  'appointment.rescheduled': { tenantId: string; appointmentId: string };
  'lead.created': { tenantId: string; leadId: string };
  'conversation.handoff': { tenantId: string; sessionId: string; reason: string };
}

type Name = keyof DomainEvents;
type Handler<K extends Name> = (payload: DomainEvents[K]) => Promise<void> | void;

const emitter = new EventEmitter();
emitter.setMaxListeners(50);
const inFlight = new Set<Promise<void>>();

/**
 * In-process domain events, published only AFTER the originating write committed.
 * Handlers must enqueue durable work; failures are logged and never affect the caller.
 */
export const events = {
  on<K extends Name>(name: K, handler: Handler<K>) {
    emitter.on(name, (payload: DomainEvents[K]) => {
      const p = Promise.resolve()
        .then(() => handler(payload))
        .catch((err) =>
          logger.error({ err, event: name, tenantId: payload.tenantId }, 'Domain event handler failed'),
        )
        .finally(() => inFlight.delete(p));
      inFlight.add(p);
    });
  },
  emit<K extends Name>(name: K, payload: DomainEvents[K]) {
    emitter.emit(name, payload);
  },
  /** Resolves once all currently running handlers finished (graceful shutdown, tests). */
  async settle() {
    while (inFlight.size > 0) await Promise.all([...inFlight]);
  },
  pendingCount() {
    return inFlight.size;
  },
  removeAll() {
    emitter.removeAllListeners();
  },
};
