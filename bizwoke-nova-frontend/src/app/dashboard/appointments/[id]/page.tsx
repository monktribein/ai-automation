'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { appointmentsService } from '@/lib/api/services/appointments';
import { Appointment, AppointmentStatus, Slot } from '@/lib/api/types';
import { formatDateTime, formatTime } from '@/lib/utils';
import {
  ArrowLeft,
  CalendarCheck2,
  CheckCircle,
  XCircle,
  UserCheck,
  Calendar,
  Clock,
  History,
  AlertTriangle,
  UserX,
} from 'lucide-react';
import { ApiClientError } from '@/lib/api/client';

function AppointmentDetailContent() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const { toast } = useToast();

  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [historyEvents, setHistoryEvents] = useState<Array<{
    _id: string;
    type: string;
    fromStatus?: string;
    toStatus: string;
    actorType: string;
    data?: Record<string, unknown>;
    createdAt: string;
  }>>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Transition / Action Modals
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Reschedule Modal
  const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(new Date().toISOString().split('T')[0]);
  const [rescheduleSlots, setRescheduleSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const [appt, history] = await Promise.all([
        appointmentsService.getById(id),
        appointmentsService.getHistory(id),
      ]);
      setAppointment(appt);
      setHistoryEvents(history);
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Error loading appointment',
        message: err instanceof Error ? err.message : 'Not found',
      });
      router.push('/dashboard/appointments');
    } finally {
      setIsLoading(false);
    }
  }, [id, toast, router]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleTransition = async (toStatus: AppointmentStatus, reason?: string) => {
    setActionLoading(true);
    try {
      const updated = await appointmentsService.updateStatus(id, toStatus, reason);
      setAppointment(updated);
      toast({
        type: 'success',
        title: `Appointment marked as ${toStatus}`,
      });
      setCancelModalOpen(false);
      setCancelReason('');
      loadData();
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Status update failed',
        message: err instanceof ApiClientError ? err.message : 'Could not change status',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Query slots for reschedule
  useEffect(() => {
    if (!rescheduleModalOpen || !appointment?.serviceId) return;
    setSlotsLoading(true);
    appointmentsService
      .getSlots({
        serviceId: appointment.serviceId,
        from: rescheduleDate,
        staffId: appointment.staffId,
      })
      .then((slots) => setRescheduleSlots(slots))
      .catch(() => setRescheduleSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [rescheduleModalOpen, rescheduleDate, appointment]);

  const handleReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot) return;

    setActionLoading(true);
    try {
      const updated = await appointmentsService.reschedule(id, {
        startAt: selectedSlot.startAt,
        staffId: selectedSlot.staffId,
      });
      setAppointment(updated);
      toast({
        type: 'success',
        title: 'Appointment rescheduled',
        message: `New time: ${formatDateTime(selectedSlot.startAt)}`,
      });
      setRescheduleModalOpen(false);
      setSelectedSlot(null);
      loadData();
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Reschedule failed',
        message: err instanceof ApiClientError ? err.message : 'Slot may no longer be available',
      });
    } finally {
      setActionLoading(false);
    }
  };

  if (isLoading || !appointment) {
    return (
      <DashboardLayout>
        <div className="p-8 text-center text-xs text-slate-500">Loading appointment details...</div>
      </DashboardLayout>
    );
  }

  const { status } = appointment;

  return (
    <DashboardLayout
      title={`Appointment ${appointment.reference}`}
      description={`Booked via ${appointment.source} channel`}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/dashboard/appointments">
            <Button size="sm" variant="outline" className="gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </Button>
          </Link>

          {/* Valid Status Actions based on state machine */}
          {(status === 'REQUESTED' || status === 'PENDING_CONFIRMATION') && (
            <Button
              size="sm"
              variant="success"
              isLoading={actionLoading}
              onClick={() => handleTransition('CONFIRMED')}
              className="gap-1.5"
            >
              <CheckCircle className="w-3.5 h-3.5" /> Confirm
            </Button>
          )}

          {status === 'CONFIRMED' && (
            <>
              <Button
                size="sm"
                variant="primary"
                isLoading={actionLoading}
                onClick={() => handleTransition('CHECKED_IN')}
                className="gap-1.5"
              >
                <UserCheck className="w-3.5 h-3.5" /> Check In
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRescheduleModalOpen(true)}
                className="gap-1.5"
              >
                <Calendar className="w-3.5 h-3.5" /> Reschedule
              </Button>
              <Button
                size="sm"
                variant="outline"
                isLoading={actionLoading}
                onClick={() => handleTransition('NO_SHOW')}
                className="gap-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
              >
                <UserX className="w-3.5 h-3.5" /> No Show
              </Button>
            </>
          )}

          {status === 'CHECKED_IN' && (
            <Button
              size="sm"
              variant="success"
              isLoading={actionLoading}
              onClick={() => handleTransition('COMPLETED')}
              className="gap-1.5"
            >
              <CheckCircle className="w-3.5 h-3.5" /> Complete
            </Button>
          )}

          {['REQUESTED', 'PENDING_CONFIRMATION', 'CONFIRMED'].includes(status) && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => setCancelModalOpen(true)}
              className="gap-1.5"
            >
              <XCircle className="w-3.5 h-3.5" /> Cancel
            </Button>
          )}
        </div>
      }
      breadcrumbs={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Appointments', href: '/dashboard/appointments' },
        { label: appointment.reference },
      ]}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Details & Schedule */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Schedule & Reservation</CardTitle>
                <StatusBadge status={appointment.status} />
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-slate-400 font-medium">Start Time</span>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">
                  {formatDateTime(appointment.startAt, appointment.timezone)}
                </p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">End Time</span>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">
                  {formatDateTime(appointment.endAt, appointment.timezone)}
                </p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">Reserved Buffer End</span>
                <p className="text-sm font-medium text-slate-700 mt-0.5">
                  {formatDateTime(appointment.blockEndAt, appointment.timezone)}
                </p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">Seat / Capacity Slot</span>
                <p className="text-sm font-medium text-slate-700 mt-0.5">
                  Seat #{appointment.seat}
                </p>
              </div>
              {appointment.customerNotes && (
                <div className="sm:col-span-2 p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="text-slate-400 font-medium block mb-1">Customer / Operational Notes:</span>
                  <p className="text-slate-700 italic">{appointment.customerNotes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Lifecycle Event History */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <History className="w-4 h-4 text-blue-600" />
              <CardTitle>Audit & Transition Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {historyEvents.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No transition events recorded.</p>
              ) : (
                <div className="relative pl-6 space-y-4 border-l border-slate-200">
                  {historyEvents.map((ev) => (
                    <div key={ev._id} className="relative">
                      <div className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-white bg-blue-600 shadow-xs" />
                      <div className="text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{ev.type}</span>
                          <span className="text-[11px] text-slate-400">
                            {formatDateTime(ev.createdAt)}
                          </span>
                        </div>
                        <p className="text-slate-600 mt-0.5">
                          Status: <span className="font-medium text-slate-800">{ev.toStatus}</span>{' '}
                          (by {ev.actorType})
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Customer Info */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div>
                <span className="text-slate-400 font-medium">Customer ID</span>
                <p className="font-mono text-slate-800 font-medium mt-0.5">
                  {appointment.customerId}
                </p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">Reference Identifier</span>
                <p className="font-mono text-blue-600 font-bold mt-0.5">
                  {appointment.reference}
                </p>
              </div>
              <div className="pt-2">
                <Link href={`/dashboard/customers/${appointment.customerId}`}>
                  <Button size="sm" variant="outline" className="w-full">
                    View Customer Profile
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Cancellation Dialog */}
      <Dialog
        open={cancelModalOpen}
        onOpenChange={setCancelModalOpen}
        title="Cancel Appointment"
        description="Are you sure you want to cancel this appointment? This action will release the reserved time slot."
      >
        <div className="space-y-4">
          <Input
            label="Cancellation Reason (Optional)"
            placeholder="e.g. Customer requested cancellation"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setCancelModalOpen(false)}>
              Back
            </Button>
            <Button
              variant="danger"
              isLoading={actionLoading}
              onClick={() => handleTransition('CANCELLED', cancelReason)}
            >
              Confirm Cancellation
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Reschedule Dialog */}
      <Dialog
        open={rescheduleModalOpen}
        onOpenChange={setRescheduleModalOpen}
        title="Reschedule Appointment"
        description="Select a new available time slot."
      >
        <form onSubmit={handleReschedule} className="space-y-4">
          <Input
            label="New Date"
            type="date"
            required
            value={rescheduleDate}
            onChange={(e) => setRescheduleDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
          />
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 block">Available Slots</label>
            {slotsLoading ? (
              <p className="text-xs text-slate-400">Loading slots...</p>
            ) : rescheduleSlots.length === 0 ? (
              <p className="text-xs text-amber-600">No open slots on this date.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto p-1 border rounded-lg">
                {rescheduleSlots.map((slot, i) => {
                  const isSelected = selectedSlot?.startAt === slot.startAt;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      className={`px-2 py-1.5 rounded-md text-xs font-semibold border ${
                        isSelected
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {formatTime(slot.startAt)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="ghost" onClick={() => setRescheduleModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!selectedSlot} isLoading={actionLoading}>
              Confirm Reschedule
            </Button>
          </div>
        </form>
      </Dialog>
    </DashboardLayout>
  );
}

export default function AppointmentDetailPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="w-8 h-8 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
        </div>
      }
    >
      <AppointmentDetailContent />
    </React.Suspense>
  );
}
