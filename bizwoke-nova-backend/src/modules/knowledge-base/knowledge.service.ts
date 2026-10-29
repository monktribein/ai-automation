import type { Types } from 'mongoose';
import { escapeRegex } from '../../common/utils/text';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { KnowledgeArticleModel, type KnowledgeArticleDoc } from './knowledge.model';

export const kbRepo = (tenantId: Types.ObjectId) =>
  new TenantRepository<KnowledgeArticleDoc>(KnowledgeArticleModel, tenantId);

/**
 * Keyword retrieval over APPROVED articles of one tenant. Uses the text index when possible and
 * falls back to a bounded regex scan. (Vector search can be added behind this function.)
 */
export async function searchKnowledge(tenantId: Types.ObjectId, query: string, limit = 3) {
  const repo = kbRepo(tenantId);
  const q = query.trim().slice(0, 200);
  if (!q)
    return repo.find(
      { status: 'APPROVED' },
      { sort: { updatedAt: -1 }, limit, projection: { title: 1, content: 1 } },
    );
  const viaText = await KnowledgeArticleModel.find(
    { tenantId, status: 'APPROVED', $text: { $search: q } },
    { score: { $meta: 'textScore' }, title: 1, content: 1 },
  )
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit)
    .lean();
  if (viaText.length) return viaText;
  const words = q
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 5)
    .map(escapeRegex);
  if (!words.length) return [];
  const rx = new RegExp(words.join('|'), 'i');
  return repo.find(
    { status: 'APPROVED', $or: [{ title: rx }, { content: rx }, { tags: rx }] },
    { limit, projection: { title: 1, content: 1 } },
  );
}
