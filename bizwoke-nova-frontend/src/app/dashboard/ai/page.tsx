'use client';

import React, { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { aiService, AiStatus } from '@/lib/api/services/ai';
import { Bot, Send, Wrench, ShieldAlert, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react';
import { ApiClientError } from '@/lib/api/client';

export default function AiAssistantPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Playground chat
  const [testMessage, setTestMessage] = useState('');
  const [chatLog, setChatLog] = useState<Array<{ sender: 'user' | 'assistant'; text: string }>>([]);
  const [isSending, setIsSending] = useState(false);
  const [chatSessionId, setChatSessionId] = useState<string | undefined>(undefined);

  useEffect(() => {
    aiService
      .getStatus()
      .then((data) => setStatus(data))
      .catch(() => setStatus(null))
      .finally(() => setIsLoading(false));
  }, []);

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testMessage.trim()) return;

    const userText = testMessage.trim();
    setChatLog((prev) => [...prev, { sender: 'user', text: userText }]);
    setTestMessage('');
    setIsSending(true);

    try {
      const res = await aiService.chat({
        sessionId: chatSessionId,
        message: userText,
        contactName: 'Operator Test',
      });
      setChatSessionId(res.sessionId);
      setChatLog((prev) => [...prev, { sender: 'assistant', text: res.reply }]);
    } catch (err: unknown) {
      const msg = err instanceof ApiClientError ? err.message : 'AI assistant is currently unavailable.';
      setChatLog((prev) => [
        ...prev,
        {
          sender: 'assistant',
          text: `[Error: ${msg}]`,
        },
      ]);
      toast({
        type: 'error',
        title: 'Chat failed',
        message: msg,
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <DashboardLayout
      title="AI Assistant & Engine"
      description="Inspect backend provider integration, available tool functions, and test conversational flows"
      breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'AI Assistant' }]}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Status & Tools (1 col) */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-indigo-600" />
                <CardTitle>AI Provider Status</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3.5 text-xs">
              <div>
                <span className="text-slate-400 font-medium">Provider Connection</span>
                <div className="flex items-center gap-2 mt-1">
                  {status?.available ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Provider Online
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-semibold border border-amber-200">
                      <AlertTriangle className="w-3.5 h-3.5" /> Standby / Unconfigured
                    </span>
                  )}
                </div>
              </div>

              <div>
                <span className="text-slate-400 font-medium">Configured LLM Adapter</span>
                <p className="font-semibold text-slate-800 mt-0.5">
                  {status?.provider || 'Mock / OpenAI-compatible / Anthropic'}
                </p>
              </div>

              <div>
                <span className="text-slate-400 font-medium">Default Model ID</span>
                <p className="font-mono text-slate-700 font-medium mt-0.5">
                  {status?.model || 'Configured via business settings'}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-blue-600" />
                <CardTitle>Autonomous Tool Registry</CardTitle>
              </div>
              <CardDescription>
                Tools that the AI model can execute automatically during customer conversations
              </CardDescription>
            </CardHeader>
            <CardContent>
              {status?.tools && status.tools.length > 0 ? (
                <div className="space-y-1.5">
                  {status.tools.map((tool, idx) => (
                    <div
                      key={idx}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-100 font-mono text-xs font-semibold text-blue-700"
                    >
                      {tool}()
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">No tools loaded.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Interactive Test Playground (2 cols) */}
        <div className="lg:col-span-2">
          <Card className="flex flex-col h-[600px] overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-white">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-600" /> Assistant Playground
                  </CardTitle>
                  <CardDescription>Test intent recognition, slot lookups, and KB query answers</CardDescription>
                </div>
                {chatLog.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setChatLog([]);
                      setChatSessionId(undefined);
                    }}
                    className="text-xs"
                  >
                    Clear History
                  </Button>
                )}
              </div>
            </CardHeader>

            {/* Chat output */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
              {chatLog.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-xs text-slate-400 p-8">
                  <Bot className="w-10 h-10 text-slate-300 mb-2" />
                  <p className="font-semibold text-slate-600">AI Assistant Test Channel</p>
                  <p className="max-w-xs mt-1 text-slate-400">
                    Send a test customer message (e.g. &ldquo;What services do you offer?&rdquo; or &ldquo;Can I book an appointment tomorrow?&rdquo;) to test model tool execution.
                  </p>
                </div>
              ) : (
                chatLog.map((item, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col ${item.sender === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <span className="text-[10px] text-slate-400 mb-0.5">
                      {item.sender === 'user' ? 'Operator' : 'AI Assistant'}
                    </span>
                    <div
                      className={`max-w-md rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-xs ${
                        item.sender === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-slate-800 border border-slate-200'
                      }`}
                    >
                      {item.text}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Input bar */}
            <form onSubmit={handleSendTest} className="p-3 bg-white border-t border-slate-100 flex gap-2">
              <Input
                placeholder="Ask the AI assistant a question or request a booking..."
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                disabled={isSending}
                className="flex-1"
              />
              <Button type="submit" variant="primary" isLoading={isSending} className="gap-1.5">
                <Send className="w-3.5 h-3.5" /> Send
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
