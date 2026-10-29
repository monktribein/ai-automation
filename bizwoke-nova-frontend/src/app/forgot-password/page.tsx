'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { authService } from '@/lib/api/services/auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await authService.forgotPassword(email);
    } finally {
      // Backend contract always returns 202 to avoid account enumeration
      setIsLoading(false);
      setSubmitted(true);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-extrabold text-xl shadow-md shadow-blue-500/30">
            B
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
            Reset your password
          </h2>
          <p className="mt-1.5 text-xs text-slate-500">
            Enter your account email to receive a secure password reset link or token
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-8 shadow-xs">
          {submitted ? (
            <div className="space-y-5 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Check your email</h3>
                <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
                  If an account exists with <span className="font-semibold text-slate-700">{email}</span>, we have sent instructions to reset your password.
                </p>
              </div>
              <div className="pt-2">
                <Link href="/reset-password">
                  <Button variant="outline" className="w-full">
                    Enter Reset Token
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Email address"
                type="email"
                required
                placeholder="name@business.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                icon={<Mail className="w-4 h-4" />}
              />

              <Button type="submit" variant="primary" className="w-full" isLoading={isLoading}>
                Send Instructions
              </Button>
            </form>
          )}

          <div className="mt-6 border-t border-slate-100 pt-5 text-center">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
