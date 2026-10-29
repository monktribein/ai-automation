'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { businessService } from '@/lib/api/services/business';
import { ApiClientError } from '@/lib/api/client';
import type { BusinessSettings, MessageTextKey, WhatsAppAssistantMode } from '@/lib/api/types';
import { Save, MessageSquare } from 'lucide-react';

const PLACEHOLDERS = ['{name}', '{service}', '{staff}', '{date}', '{time}', '{reference}', '{business}'];

const MESSAGE_FIELDS: { key: MessageTextKey; label: string; example: string }[] = [
  {
    key: 'appointment_confirmation',
    label: 'Booking confirmed',
    example: 'Hi {name}, your {service} appointment is confirmed for {date} at {time}. Ref: {reference}. See you soon! – {business}',
  },
  {
    key: 'appointment_reminder',
    label: 'Reminder before the appointment',
    example: 'Reminder: {name}, your {service} is on {date} at {time}. Reply here if you need to change it.',
  },
  {
    key: 'appointment_cancelled',
    label: 'Appointment cancelled',
    example: 'Hi {name}, your appointment {reference} on {date} has been cancelled.',
  },
  {
    key: 'appointment_rescheduled',
    label: 'Appointment rescheduled',
    example: 'Hi {name}, your {service} has been moved to {date} at {time}.',
  },
];

const REMINDER_OPTIONS = [
  { value: '0', label: 'No reminder' },
  { value: '60', label: '1 hour before' },
  { value: '120', label: '2 hours before' },
  { value: '360', label: '6 hours before' },
  { value: '1440', label: '24 hours before (recommended)' },
  { value: '2880', label: '2 days before' },
];

const MODE_OPTIONS = [
  { value: 'menu', label: 'Booking menu bot (customer replies with numbers)' },
  { value: 'ai', label: 'AI assistant (needs an AI key on the server)' },
  { value: 'off', label: 'Off: my team replies from Conversations' },
];

/** Customer message texts, reminder timing and the WhatsApp auto-reply mode. */
export function MessagesSettingsTab({ settings, onSaved }: { settings: BusinessSettings; onSaved: () => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [texts, setTexts] = useState<Partial<Record<MessageTextKey, string>>>(settings.notifications?.texts ?? {});
  const [reminder, setReminder] = useState(String(settings.notifications?.reminderLeadMinutes ?? 1440));
  const [mode, setMode] = useState<WhatsAppAssistantMode>(settings.whatsappAssistant?.mode ?? 'menu');
  const [welcomeText, setWelcomeText] = useState(settings.whatsappAssistant?.welcomeText ?? '');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await businessService.updateSettings({
        notifications: {
          reminderLeadMinutes: Number(reminder),
          texts: Object.fromEntries(MESSAGE_FIELDS.map((f) => [f.key, (texts[f.key] ?? '').trim()])),
        },
        whatsappAssistant: { mode, welcomeText: welcomeText.trim() },
      });
      toast({ type: 'success', title: 'Messages saved', message: 'New bookings will use these texts.' });
      onSaved();
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Could not save messages',
        message: err instanceof ApiClientError ? err.message : 'Permission business:manage required',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Customer messages</CardTitle>
          <CardDescription>
            Sent automatically on WhatsApp (when the customer agreed) and email. Leave a box empty to use the default
            text. You can use: {PLACEHOLDERS.join(' ')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {MESSAGE_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">{f.label}</label>
                <button
                  type="button"
                  className="text-[11px] text-blue-600 hover:underline"
                  onClick={() => setTexts((t) => ({ ...t, [f.key]: f.example }))}
                >
                  Use example
                </button>
              </div>
              <textarea
                rows={3}
                maxLength={1000}
                value={texts[f.key] ?? ''}
                onChange={(e) => setTexts((t) => ({ ...t, [f.key]: e.target.value }))}
                placeholder={`Default text is used when empty. Example: ${f.example}`}
                className="block w-full rounded-lg border border-slate-300 bg-white p-3 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          ))}

          <Select
            label="When to send the reminder"
            value={reminder}
            onChange={(e) => setReminder(e.target.value)}
            options={REMINDER_OPTIONS}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-emerald-600" />
            WhatsApp auto-reply
          </CardTitle>
          <CardDescription>
            What happens when a customer messages your WhatsApp number (for example &quot;hi&quot;).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            label="Reply mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as WhatsAppAssistantMode)}
            options={MODE_OPTIONS}
          />
          {mode === 'menu' && (
            <>
              <Input
                label="Welcome message (optional)"
                maxLength={500}
                placeholder="e.g. Namaste! Welcome to Glow Studio 🌸"
                value={welcomeText}
                onChange={(e) => setWelcomeText(e.target.value)}
                helperText="Shown above the menu. The menu options (Book / My appointments / Talk to team) are added automatically."
              />
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 whitespace-pre-line">
                {`${welcomeText.trim() || `Welcome to ${settings.profile?.displayName ?? 'your business'}! 👋 How can we help you today?`}

Reply with a number:
1. Book an appointment
2. My upcoming appointments
3. Talk to our team`}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Button type="submit" variant="primary" className="gap-2" isLoading={saving}>
        <Save className="w-4 h-4" /> Save messages
      </Button>
    </form>
  );
}
