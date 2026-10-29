'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { businessService } from '@/lib/api/services/business';
import { BusinessSettings, Tenant } from '@/lib/api/types';
import { Settings, Save, Globe, Palette, Shield, Building, Clock, Bot, AlertCircle, MessageSquare } from 'lucide-react';
import { MessagesSettingsTab } from './messages-tab';
import { ApiClientError } from '@/lib/api/client';

export default function BusinessSettingsPage() {
  const { toast } = useToast();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'branding' | 'policy' | 'messages' | 'ai' | 'slug'>('profile');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Profile fields
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [address, setAddress] = useState('');

  // Branding fields
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#2563eb');
  const [accentColor, setAccentColor] = useState('#6366f1');

  // Policy fields
  const [minNoticeMinutes, setMinNoticeMinutes] = useState(60);
  const [maxAdvanceDays, setMaxAdvanceDays] = useState(30);
  const [slotIntervalMinutes, setSlotIntervalMinutes] = useState<5 | 10 | 15 | 20 | 30 | 60>(15);
  const [allowGuestBooking, setAllowGuestBooking] = useState(true);
  const [requireConfirmation, setRequireConfirmation] = useState(false);
  const [cancellationCutoffMinutes, setCancellationCutoffMinutes] = useState(120);

  // AI Assistant instructions
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiMaxTurns, setAiMaxTurns] = useState(10);
  const [aiInstructions, setAiInstructions] = useState('');
  const [aiHandoffMessage, setAiHandoffMessage] = useState('');

  // Slug change
  const [newSlug, setNewSlug] = useState('');
  const [slugSaving, setSlugSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await businessService.getSettings();
      setTenant(data.tenant);
      setSettings(data.settings);

      // Populate form state
      setDisplayName(data.settings.profile?.displayName || data.tenant.name || '');
      setDescription(data.settings.profile?.description || '');
      setCategory(data.settings.profile?.category || data.tenant.category || '');
      setEmail(data.settings.profile?.email || '');
      setPhone(data.settings.profile?.phone || '');
      setWebsite(data.settings.profile?.website || '');
      setAddress(data.settings.profile?.address || '');

      setLogoUrl(data.settings.branding?.logoUrl || '');
      setPrimaryColor(data.settings.branding?.primaryColor || '#2563eb');
      setAccentColor(data.settings.branding?.accentColor || '#6366f1');

      if (data.settings.bookingPolicy) {
        setMinNoticeMinutes(data.settings.bookingPolicy.minNoticeMinutes ?? 60);
        setMaxAdvanceDays(data.settings.bookingPolicy.maxAdvanceDays ?? 30);
        setSlotIntervalMinutes(data.settings.bookingPolicy.slotIntervalMinutes ?? 15);
        setAllowGuestBooking(data.settings.bookingPolicy.allowGuestBooking ?? true);
        setRequireConfirmation(data.settings.bookingPolicy.requireConfirmation ?? false);
        setCancellationCutoffMinutes(data.settings.bookingPolicy.cancellationCutoffMinutes ?? 120);
      }

      if (data.settings.ai) {
        setAiEnabled(data.settings.ai.enabled ?? true);
        setAiMaxTurns(data.settings.ai.maxTurns ?? 10);
        setAiInstructions(data.settings.ai.instructions || '');
        setAiHandoffMessage(data.settings.ai.handoffMessage || '');
      }

      setNewSlug(data.tenant.slug);
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Failed to load business settings',
        message: err instanceof Error ? err.message : 'Please check permissions.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await businessService.updateSettings({
        profile: {
          displayName,
          description,
          category,
          email: email || undefined,
          phone: phone || undefined,
          website: website || undefined,
          address: address || undefined,
        },
      });
      toast({ type: 'success', title: 'Profile settings saved' });
      loadSettings();
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Save failed',
        message: err instanceof ApiClientError ? err.message : 'Error updating profile',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await businessService.updateSettings({
        branding: {
          logoUrl: logoUrl || undefined,
          primaryColor,
          accentColor,
        },
      });
      toast({ type: 'success', title: 'Branding updated' });
      loadSettings();
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Branding update failed',
        message: err instanceof ApiClientError ? err.message : 'Check color format (#rrggbb)',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await businessService.updateSettings({
        bookingPolicy: {
          minNoticeMinutes,
          maxAdvanceDays,
          slotIntervalMinutes,
          allowGuestBooking,
          requireConfirmation,
          cancellationCutoffMinutes,
          rescheduleCutoffMinutes: cancellationCutoffMinutes,
        },
      });
      toast({ type: 'success', title: 'Booking policy saved' });
      loadSettings();
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Policy update failed',
        message: err instanceof ApiClientError ? err.message : 'Check policy limits',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAi = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await businessService.updateSettings({
        ai: {
          enabled: aiEnabled,
          maxTurns: aiMaxTurns,
          instructions: aiInstructions,
          handoffMessage: aiHandoffMessage,
        },
      });
      toast({ type: 'success', title: 'AI Assistant parameters saved' });
      loadSettings();
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'AI config failed',
        message: err instanceof ApiClientError ? err.message : 'Permission ai:configure required',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSlug = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSlug.trim() || newSlug === tenant?.slug) return;
    if (!confirm(`Warning: Changing your public slug from "${tenant?.slug}" to "${newSlug}" will immediately change your live booking URL to /book/${newSlug}. Proceed?`)) {
      return;
    }

    setSlugSaving(true);
    try {
      const res = await businessService.updateSlug(newSlug.trim().toLowerCase());
      toast({
        type: 'success',
        title: 'Business slug updated',
        message: `New booking URL: /book/${res.slug}`,
      });
      loadSettings();
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Slug change failed',
        message: err instanceof ApiClientError ? err.message : 'Slug already taken.',
      });
    } finally {
      setSlugSaving(false);
    }
  };

  return (
    <DashboardLayout
      title="Business Settings"
      description="Configure your business profile, booking policy, brand customization, and public portal URL"
      breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Settings' }]}
    >
      {/* Settings Navigation Tabs */}
      <div className="flex border-b border-slate-200 mb-6 space-x-6 text-xs font-semibold text-slate-600">
        {[
          { key: 'profile', label: 'Business Profile', icon: Building },
          { key: 'branding', label: 'Branding & Design', icon: Palette },
          { key: 'policy', label: 'Booking Rules & Policy', icon: Clock },
          { key: 'messages', label: 'Messages & WhatsApp', icon: MessageSquare },
          { key: 'ai', label: 'AI Instructions', icon: Bot },
          { key: 'slug', label: 'Public Slug (URL)', icon: Globe },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`flex items-center gap-2 py-3 border-b-2 transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-600 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Profile Form */}
      {activeTab === 'profile' && (
        <Card>
          <CardHeader>
            <CardTitle>Business Profile Information</CardTitle>
            <CardDescription>Public identity details presented across booking flows and invoices</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveProfile} className="space-y-4 max-w-2xl">
              <Input
                label="Display Name"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <Input
                label="Description"
                placeholder="Brief summary of your business"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Contact Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Input
                  label="Contact Phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Website URL (HTTPS required)"
                  type="url"
                  placeholder="https://example.com"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
                <Input
                  label="Business Category"
                  placeholder="clinic, salon, consulting"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </div>
              <Input
                label="Physical Address"
                placeholder="Full address for client appointments"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />

              <Button type="submit" variant="primary" className="gap-2 mt-4" isLoading={isSaving}>
                <Save className="w-4 h-4" /> Save Profile
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Branding Form */}
      {activeTab === 'branding' && (
        <Card>
          <CardHeader>
            <CardTitle>Branding & Visual Colors</CardTitle>
            <CardDescription>Tailor primary and accent colors for your public appointment booking page</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveBranding} className="space-y-4 max-w-xl">
              <Input
                label="Logo Image URL (HTTPS)"
                placeholder="https://cdn.example.com/logo.png"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Primary Color (Hex)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="h-9 w-9 rounded border cursor-pointer p-0.5"
                    />
                    <Input
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      placeholder="#2563eb"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Accent Color (Hex)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="h-9 w-9 rounded border cursor-pointer p-0.5"
                    />
                    <Input
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      placeholder="#6366f1"
                    />
                  </div>
                </div>
              </div>

              <Button type="submit" variant="primary" className="gap-2 mt-4" isLoading={isSaving}>
                <Save className="w-4 h-4" /> Save Branding
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Booking Rules Form */}
      {activeTab === 'policy' && (
        <Card>
          <CardHeader>
            <CardTitle>Booking Policy & Cutoff Controls</CardTitle>
            <CardDescription>Configure lead notice, advance booking windows, and cancellation rules</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSavePolicy} className="space-y-4 max-w-2xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Minimum Notice (Minutes)"
                  type="number"
                  min={0}
                  value={minNoticeMinutes}
                  onChange={(e) => setMinNoticeMinutes(Number(e.target.value))}
                  hint="How much advance notice is required before booking"
                />
                <Input
                  label="Maximum Advance Booking (Days)"
                  type="number"
                  min={1}
                  value={maxAdvanceDays}
                  onChange={(e) => setMaxAdvanceDays(Number(e.target.value))}
                  hint="How far into the future clients can schedule"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="Slot Interval"
                  value={String(slotIntervalMinutes)}
                  onChange={(e) => setSlotIntervalMinutes(Number(e.target.value) as any)}
                  options={[
                    { value: '5', label: '5 minutes interval' },
                    { value: '10', label: '10 minutes interval' },
                    { value: '15', label: '15 minutes interval' },
                    { value: '20', label: '20 minutes interval' },
                    { value: '30', label: '30 minutes interval' },
                    { value: '60', label: '60 minutes interval' },
                  ]}
                />
                <Input
                  label="Cancellation Cutoff (Minutes)"
                  type="number"
                  min={0}
                  value={cancellationCutoffMinutes}
                  onChange={(e) => setCancellationCutoffMinutes(Number(e.target.value))}
                  hint="No client cancellations allowed within this window"
                />
              </div>

              <div className="space-y-2 pt-2 border-t">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={allowGuestBooking}
                    onChange={(e) => setAllowGuestBooking(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Allow Guest Booking (Does not require customer account creation)
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={requireConfirmation}
                    onChange={(e) => setRequireConfirmation(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Require Manual Staff Confirmation (Status starts as PENDING_CONFIRMATION)
                </label>
              </div>

              <Button type="submit" variant="primary" className="gap-2 mt-4" isLoading={isSaving}>
                <Save className="w-4 h-4" /> Save Booking Policy
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* AI Settings Form */}
      {activeTab === 'ai' && (
        <Card>
          <CardHeader>
            <CardTitle>AI Assistant Prompting & Handoff</CardTitle>
            <CardDescription>Custom instructions injected into the system prompt of your conversational AI engine</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveAi} className="space-y-4 max-w-2xl">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  onChange={(e) => setAiEnabled(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                Enable AI Assistant for Customer Chats
              </label>

              <Input
                label="Maximum Conversation Turns per Session"
                type="number"
                min={1}
                max={50}
                value={aiMaxTurns}
                onChange={(e) => setAiMaxTurns(Number(e.target.value))}
                hint="Prevents runaway loops; triggers handoff after max turns"
              />

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 block">
                  Custom AI Instructions / Tone Guidelines
                </label>
                <textarea
                  rows={6}
                  value={aiInstructions}
                  onChange={(e) => setAiInstructions(e.target.value)}
                  placeholder="e.g. Always greet clients warmly. Provide consultation pricing when requested. Do not provide medical diagnoses."
                  className="block w-full rounded-lg border border-slate-300 bg-white p-3 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <Input
                label="Handoff Notice Message"
                placeholder="e.g. I am connecting you with a member of our human staff right now."
                value={aiHandoffMessage}
                onChange={(e) => setAiHandoffMessage(e.target.value)}
              />

              <Button type="submit" variant="primary" className="gap-2 mt-4" isLoading={isSaving}>
                <Save className="w-4 h-4" /> Save AI Instructions
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {activeTab === 'messages' && settings && (
        <MessagesSettingsTab key={settings._id ?? 'messages'} settings={settings} onSaved={loadSettings} />
      )}

      {/* Slug Form */}
      {activeTab === 'slug' && (
        <Card>
          <CardHeader>
            <CardTitle>Public Business Slug (Booking URL)</CardTitle>
            <CardDescription>
              Your public booking link is generated from this slug identifier.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveSlug} className="space-y-4 max-w-md">
              <Input
                label="Business Slug"
                required
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value.toLowerCase().trim())}
                hint={`Current URL: /book/${tenant?.slug || ''}`}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={newSlug === tenant?.slug}
                isLoading={slugSaving}
                className="gap-2"
              >
                Change Slug Identifier
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </DashboardLayout>
  );
}
