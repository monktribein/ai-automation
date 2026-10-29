import type { Types } from 'mongoose';
import { Errors } from '../../common/errors/app-error';
import {
  SubscriptionPlanModel,
  TenantSubscriptionModel,
  UsageRecordModel,
  type PlanLimits,
  type UsageMetric,
} from '../subscriptions/subscription.models';

const LIMIT_KEY: Record<UsageMetric, keyof PlanLimits> = {
  appointments: 'appointmentsPerMonth',
  aiMessages: 'aiMessagesPerMonth',
  aiTokens: 'aiTokensPerMonth',
  whatsappMessages: 'whatsappMessagesPerMonth',
  exports: 'exportsPerMonth',
  imports: 'importsPerMonth',
};

export const currentPeriod = (d = new Date()) => d.toISOString().slice(0, 7);

export async function effectiveLimits(tenantId: Types.ObjectId): Promise<PlanLimits & { planCode?: string }> {
  const sub = await TenantSubscriptionModel.findOne({ tenantId, status: 'ACTIVE' }).lean();
  if (!sub) return {}; // No subscription => no plan limits configured (unlimited); documented behaviour.
  const plan = await SubscriptionPlanModel.findById(sub.planId).lean();
  return { ...(plan?.limits ?? {}), ...stripUndefined(sub.limitOverrides ?? {}), planCode: plan?.code };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}

/**
 * Atomically reserves `amount` units of a metric. The conditional upsert guarantees that
 * concurrent callers cannot push usage past the limit.
 */
export async function consumeQuota(tenantId: Types.ObjectId, metric: UsageMetric, amount = 1): Promise<void> {
  const limits = await effectiveLimits(tenantId);
  const limit = limits[LIMIT_KEY[metric]];
  const period = currentPeriod();
  if (limit === undefined) {
    await UsageRecordModel.updateOne(
      { tenantId, metric, period },
      { $inc: { count: amount } },
      { upsert: true },
    );
    return;
  }
  if (amount > limit) throw Errors.quotaExceeded(metric);
  try {
    const res = await UsageRecordModel.updateOne(
      { tenantId, metric, period, count: { $lte: limit - amount } },
      { $inc: { count: amount } },
      { upsert: true },
    );
    if (res.matchedCount === 0 && res.upsertedCount === 0) throw Errors.quotaExceeded(metric);
  } catch (err) {
    // Upsert collided with the existing over-limit doc on the unique index => over quota.
    if ((err as { code?: number }).code === 11000) throw Errors.quotaExceeded(metric);
    throw err;
  }
}

/** Records usage that has already happened (e.g. AI tokens), without blocking. */
export async function recordUsage(
  tenantId: Types.ObjectId,
  metric: UsageMetric,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  await UsageRecordModel.updateOne(
    { tenantId, metric, period: currentPeriod() },
    { $inc: { count: amount } },
    { upsert: true },
  );
}

export async function releaseQuota(tenantId: Types.ObjectId, metric: UsageMetric, amount = 1): Promise<void> {
  await UsageRecordModel.updateOne(
    { tenantId, metric, period: currentPeriod(), count: { $gte: amount } },
    { $inc: { count: -amount } },
  );
}

export async function usageSummary(tenantId: Types.ObjectId, period = currentPeriod()) {
  const [records, limits] = await Promise.all([
    UsageRecordModel.find({ tenantId, period }, 'metric count').lean(),
    effectiveLimits(tenantId),
  ]);
  const used = Object.fromEntries(records.map((r) => [r.metric, r.count]));
  return { period, plan: limits.planCode ?? null, limits, used };
}
