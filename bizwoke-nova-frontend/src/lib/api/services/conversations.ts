import { apiClient } from '../client';
import { ConversationSession, ConversationMessage, AiToolExecution, ConversationStatus, ConversationChannel } from '../types';

export interface ListConversationsQuery {
  page?: number;
  limit?: number;
  status?: ConversationStatus;
  channel?: ConversationChannel;
}

export const conversationsService = {
  async list(query?: ListConversationsQuery) {
    const res = await apiClient<ConversationSession[]>('/conversations', {
      params: query as Record<string, string | number>,
    });
    return {
      items: res.data,
      meta: res.meta,
    };
  },

  async getSessionWithMessages(id: string) {
    const res = await apiClient<{ session: ConversationSession; messages: ConversationMessage[] }>(
      `/conversations/${id}`
    );
    return res.data;
  },

  async getToolExecutions(id: string) {
    const res = await apiClient<AiToolExecution[]>(`/conversations/${id}/tool-executions`);
    return res.data;
  },

  async updateStatus(id: string, status: ConversationStatus, reason?: string) {
    const res = await apiClient<ConversationSession>(`/conversations/${id}/status`, {
      method: 'PATCH',
      body: { status, reason },
    });
    return res.data;
  },

  async sendMessage(id: string, text: string) {
    const res = await apiClient<ConversationMessage>(`/conversations/${id}/messages`, {
      method: 'POST',
      body: { text },
    });
    return res.data;
  },
};
