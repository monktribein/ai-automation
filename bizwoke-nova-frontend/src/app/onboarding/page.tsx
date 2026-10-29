'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth/auth-context';
import { businessService } from '@/lib/api/services/business';
import { servicesService } from '@/lib/api/services/services';
import {
  Building2,
  Clock,
  Sparkles,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  MapPin,
  Briefcase,
} from 'lucide-react';

export default function OnboardingPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const { activeTenant } = useAuth();

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Step 1: Business Profile
  const [displayName, setDisplayName] = useState('');
  const [category, setCategory] = useState('CLINIC');
  const [description, setDescription] = useState('');

  // Step 2: Contact & Location
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');

  // Step 3: Initial Service
  const [serviceName, setServiceName] = useState('Initial Consultation');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [priceInr, setPriceInr] = useState('500');

  const handleFinish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      addToast('error', 'Business display name is required');
      setStep(1);
      return;
    }

    try {
      setSaving(true);
      // 1. Update business settings
      await businessService.updateSettings({
        profile: {
          displayName: displayName.trim(),
          category,
          description: description.trim() || undefined,
          address: address.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
        },
        timezone,
      });

      // 2. Provision initial service if provided
      if (serviceName.trim()) {
        await servicesService.create({
          name: serviceName.trim(),
          durationMinutes: Number(durationMinutes) || 30,
          price: Number(priceInr) || 0,
          publiclyBookable: true,
        }).catch(() => {
          // Non-blocking if service creation fails
        });
      }

      addToast('success', 'Business setup completed! Welcome to Bizwoke Nova.');
      router.push('/dashboard');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save onboarding configuration';
      addToast('error', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-xl w-full space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-1.5">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-lg shadow-sm shadow-blue-500/25">
            B
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Setup Your Business</h1>
          <p className="text-xs text-slate-500">
            Configure your business profile, operating preferences, and initial service catalog.
          </p>
        </div>

        {/* Progress Bar */}
        <div className="flex items-center justify-between px-4 text-xs">
          <div className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] ${step >= 1 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
              1
            </span>
            <span className={step === 1 ? 'font-semibold text-slate-900' : 'text-slate-500'}>Profile</span>
          </div>
          <div className="h-0.5 flex-1 mx-3 bg-slate-200" />
          <div className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] ${step >= 2 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
              2
            </span>
            <span className={step === 2 ? 'font-semibold text-slate-900' : 'text-slate-500'}>Contact</span>
          </div>
          <div className="h-0.5 flex-1 mx-3 bg-slate-200" />
          <div className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] ${step >= 3 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
              3
            </span>
            <span className={step === 3 ? 'font-semibold text-slate-900' : 'text-slate-500'}>First Service</span>
          </div>
        </div>

        {/* Wizard Cards */}
        <Card>
          {step === 1 && (
            <div>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-blue-600" />
                  Business Identity
                </CardTitle>
                <CardDescription className="text-xs">
                  How your customers and patients will recognize your organization.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  label="Business Display Name"
                  placeholder="e.g. City Wellness Clinic"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />

                <Select
                  label="Industry Category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  options={[
                    { value: 'CLINIC', label: 'Healthcare, Clinic or Dental' },
                    { value: 'SALON', label: 'Salon, Spa & Beauty' },
                    { value: 'CONSULTING', label: 'Consulting, Legal & Finance' },
                    { value: 'COACHING', label: 'Education, Fitness & Coaching' },
                    { value: 'HOTEL', label: 'Hospitality & Travel' },
                    { value: 'GENERAL', label: 'General Service Business' },
                  ]}
                />

                <Input
                  label="Short Description"
                  placeholder="Brief description for public booking page"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />

                <div className="flex justify-end pt-3">
                  <Button
                    onClick={() => {
                      if (!displayName.trim()) {
                        addToast('error', 'Please enter your business name');
                        return;
                      }
                      setStep(2);
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
                  >
                    Next: Contact Details
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </div>
          )}

          {step === 2 && (
            <div>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-600" />
                  Location & Contact
                </CardTitle>
                <CardDescription className="text-xs">
                  Contact points for client communications and appointment notifications.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  label="Physical Address / Suite"
                  placeholder="e.g. 102 Metro Plaza, MG Road"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    label="Customer Phone"
                    placeholder="e.g. +91 9876543210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                  <Input
                    label="Customer Email"
                    placeholder="e.g. contact@business.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <Input
                  label="Operating Timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  helperText="All calendar slots and bookings will be locked to this timezone"
                />

                <div className="flex justify-between pt-3">
                  <Button variant="outline" onClick={() => setStep(1)} className="gap-2">
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </Button>
                  <Button
                    onClick={() => setStep(3)}
                    className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
                  >
                    Next: First Service
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </div>
          )}

          {step === 3 && (
            <form onSubmit={handleFinish}>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-blue-600" />
                  Create Your First Service
                </CardTitle>
                <CardDescription className="text-xs">
                  Add an initial bookable offering so customers can begin booking immediately.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  label="Service Name"
                  placeholder="e.g. General Consultation"
                  required
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    label="Duration (Minutes)"
                    type="number"
                    required
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(e.target.value)}
                  />
                  <Input
                    label="Price (INR)"
                    type="number"
                    required
                    value={priceInr}
                    onChange={(e) => setPriceInr(e.target.value)}
                  />
                </div>

                <div className="flex justify-between pt-3">
                  <Button type="button" variant="outline" onClick={() => setStep(2)} className="gap-2">
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </Button>
                  <Button
                    type="submit"
                    disabled={saving}
                    className="bg-blue-600 hover:bg-blue-700 text-white min-w-[140px]"
                  >
                    {saving ? 'Completing Setup...' : 'Complete & Launch'}
                  </Button>
                </div>
              </CardContent>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
