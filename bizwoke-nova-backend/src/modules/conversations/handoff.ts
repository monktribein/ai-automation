import { Types } from 'mongoose';
import { events } from '../../common/utils/events';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { MembershipModel } from '../memberships/membership.model';
import { UserModel } from '../users/user.model';
import { RoleModel } from '../roles/role.model';
import { PERMISSIONS } from '../permissions/permissions';
import { queueNotification } from '../notifications/notification.service';
import { ConversationSessionModel, type ConversationSessionDoc } from './conversation.models';

export async function requestHandoff(tenantId: Types.ObjectId, sessionId: Types.ObjectId, reason: string) {
  const updated = await new TenantRepository<ConversationSessionDoc>(
    ConversationSessionModel,
    tenantId,
  ).findOneAndUpdate(
    { _id: sessionId, status: 'OPEN' },
    { $set: { status: 'HANDOFF', handoff: { reason: reason.slice(0, 300), at: new Date() } } },
  );
  if (updated)
    events.emit('conversation.handoff', {
      tenantId: tenantId.toString(),
      sessionId: sessionId.toString(),
      reason,
    });
  return updated;
}

/** Alerts every member of the tenant who can handle conversations (email channel). */
export function registerHandoffHandlers() {
  events.on('conversation.handoff', async ({ tenantId, sessionId, reason }) => {
    const tid = new Types.ObjectId(tenantId);
    const roles = await new TenantRepository(RoleModel, tid).find(
      { permissions: PERMISSIONS.CONVERSATIONS_WRITE },
      { projection: { key: 1 } },
    );
    const members = await new TenantRepository(MembershipModel, tid).find(
      { status: 'ACTIVE', roleKeys: { $in: roles.map((r) => r.key) } },
      { projection: { userId: 1 }, limit: 20 },
    );
    const users = await UserModel.find(
      { _id: { $in: members.map((m) => m.userId) }, status: 'ACTIVE' },
      'email',
    ).lean();
    for (const u of users) {
      await queueNotification(tid, {
        channel: 'EMAIL',
        to: u.email,
        templateKey: 'handoff_alert',
        data: { reason: reason.slice(0, 300), sessionId },
        dedupeKey: `handoff:${sessionId}:${u._id}`,
      });
    }
  });
}
