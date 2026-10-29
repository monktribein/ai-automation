import { model, type Types } from 'mongoose';
import { tenantSchema } from '../../infrastructure/mongodb/base-schema';

/** Only APPROVED articles are ever retrieved for the AI. Content is treated as untrusted data. */
export interface KnowledgeArticleDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  title: string;
  content: string;
  tags: string[];
  status: 'DRAFT' | 'APPROVED' | 'ARCHIVED';
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = tenantSchema<KnowledgeArticleDoc>({
  title: { type: String, required: true, maxlength: 200 },
  content: { type: String, required: true, maxlength: 20_000 },
  tags: { type: [String], default: [] },
  status: { type: String, enum: ['DRAFT', 'APPROVED', 'ARCHIVED'], default: 'DRAFT' },
  approvedBy: { type: 'ObjectId', ref: 'User' },
  approvedAt: Date,
});
schema.index({ tenantId: 1, status: 1 });
// tenantId is a prefix key of the text index, so every $text query MUST supply an equality on tenantId.
schema.index(
  { tenantId: 1, title: 'text', content: 'text', tags: 'text' },
  { weights: { title: 5, tags: 3, content: 1 }, name: 'kb_text' },
);

export const KnowledgeArticleModel = model<KnowledgeArticleDoc>(
  'KnowledgeArticle',
  schema,
  'knowledgeArticles',
);
