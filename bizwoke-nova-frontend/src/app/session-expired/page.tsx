'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Clock, LogIn } from 'lucide-react';

export default function SessionExpiredPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xs space-y-5">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 border border-amber-200">
          <Clock className="w-7 h-7" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">Session Expired</h2>
          <p className="mt-2 text-xs text-slate-500 leading-relaxed">
            Your authenticated session has expired or was revoked. Please sign in again to continue working in your workspace.
          </p>
        </div>
        <Link href="/login" className="block w-full">
          <Button variant="primary" className="w-full gap-2">
            <LogIn className="w-4 h-4" /> Sign In Again
          </Button>
        </Link>
      </div>
    </div>
  );
}
