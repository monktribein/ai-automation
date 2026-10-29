'use client';

import React, { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { businessService, type WhatsAppStatus } from '@/lib/api/services/business';
import { BusinessSettings } from '@/lib/api/types';
import {
  MessageSquare,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  Plus,
  Trash2,
  Save,
  RefreshCw,
  Lock,
  Send,
} from 'lucide-react';

interface WhatsAppTemplate {
  key: string;
  name: string;
  language: string;
}

export default function WhatsAppIntegrationPage() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [displayNumber, setDisplayNumber] = useState('');
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);

  // Live connection status + test message
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  // Add template modal / inline state
  const [newKey, setNewKey] = useState('');
  const [newName, setNewName] = useState('');
  const [newLang, setNewLang] = useState('en_US');

  const webhookUrl = typeof window !== 'undefined'
    ? `${process.env.NEXT_PUBLIC_API_BASE_URL || 'https://api.yourdomain.com/api/v1'}/webhooks/aknexus/<AK_NEXUS_WEBHOOK_SECRET>`
    : 'https://api.yourdomain.com/api/v1/webhooks/aknexus/<AK_NEXUS_WEBHOOK_SECRET>';

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await businessService.getSettings();
      const wa = res.settings?.integrations?.whatsapp;
      if (wa) {
        setEnabled(!!wa.enabled);
        setPhoneNumberId(wa.phoneNumberId || '');
        setDisplayNumber(wa.displayNumber || '');
        setTemplates(wa.templates || []);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load WhatsApp configuration';
      addToast('error', msg);
    } finally {
      setLoading(false);
    }
  };

  const loadStatus = async () => {
    try {
      setStatusLoading(true);
      setStatus(await businessService.getWhatsAppStatus());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to check WhatsApp connection';
      addToast('error', msg);
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    loadStatus();
  }, []);

  const handleSendTest = async () => {
    const to = testTo.trim();
    if (!/^\+?[0-9 ()-]{6,20}$/.test(to)) {
      addToast('error', 'Enter a phone number with country code, e.g. 919876543210');
      return;
    }
    try {
      setSendingTest(true);
      const r = await businessService.sendWhatsAppTest(to);
      if (r.dryRun) addToast('info', 'Dry run is enabled on the server: the message was not sent');
      else addToast('success', `Test message sent to +${r.to}. Check the phone.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send test message';
      addToast('error', msg);
    } finally {
      setSendingTest(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enabled && !phoneNumberId.trim()) {
      addToast('error', 'WhatsApp instance ID is required when WhatsApp integration is enabled');
      return;
    }

    try {
      setSaving(true);
      await businessService.updateWhatsAppIntegration({
        enabled,
        phoneNumberId: phoneNumberId.trim(),
        displayNumber: displayNumber.trim() || undefined,
        templates,
      });
      addToast('success', 'WhatsApp configuration saved successfully');
      loadStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update WhatsApp settings';
      addToast('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const addTemplate = () => {
    if (!newKey.trim() || !newName.trim()) {
      addToast('error', 'Template event key and Meta template name are required');
      return;
    }
    if (templates.some((t) => t.key.toLowerCase() === newKey.trim().toLowerCase())) {
      addToast('error', 'A template with this event key already exists');
      return;
    }

    setTemplates([...templates, { key: newKey.trim(), name: newName.trim(), language: newLang.trim() || 'en_US' }]);
    setNewKey('');
    setNewName('');
    setNewLang('en_US');
    addToast('success', 'Template mapping added. Remember to save changes.');
  };

  const removeTemplate = (idx: number) => {
    setTemplates(templates.filter((_, i) => i !== idx));
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    addToast('info', `${label} copied to clipboard`);
  };

  return (
    <DashboardLayout
      title="WhatsApp Integration (AK Nexus)"
      description="Connect your AK Nexus WhatsApp instance for AI conversational bots and automated notifications"
      requiredPermission="integrations:manage"
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={loadData}
          disabled={loading || saving}
          className="gap-2"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      }
    >
      <div className="max-w-5xl space-y-6">
        {/* Connection Status Banner */}
        <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 rounded-xl p-5 text-white shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-500/20 border border-emerald-400/30 rounded-xl">
              <MessageSquare className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-base">AK Nexus WhatsApp Gateway</h3>
                <Badge variant={enabled ? 'success' : 'default'} className="text-[10px]">
                  {enabled ? 'Active / Configured' : 'Disabled'}
                </Badge>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                All outbound messages and inbound AI conversation webhooks flow through your connected AK Nexus WhatsApp instance.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="https://app.aknexus.in/api_automation/webhooks"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              AK Nexus Dashboard
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Live connection status + test message */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-emerald-600" />
                  Connection &amp; Test Message
                </CardTitle>
                <CardDescription className="text-xs">
                  Live status of your WhatsApp instance, checked directly with AK Nexus. Save your settings below first.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={loadStatus}
                disabled={statusLoading}
                className="gap-2 shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${statusLoading ? 'animate-spin' : ''}`} />
                Check connection
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {statusLoading && !status ? (
              <Skeleton className="h-14 w-full rounded-lg" />
            ) : status ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3 rounded-lg border border-slate-200 bg-slate-50/60 text-xs">
                <div className="flex items-center gap-2">
                  {status.connection === 'connected' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                  )}
                  <span className="font-semibold text-slate-800">
                    {status.connection === 'connected'
                      ? 'Connected'
                      : status.connection === 'disconnected'
                        ? 'Disconnected: reconnect the instance in AK Nexus'
                        : status.connection === 'instance_not_set'
                          ? 'No instance ID saved yet'
                          : status.connection === 'provider_not_configured'
                            ? 'WhatsApp provider not configured on the server'
                            : status.connection === 'error'
                              ? 'Could not reach AK Nexus'
                              : `Status: ${status.connection}`}
                  </span>
                </div>
                <span className="text-slate-500">
                  Instance: <span className="font-mono text-slate-700">{status.instanceId ?? '—'}</span>
                </span>
                <span className="text-slate-500">
                  Provider: <span className="text-slate-700">{status.provider ?? 'none'}</span>
                </span>
                {status.dryRun && <Badge variant="warning" className="text-[10px]">Dry run: messages are not sent</Badge>}
                {!status.integrationEnabled && (
                  <Badge variant="default" className="text-[10px]">Integration disabled</Badge>
                )}
                {status.error && <span className="w-full text-red-600">{status.error}</span>}
              </div>
            ) : null}

            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <div className="flex-1">
                <Input
                  label="Send a test message to"
                  placeholder="e.g. 919876543210"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  helperText="Phone number with country code. Sends one fixed test message from your business number."
                />
              </div>
              <Button
                type="button"
                onClick={handleSendTest}
                disabled={sendingTest || !status?.integrationEnabled}
                className="gap-2 md:mb-6"
              >
                <Send className="w-4 h-4" />
                {sendingTest ? 'Sending…' : 'Send test message'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            {/* Account Credentials & Switch */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-blue-600" />
                      Phone Number Configuration
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Provide your AK Nexus WhatsApp instance ID (AK Nexus → API &amp; Automation → WhatsApp Instances) and optional display sender number.
                    </CardDescription>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-xs font-medium text-slate-600">Enable Integration:</span>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => setEnabled(e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-slate-300 cursor-pointer"
                    />
                  </label>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="WhatsApp Instance ID"
                    required={enabled}
                    placeholder="e.g. 6ADC3724DD691"
                    value={phoneNumberId}
                    onChange={(e) => setPhoneNumberId(e.target.value)}
                    helperText="e.g. 6ADC3724DD691 — the connected instance shown in AK Nexus"
                  />
                  <Input
                    label="Display Number (Optional)"
                    placeholder="e.g. +1 555-0199"
                    value={displayNumber}
                    onChange={(e) => setDisplayNumber(e.target.value)}
                    helperText="Sender phone number shown to customers"
                  />
                </div>

                <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-lg flex items-start gap-2.5">
                  <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-800">
                    <span className="font-semibold">Security & Access Tokens:</span> The AK Nexus API token and webhook secret live only in backend environment variables (<code className="font-mono bg-amber-100/80 px-1 py-0.5 rounded text-[11px]">AK_NEXUS_API_TOKEN</code>, <code className="font-mono bg-amber-100/80 px-1 py-0.5 rounded text-[11px]">AK_NEXUS_WEBHOOK_SECRET</code>) and are never sent to the browser.
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Registered Message Templates */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pre-Approved Notification Templates</CardTitle>
                <CardDescription className="text-xs">
                  Optional. Only needed with the Meta Cloud API provider; with AK Nexus, notifications are sent as text automatically.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {templates.length === 0 ? (
                  <div className="text-center py-6 border border-dashed border-slate-200 rounded-lg">
                    <p className="text-xs text-slate-500">No message templates mapped yet.</p>
                    <p className="text-[11px] text-slate-400 mt-1">Add keys like <code className="bg-slate-100 px-1 py-0.5 rounded">appointment_confirmation</code> below.</p>
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
                    {templates.map((tpl, idx) => (
                      <div key={idx} className="p-3 bg-white flex items-center justify-between gap-4 hover:bg-slate-50/50">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 flex-1">
                          <div>
                            <span className="text-[10px] text-slate-400 font-medium uppercase">Internal Event</span>
                            <p className="text-xs font-mono font-semibold text-slate-800">{tpl.key}</p>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-medium uppercase">Meta Template Name</span>
                            <p className="text-xs text-slate-700 font-medium">{tpl.name}</p>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-medium uppercase">Language</span>
                            <Badge variant="outline" className="text-[10px] uppercase font-mono mt-0.5">
                              {tpl.language}
                            </Badge>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeTemplate(idx)}
                          className="text-slate-400 hover:text-rose-600 p-1.5 h-8 w-8"
                          title="Remove template"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add New Template Form */}
                <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200/80 space-y-3">
                  <span className="text-xs font-semibold text-slate-700 block">Add Template Mapping</span>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Input
                      placeholder="Event Key (e.g. appointment_confirmation)"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      className="text-xs"
                    />
                    <Input
                      placeholder="Meta Template (e.g. nova_booking_v1)"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="text-xs"
                    />
                    <div className="flex gap-2">
                      <Input
                        placeholder="Language (e.g. en_US)"
                        value={newLang}
                        onChange={(e) => setNewLang(e.target.value)}
                        className="text-xs"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={addTemplate}
                        className="shrink-0 gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Webhook Configuration Guide */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  AK Nexus Webhook Endpoint
                </CardTitle>
                <CardDescription className="text-xs">
                  In AK Nexus → API &amp; Automation → Webhooks → Create Webhook, paste this URL (replace the placeholder with the backend AK_NEXUS_WEBHOOK_SECRET value) to receive incoming messages and enable AI replies.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-slate-700">Callback URL</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={webhookUrl}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs font-mono text-slate-700 focus:outline-hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(webhookUrl, 'Webhook URL')}
                      className="gap-1.5 shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600">
                  <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-lg space-y-1">
                    <span className="font-semibold text-slate-800">Verification Token</span>
                    <p className="text-[11px] text-slate-500">
                      Matches your backend environment setting <code className="bg-slate-200/80 px-1 rounded text-slate-700 font-mono">WHATSAPP_VERIFY_TOKEN</code>.
                    </p>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-lg space-y-1">
                    <span className="font-semibold text-slate-800">Webhook Fields Required</span>
                    <p className="text-[11px] text-slate-500">
                      Select the <strong className="text-slate-700">new message</strong> (incoming message) event in AK Nexus.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="submit"
                disabled={saving}
                className="gap-2 bg-blue-600 hover:bg-blue-700 text-white min-w-[140px]"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Configuration'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </DashboardLayout>
  );
}
