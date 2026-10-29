'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { conversationsService } from '@/lib/api/services/conversations';
import { ConversationSession, ConversationMessage, AiToolExecution, ConversationStatus } from '@/lib/api/types';
import { formatDateTime, formatTime } from '@/lib/utils';
import {
  MessageSquare,
  Send,
  UserCheck,
  Bot,
  User,
  Wrench,
  CheckCircle,
  RefreshCw,
  Search,
  AlertCircle,
} from 'lucide-react';
import { ApiClientError } from '@/lib/api/client';

export default function ConversationsPage() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<ConversationSession | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [tools, setTools] = useState<AiToolExecution[]>([]);
  const [toolsModalOpen, setToolsModalOpen] = useState(false);

  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const res = await conversationsService.list({ limit: 50 });
      setSessions(res.items);
      if (res.items.length > 0 && !selectedSessionId) {
        setSelectedSessionId(res.items[0]._id);
      }
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Failed to load conversations',
        message: err instanceof Error ? err.message : 'Please check permissions.',
      });
    } finally {
      setIsLoadingSessions(false);
    }
  }, [selectedSessionId, toast]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Load chat messages when selected session changes
  const loadChat = useCallback(async (sessionId: string) => {
    setIsLoadingChat(true);
    try {
      const [chatRes, toolsRes] = await Promise.all([
        conversationsService.getSessionWithMessages(sessionId),
        conversationsService.getToolExecutions(sessionId).catch(() => []),
      ]);
      setCurrentSession(chatRes.session);
      setMessages(chatRes.messages);
      setTools(toolsRes);
    } catch {
      toast({ type: 'error', title: 'Failed to load message history' });
    } finally {
      setIsLoadingChat(false);
    }
  }, [toast]);

  useEffect(() => {
    if (selectedSessionId) {
      loadChat(selectedSessionId);
    }
  }, [selectedSessionId, loadChat]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedSessionId) return;

    setIsSending(true);
    try {
      const msg = await conversationsService.sendMessage(selectedSessionId, replyText.trim());
      setMessages((prev) => [...prev, msg]);
      setReplyText('');
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Failed to send message',
        message: err instanceof ApiClientError ? err.message : 'Please check connection.',
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleTakeover = async (status: ConversationStatus) => {
    if (!selectedSessionId) return;
    try {
      const updated = await conversationsService.updateStatus(
        selectedSessionId,
        status,
        status === 'HANDOFF' ? 'Taken over by operator' : undefined
      );
      setCurrentSession(updated);
      toast({
        type: 'success',
        title: `Session status updated to ${status}`,
      });
      loadSessions();
    } catch {
      toast({ type: 'error', title: 'Failed to update session status' });
    }
  };

  return (
    <DashboardLayout
      title="Conversation Inbox & Channels"
      description="Omnichannel messaging, AI agent monitoring, human takeover, and tool execution logs"
      breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Conversations' }]}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[720px]">
        {/* Left Column: Sessions List (1 col) */}
        <Card className="flex flex-col h-full overflow-hidden">
          <div className="p-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Active Sessions ({sessions.length})
            </h3>
            <button
              onClick={loadSessions}
              className="text-slate-400 hover:text-slate-600 p-1"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {isLoadingSessions ? (
              <div className="p-4 text-center text-xs text-slate-400">Loading sessions...</div>
            ) : sessions.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No active conversation sessions. Customer chats via WhatsApp or API will appear here.
              </div>
            ) : (
              sessions.map((s) => {
                const isSelected = s._id === selectedSessionId;
                return (
                  <button
                    key={s._id}
                    onClick={() => setSelectedSessionId(s._id)}
                    className={`w-full text-left p-3.5 transition-colors flex flex-col gap-1 ${
                      isSelected ? 'bg-blue-50/70 border-l-4 border-blue-600' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 truncate">
                        {s.contactName || (s.customerId ? `Customer #${s.customerId.slice(-4)}` : 'Guest Visitor')}
                      </span>
                      <StatusBadge status={s.status} />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span className="uppercase font-semibold text-[10px] text-slate-400">
                        {s.channel}
                      </span>
                      <span>{s.lastMessageAt ? formatTime(s.lastMessageAt) : formatTime(s.createdAt)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        {/* Right Column: Chat Thread & Actions (2 cols) */}
        <Card className="lg:col-span-2 flex flex-col h-full overflow-hidden">
          {/* Chat Header */}
          {currentSession ? (
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {currentSession.contactName || 'Customer Chat'}
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-slate-500">Channel: {currentSession.channel}</span>
                  <span>•</span>
                  <StatusBadge status={currentSession.status} />
                </div>
              </div>

              <div className="flex items-center gap-2">
                {tools.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setToolsModalOpen(true)}
                    className="text-xs gap-1"
                  >
                    <Wrench className="w-3.5 h-3.5 text-blue-600" />
                    AI Tools ({tools.length})
                  </Button>
                )}

                {currentSession.status === 'OPEN' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleTakeover('HANDOFF')}
                    className="text-xs gap-1"
                  >
                    <UserCheck className="w-3.5 h-3.5" /> Take Over (Human Agent)
                  </Button>
                )}

                {currentSession.status === 'HANDOFF' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleTakeover('OPEN')}
                    className="text-xs"
                  >
                    Return to AI
                  </Button>
                )}

                {currentSession.status !== 'CLOSED' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleTakeover('CLOSED')}
                    className="text-xs text-slate-500 hover:text-slate-800"
                  >
                    Close Session
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 border-b border-slate-100 text-xs text-slate-400">
              Select a conversation to view transcript
            </div>
          )}

          {/* Messages Flow */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
            {isLoadingChat ? (
              <div className="flex items-center justify-center h-full text-xs text-slate-400">
                Loading transcript...
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-slate-400">
                No message transcript recorded for this session.
              </div>
            ) : (
              messages.map((m) => {
                const isUser = m.role === 'user';
                const isAssistant = m.role === 'assistant';
                const isAgent = m.role === 'agent';

                return (
                  <div
                    key={m._id}
                    className={`flex flex-col ${isUser ? 'items-start' : 'items-end'}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 text-[10px] text-slate-400">
                      {isUser ? (
                        <>
                          <User className="w-3 h-3" /> Customer
                        </>
                      ) : isAssistant ? (
                        <>
                          <Bot className="w-3 h-3 text-indigo-500" /> AI Assistant
                        </>
                      ) : (
                        <>
                          <UserCheck className="w-3 h-3 text-blue-600" /> Human Agent
                        </>
                      )}
                      <span>• {formatTime(m.createdAt)}</span>
                    </div>

                    <div
                      className={`max-w-md rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-xs ${
                        isUser
                          ? 'bg-white text-slate-800 border border-slate-200'
                          : isAssistant
                          ? 'bg-indigo-600 text-white'
                          : 'bg-blue-600 text-white'
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply Input Bar */}
          {currentSession && currentSession.status !== 'CLOSED' && (
            <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-slate-100 flex gap-2">
              <Input
                placeholder="Type reply to customer (queued to WhatsApp / API)..."
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                disabled={isSending}
                className="flex-1"
              />
              <Button type="submit" variant="primary" size="md" isLoading={isSending} className="gap-1.5">
                <Send className="w-3.5 h-3.5" /> Send
              </Button>
            </form>
          )}
        </Card>
      </div>

      {/* AI Tool Executions Modal */}
      <Dialog
        open={toolsModalOpen}
        onOpenChange={setToolsModalOpen}
        title="AI Assistant Tool Invocations"
        description="Inspect backend functions invoked autonomously by the LLM during this conversation."
        maxWidth="lg"
      >
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {tools.length === 0 ? (
            <p className="text-xs text-slate-400">No tool executions recorded for this session.</p>
          ) : (
            tools.map((t) => (
              <div key={t._id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1.5">
                <div className="flex items-center justify-between font-mono font-bold text-blue-700">
                  <span>{t.toolName}</span>
                  <span className="text-[10px] text-slate-400 font-sans">{formatTime(t.createdAt)}</span>
                </div>
                {t.args && (
                  <div>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase">Input Arguments:</span>
                    <pre className="mt-0.5 p-2 bg-white rounded border border-slate-100 text-[11px] overflow-x-auto text-slate-800 font-mono">
                      {JSON.stringify(t.args, null, 2)}
                    </pre>
                  </div>
                )}
                {t.result && (
                  <div>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase">Execution Result:</span>
                    <pre className="mt-0.5 p-2 bg-white rounded border border-slate-100 text-[11px] overflow-x-auto text-slate-800 font-mono">
                      {JSON.stringify(t.result, null, 2)}
                    </pre>
                  </div>
                )}
                {t.error && <p className="text-rose-600 font-semibold">{t.error}</p>}
              </div>
            ))
          )}
        </div>
      </Dialog>
    </DashboardLayout>
  );
}
