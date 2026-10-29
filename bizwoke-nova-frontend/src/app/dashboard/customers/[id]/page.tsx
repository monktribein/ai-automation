'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { customersService } from '@/lib/api/services/customers';
import { Customer, Appointment } from '@/lib/api/types';
import { formatDateTime, formatDate } from '@/lib/utils';
import { ArrowLeft, User, Mail, Phone, CalendarCheck2, ShieldCheck, Save } from 'lucide-react';

function CustomerDetailContent() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const { toast } = useToast();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Editable fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [consentEmail, setConsentEmail] = useState(true);
  const [consentWhatsApp, setConsentWhatsApp] = useState(true);

  const loadCustomer = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const [c, apptsRes] = await Promise.all([
        customersService.getById(id),
        customersService.getAppointments(id),
      ]);
      setCustomer(c);
      setName(c.name || '');
      setEmail(c.email || '');
      setPhone(c.phone || '');
      setNotes(c.notes || '');
      setConsentEmail(c.consent?.email ?? true);
      setConsentWhatsApp(c.consent?.whatsapp ?? true);
      setAppointments(apptsRes.items);
    } catch {
      toast({
        type: 'error',
        title: 'Customer not found',
      });
      router.push('/dashboard/customers');
    } finally {
      setIsLoading(false);
    }
  }, [id, toast, router]);

  useEffect(() => {
    loadCustomer();
  }, [loadCustomer]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const updated = await customersService.update(id, {
        name,
        email: email || undefined,
        phone: phone || undefined,
        notes: notes || undefined,
        consent: { email: consentEmail, whatsapp: consentWhatsApp },
      });
      setCustomer(updated);
      toast({
        type: 'success',
        title: 'Customer details updated',
      });
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Update failed',
        message: err instanceof Error ? err.message : 'Please check permissions.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !customer) {
    return (
      <DashboardLayout>
        <div className="p-8 text-center text-xs text-slate-500">Loading customer profile...</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      title={customer.name}
      description={`Customer record #${customer._id.slice(-6)}`}
      actions={
        <Link href="/dashboard/customers">
          <Button size="sm" variant="outline" className="gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Customers
          </Button>
        </Link>
      }
      breadcrumbs={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Customers', href: '/dashboard/customers' },
        { label: customer.name },
      ]}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Editable Customer Profile Form */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Profile & Consent</CardTitle>
                <StatusBadge status={customer.status} />
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdate} className="space-y-4">
                <Input
                  label="Customer Name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Input
                  label="Email Address"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  icon={<Mail className="w-4 h-4" />}
                />
                <Input
                  label="Phone Number"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  icon={<Phone className="w-4 h-4" />}
                />
                <Input
                  label="Operational Notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />

                {/* Consent checkboxes */}
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <p className="text-xs font-semibold text-slate-700">Communication Consent</p>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={consentEmail}
                      onChange={(e) => setConsentEmail(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    Email notifications allowed
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={consentWhatsApp}
                      onChange={(e) => setConsentWhatsApp(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    WhatsApp messages allowed
                  </label>
                </div>

                <Button type="submit" variant="primary" className="w-full gap-2 mt-4" isLoading={isSaving}>
                  <Save className="w-4 h-4" /> Save Changes
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Appointment History */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Appointment History</CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">All reservations associated with this customer</p>
              </div>
              <Link href={`/dashboard/appointments?create=true`}>
                <Button size="sm" variant="outline" className="text-xs">
                  New Appointment
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {appointments.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400">
                  No appointment history for this customer.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {appointments.map((a) => (
                      <TableRow key={a._id}>
                        <TableCell className="font-mono text-xs font-bold text-slate-900">
                          {a.reference}
                        </TableCell>
                        <TableCell className="text-xs text-slate-700">
                          {formatDateTime(a.startAt, a.timezone)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={a.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/dashboard/appointments/${a._id}`}>
                            <Button size="sm" variant="ghost" className="text-xs">
                              View
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function CustomerDetailPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="w-8 h-8 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
        </div>
      }
    >
      <CustomerDetailContent />
    </React.Suspense>
  );
}
