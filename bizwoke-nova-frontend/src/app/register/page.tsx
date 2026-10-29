'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Eye, EyeOff, Lock, Mail, User, Building, Phone, Globe, AlertCircle } from 'lucide-react';
import { ApiClientError } from '@/lib/api/client';

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();

  // User fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Business fields
  const [businessName, setBusinessName] = useState('');
  const [businessSlug, setBusinessSlug] = useState('');
  const [category, setCategory] = useState('clinic');
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'
  );

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-generate slug from business name
  const handleBusinessNameChange = (val: string) => {
    setBusinessName(val);
    if (!businessSlug || businessSlug === slugify(businessName)) {
      setBusinessSlug(slugify(val));
    }
  };

  function slugify(text: string) {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 10 || !/\d/.test(password) || !/[a-zA-Z]/.test(password)) {
      setError('Password must be at least 10 characters long and contain both letters and digits.');
      return;
    }

    setIsLoading(true);

    try {
      await register({
        name,
        email,
        phone: phone.trim() || undefined,
        password,
        business: {
          name: businessName,
          slug: businessSlug,
          timezone,
          locale: 'en',
          category,
        },
      });
      router.push('/dashboard');
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to create account. Please check the information provided and try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-xl space-y-8">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-extrabold text-xl shadow-md shadow-blue-500/30">
            B
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
            Create your Bizwoke Nova Workspace
          </h2>
          <p className="mt-1.5 text-xs text-slate-500">
            Provision a multi-tenant workspace with AI appointment booking and customer automation
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-8 shadow-xs">
          {error && (
            <div className="mb-6 flex items-start gap-2.5 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-3">
                1. Account Administrator
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <Input
                  label="Full Name"
                  required
                  placeholder="Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  icon={<User className="w-4 h-4" />}
                />
                <Input
                  label="Email Address"
                  type="email"
                  required
                  placeholder="admin@business.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  icon={<Mail className="w-4 h-4" />}
                />
                <Input
                  label="Phone Number (Optional)"
                  type="tel"
                  placeholder="+919876543210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  icon={<Phone className="w-4 h-4" />}
                />
                <div className="relative">
                  <Input
                    label="Password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Min 10 chars (letters & numbers)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    icon={<Lock className="w-4 h-4" />}
                    hint="Minimum 10 chars, letters and digits"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-8 text-slate-400 hover:text-slate-600"
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-3">
                2. Business Profile
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <Input
                  label="Business / Organization Name"
                  required
                  placeholder="Apex Dental Clinic"
                  value={businessName}
                  onChange={(e) => handleBusinessNameChange(e.target.value)}
                  icon={<Building className="w-4 h-4" />}
                />
                <Input
                  label="Public Slug (URL)"
                  required
                  placeholder="apex-dental"
                  value={businessSlug}
                  onChange={(e) => setBusinessSlug(e.target.value.toLowerCase().trim())}
                  hint="Your public booking URL will be /book/{slug}"
                />
                <Select
                  label="Business Category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  options={[
                    { value: 'clinic', label: 'Healthcare & Clinic' },
                    { value: 'salon', label: 'Salon & Spa' },
                    { value: 'consulting', label: 'Consulting & Legal' },
                    { value: 'coaching', label: 'Education & Coaching' },
                    { value: 'hospitality', label: 'Hotel & Hospitality' },
                    { value: 'other', label: 'Other Service Business' },
                  ]}
                />
                <Input
                  label="Operating Timezone"
                  required
                  placeholder="Asia/Kolkata"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  icon={<Globe className="w-4 h-4" />}
                  hint="All slot availability will respect this timezone"
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full mt-4"
              size="lg"
              isLoading={isLoading}
            >
              Provision Business & Continue
            </Button>
          </form>

          <div className="mt-6 border-t border-slate-100 pt-5 text-center text-xs text-slate-500">
            Already have an account?{' '}
            <Link href="/login" className="font-semibold text-blue-600 hover:text-blue-700">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
