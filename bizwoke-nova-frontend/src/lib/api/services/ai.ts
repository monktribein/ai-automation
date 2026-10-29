import { apiClient } from '../client';
import { KnowledgeArticle, KnowledgeStatus } from '../types';

export interface AiStatus {
  provider: string | null;
  available: boolean;
  model: string;
  tools: string[];
}

export const aiService = {
  async getStatus() {
    const res = await apiClient<AiStatus>('/ai/status');
    return res.data;
  },

  async chat(body: { sessionId?: string; message: string; customerId?: string; contactName?: string }) {
    const res = await apiClient<{ reply: string; sessionId: string; toolExecutions?: unknown[] }>('/ai/chat', {
      method: 'POST',
      body,
    });
    return res.data;
  },
};

export const knowledgeBaseService = {
  async list(query?: { page?: number; limit?: number; status?: KnowledgeStatus }) {
    const res = await apiClient<KnowledgeArticle[]>('/knowledge-base', {
      params: query as Record<string, string | number>,
    });
    return {
      items: res.data,
      meta: res.meta,
    };
  },

  async search(q: string) {
    const res = await apiClient<KnowledgeArticle[]>('/knowledge-base/search', {
      params: { q },
    });
    return res.data;
  },

  async getById(id: string) {
    const res = await apiClient<KnowledgeArticle>(`/knowledge-base/${id}`);
    return res.data;
  },

  async create(body: { title: string; content: string; tags?: string[] }) {
    const res = await apiClient<KnowledgeArticle>('/knowledge-base', {
      method: 'POST',
      body,
    });
    return res.data;
  },

  async update(id: string, body: Partial<{ title: string; content: string; tags: string[]; status: KnowledgeStatus }>) {
    const res = await apiClient<KnowledgeArticle>(`/knowledge-base/${id}`, {
      method: 'PATCH',
      body,
    });
    return res.data;
  },

  async archive(id: string) {
    const res = await apiClient<KnowledgeArticle>(`/knowledge-base/${id}`, {
      method: 'DELETE',
    });
    return res.data;
  },
};
