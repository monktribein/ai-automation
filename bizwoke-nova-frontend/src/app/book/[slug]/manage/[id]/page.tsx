'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { publicBookingService } from '@/lib/api/services/public-booking';
import { Appointment, Slot } from '@/lib/api/types';
import { formatDate } from '@/lib/utils';
import {
  Calendar,
  Clock,
  User,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ArrowLeft,
  Key,
} from 'lucide-react';

function ManageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = (params?.slug as string) || '';
  const appointmentId = (params?.id as string) || '';
  const initialToken = searchParams?.get('token') || '';

  const { addToast } = useToast();
  const [token, setToken] = useState(initialToken);
  const [loading, setLoading] = useState(true);
  const [appointment, setAppointment] = useState<Partial<Appointment> | null>(null);
  const [requiresToken, setRequiresToken] = useState(false);

  // Cancellation Modal
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [canceling, setCanceling] = useState(false);

  // Reschedule Modal
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rescheduleSlots, setRescheduleSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedRescheduleSlot, setSelectedRescheduleSlot] = useState<Slot | null>(null);
  const [rescheduling, setRescheduling] = useState(false);

  const loadAppointment = useCallback(async (activeToken: string) => {
    if (!slug || !appointmentId || !activeToken) {
      setRequiresToken(true);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await publicBookingService.getAppointment(slug, appointmentId, activeToken);
      setAppointment(data);
      setRequiresToken(false);
    } catch (err: unknown) {
      setRequiresToken(true);
      addToast('error', 'Invalid or expired appointment access token.');
    } finally {
      setLoading(false);
    }
  }, [slug, appointmentId, addToast]);

  useEffect(() => {
    if (initialToken) {
      loadAppointment(initialToken);
    } else {
      setRequiresToken(true);
      setLoading(false);
    }
  }, [initialToken, loadAppointment]);

  const handleCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    try {
      setCanceling(true);
      await publicBookingService.modifyAppointment(slug, appointmentId, token, {
        action: 'cancel',
        reason: cancelReason.trim() || undefined,
      });
      addToast('success', 'Appointment successfully cancelled');
      setShowCancelModal(false);
      loadAppointment(token);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to cancel appointment';
      addToast('error', msg);
    } finally {
      setCanceling(false);
    }
  };

  const loadSlotsForReschedule = async () => {
    if (!appointment?.serviceId || !newDate) return;
    try {
      setLoadingSlots(true);
      const data = await publicBookingService.getSlots(slug, {
        serviceId: appointment.serviceId,
        from: `${newDate}T00:00:00.000Z`,
        to: `${newDate}T23:59:59.999Z`,
      });
      setRescheduleSlots(data || []);
    } catch (err: unknown) {
      setRescheduleSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    if (showRescheduleModal) {
      loadSlotsForReschedule();
    }
  }, [showRescheduleModal, newDate]);

  const handleReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedRescheduleSlot) {
      addToast('error', 'Please choose a new time slot');
      return;
    }

    try {
      setRescheduling(true);
      await publicBookingService.modifyAppointment(slug, appointmentId, token, {
        action: 'reschedule',
        startAt: selectedRescheduleSlot.startAt,
        staffId: selectedRescheduleSlot.staffId,
      });
      addToast('success', 'Appointment successfully rescheduled');
      setShowRescheduleModal(false);
      loadAppointment(token);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to reschedule appointment';
      addToast('error', msg);
    } finally {
      setRescheduling(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Skeleton className="h-64 max-w-md w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Link href={`/book/${slug}`} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Booking Page
          </Link>
          <span className="text-xs font-mono text-slate-400">Manage Portal</span>
        </div>

        {requiresToken ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="w-4 h-4 text-blue-600" />
                Access Verification Required
              </CardTitle>
              <CardDescription className="text-xs">
                To manage, reschedule, or cancel this appointment, please enter the access token from your confirmation email or WhatsApp notification.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                label="Appointment Access Token"
                placeholder="Paste your manage token here..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <Button
                onClick={() => loadAppointment(token)}
                disabled={!token.trim()}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs"
              >
                Access Appointment
              </Button>
            </CardContent>
          </Card>
        ) : appointment ? (
          <Card>
            <CardHeader className="border-b border-slate-100 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">Appointment Reference</span>
                  <CardTitle className="text-lg font-mono font-bold text-slate-900">{appointment.reference}</CardTitle>
                </div>
                <Badge
                  variant={
                    appointment.status === 'CONFIRMED'
                      ? 'success'
                      : appointment.status === 'CANCELLED'
                      ? 'destructive'
                      : 'outline'
                  }
                >
                  {appointment.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-5">
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">Scheduled Time</span>
                  <span className="font-semibold text-slate-900">
                    {appointment.startAt && formatDate(appointment.startAt, { includeTime: true })}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">Duration</span>
                  <span className="font-medium text-slate-800">
                    {appointment.startAt && appointment.endAt
                      ? `${Math.round((new Date(appointment.endAt).getTime() - new Date(appointment.startAt).getTime()) / 60000)} mins`
                      : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">Customer Name</span>
                  <span className="font-medium text-slate-800">{appointment.customer?.name}</span>
                </div>
              </div>

              {appointment.status !== 'CANCELLED' && appointment.status !== 'COMPLETED' && (
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowRescheduleModal(true)}
                    className="flex-1 text-xs gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-blue-600" />
                    Reschedule
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowCancelModal(true)}
                    className="flex-1 text-xs gap-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Cancel Appointment
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* Cancel Modal */}
        <Dialog
          isOpen={showCancelModal}
          onClose={() => setShowCancelModal(false)}
          title="Cancel Appointment"
        >
          <form onSubmit={handleCancel} className="space-y-4">
            <p className="text-xs text-slate-600">
              Are you sure you want to cancel appointment <strong className="font-mono">{appointment?.reference}</strong>?
            </p>
            <Input
              label="Reason for Cancellation (Optional)"
              placeholder="e.g. Rescheduling conflict or unexpected event"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            <div className="flex justify-end gap-2.5 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowCancelModal(false)}>
                Back
              </Button>
              <Button
                type="submit"
                disabled={canceling}
                className="bg-rose-600 hover:bg-rose-700 text-white min-w-[120px]"
              >
                {canceling ? 'Cancelling...' : 'Confirm Cancellation'}
              </Button>
            </div>
          </form>
        </Dialog>

        {/* Reschedule Modal */}
        <Dialog
          isOpen={showRescheduleModal}
          onClose={() => setShowRescheduleModal(false)}
          title="Reschedule Appointment"
        >
          <form onSubmit={handleReschedule} className="space-y-4">
            <Input
              label="Select New Date"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />

            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-slate-700 block">Available Time Slots</span>
              {loadingSlots ? (
                <div className="grid grid-cols-3 gap-2">
                  <Skeleton className="h-9 w-full rounded-md" />
                  <Skeleton className="h-9 w-full rounded-md" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              ) : rescheduleSlots.length === 0 ? (
                <p className="text-xs text-slate-500 py-3 text-center bg-slate-50 rounded-lg">
                  No slots available on this date.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1">
                  {rescheduleSlots.map((s, idx) => {
                    const timeStr = new Date(s.startAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    const isSelected = selectedRescheduleSlot?.startAt === s.startAt;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedRescheduleSlot(s)}
                        className={`py-1.5 px-2 text-xs font-semibold rounded-md border ${
                          isSelected
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-blue-400'
                        }`}
                      >
                        {timeStr}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowRescheduleModal(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={rescheduling || !selectedRescheduleSlot}
                className="bg-blue-600 hover:bg-blue-700 text-white min-w-[120px]"
              >
                {rescheduling ? 'Rescheduling...' : 'Confirm New Time'}
              </Button>
            </div>
          </form>
        </Dialog>
      </div>
    </div>
  );
}

export default function PublicManageAppointmentPage() {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="w-8 h-8 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
        </div>
      }
    >
      <ManageContent />
    </React.Suspense>
  );
}
