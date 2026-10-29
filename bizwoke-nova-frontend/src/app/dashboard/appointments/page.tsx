'use client';

import React, { useEffect, useState, useCallback, useTransition } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { appointmentsService } from '@/lib/api/services/appointments';
import { servicesService } from '@/lib/api/services/services';
import { staffService } from '@/lib/api/services/staff';
import { Appointment, AppointmentStatus, Service, Staff, Slot } from '@/lib/api/types';
import { formatDateTime, formatTime, formatDate } from '@/lib/utils';
import { CalendarPlus, Search, Filter, CalendarCheck2, ArrowLeft, ArrowRight, Clock, AlertCircle } from 'lucide-react';
import { ApiClientError } from '@/lib/api/client';

function AppointmentsContent() {
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [serviceFilter, setServiceFilter] = useState<string>('');
  const [staffFilter, setStaffFilter] = useState<string>('');

  // Booking Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [bookingServiceId, setBookingServiceId] = useState('');
  const [bookingStaffId, setBookingStaffId] = useState('');
  const [bookingDate, setBookingDate] = useState(new Date().toISOString().split('T')[0]);
  const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  // Customer form inside modal
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      setModalOpen(true);
    }
  }, [searchParams]);

  // Load services and staff for dropdowns
  useEffect(() => {
    servicesService.list({ limit: 100, status: 'ACTIVE' }).then((res) => setServices(res.items)).catch(() => {});
    staffService.list({ limit: 100, status: 'ACTIVE' }).then((res) => setStaffList(res.items)).catch(() => {});
  }, []);

  const loadAppointments = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await appointmentsService.list({
        page,
        limit: 15,
        status: statusFilter ? (statusFilter as AppointmentStatus) : undefined,
        serviceId: serviceFilter || undefined,
        staffId: staffFilter || undefined,
        sort: '-startAt',
      });
      setAppointments(res.items);
      setTotalPages(res.meta?.totalPages || 1);
      setTotalCount(res.meta?.total || res.items.length);
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Failed to load appointments',
        message: err instanceof Error ? err.message : 'Please check your connection.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [page, statusFilter, serviceFilter, staffFilter, toast]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  // Fetch available slots when service, date, or staff changes in modal
  useEffect(() => {
    if (!bookingServiceId || !bookingDate || !modalOpen) return;

    let active = true;
    setSlotsLoading(true);
    setSlotsError(null);
    setSelectedSlot(null);

    appointmentsService
      .getSlots({
        serviceId: bookingServiceId,
        from: bookingDate,
        staffId: bookingStaffId || undefined,
      })
      .then((slots) => {
        if (active) {
          setAvailableSlots(slots);
        }
      })
      .catch((err) => {
        if (active) {
          setSlotsError(err instanceof Error ? err.message : 'Unable to query slots.');
          setAvailableSlots([]);
        }
      })
      .finally(() => {
        if (active) setSlotsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [bookingServiceId, bookingDate, bookingStaffId, modalOpen]);

  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot) {
      setCreateError('Please select an available time slot.');
      return;
    }

    setCreateError(null);
    setIsSubmitting(true);

    const idempotencyKey = `staff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      await appointmentsService.create(
        {
          serviceId: bookingServiceId,
          staffId: selectedSlot.staffId || bookingStaffId || undefined,
          startAt: selectedSlot.startAt,
          customer: {
            name: customerName,
            email: customerEmail.trim() || undefined,
            phone: customerPhone.trim() || undefined,
          },
          customerNotes: customerNotes.trim() || undefined,
        },
        idempotencyKey
      );

      toast({
        type: 'success',
        title: 'Appointment booked successfully',
        message: `Reserved for ${customerName} at ${formatDateTime(selectedSlot.startAt)}`,
      });

      setModalOpen(false);
      // Reset form
      setCustomerName('');
      setCustomerEmail('');
      setCustomerPhone('');
      setCustomerNotes('');
      setSelectedSlot(null);
      loadAppointments();
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setCreateError(err.message);
      } else {
        setCreateError('Failed to commit appointment booking.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DashboardLayout
      title="Appointment Management"
      description="Book, track, confirm, check in, complete, and reschedule appointments"
      actions={
        <Button onClick={() => setModalOpen(true)} size="sm" variant="primary" className="gap-1.5 shadow-xs">
          <CalendarPlus className="w-4 h-4" /> New Appointment
        </Button>
      }
      breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Appointments' }]}
    >
      {/* Filters bar */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select
              label="Filter by Status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Statuses' },
                { value: 'CONFIRMED', label: 'Confirmed' },
                { value: 'PENDING_CONFIRMATION', label: 'Pending Confirmation' },
                { value: 'REQUESTED', label: 'Requested' },
                { value: 'CHECKED_IN', label: 'Checked In' },
                { value: 'COMPLETED', label: 'Completed' },
                { value: 'CANCELLED', label: 'Cancelled' },
                { value: 'NO_SHOW', label: 'No Show' },
              ]}
            />
            <Select
              label="Filter by Service"
              value={serviceFilter}
              onChange={(e) => {
                setServiceFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Services' },
                ...services.map((s) => ({ value: s._id, label: s.name })),
              ]}
            />
            <Select
              label="Filter by Staff"
              value={staffFilter}
              onChange={(e) => {
                setStaffFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Staff Members' },
                ...staffList.map((st) => ({ value: st._id, label: st.name })),
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {/* Appointments List */}
      {isLoading ? (
        <TableSkeleton rows={8} columns={6} />
      ) : appointments.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck2 className="w-8 h-8" />}
          title="No appointments found"
          description={
            statusFilter || serviceFilter || staffFilter
              ? 'No appointments matched your selected filters.'
              : 'There are currently no recorded appointments for this business.'
          }
          actionLabel="Book Appointment"
          onAction={() => setModalOpen(true)}
        />
      ) : (
        <div className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Start Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {appointments.map((appt) => (
                <TableRow key={appt._id}>
                  <TableCell className="font-mono font-bold text-xs text-slate-900">
                    {appt.reference}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-slate-800">
                      {formatDateTime(appt.startAt, appt.timezone)}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Duration: {formatTime(appt.startAt, appt.timezone)} – {formatTime(appt.endAt, appt.timezone)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={appt.status} />
                  </TableCell>
                  <TableCell className="text-xs uppercase font-semibold text-slate-500">
                    {appt.source}
                  </TableCell>
                  <TableCell className="text-xs text-slate-700">
                    {appt.customer?.name || (appt.customerId ? `Customer #${appt.customerId.slice(-4)}` : 'Guest')}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/dashboard/appointments/${appt._id}`}>
                      <Button size="sm" variant="outline" className="text-xs">
                        View
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="flex items-center justify-between text-xs text-slate-500 px-2 py-3 border-t border-slate-200">
            <div>
              Showing {appointments.length} of {totalCount} records
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Previous
              </Button>
              <span className="font-medium px-2">
                Page {page} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="gap-1"
              >
                Next <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* New Appointment Modal with Real Backend Slot Allocation */}
      <Dialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Schedule New Appointment"
        description="Select service, date, and verified availability slot from the backend schedule engine."
        maxWidth="lg"
      >
        {createError && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{createError}</span>
          </div>
        )}

        <form onSubmit={handleCreateAppointment} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Service *"
              required
              value={bookingServiceId}
              onChange={(e) => setBookingServiceId(e.target.value)}
              options={[
                { value: '', label: 'Select a Service' },
                ...services.map((s) => ({
                  value: s._id,
                  label: `${s.name} (${s.durationMinutes} min)`,
                })),
              ]}
            />
            <Select
              label="Preferred Staff Member (Optional)"
              value={bookingStaffId}
              onChange={(e) => setBookingStaffId(e.target.value)}
              options={[
                { value: '', label: 'Any Eligible Staff' },
                ...staffList.map((st) => ({ value: st._id, label: st.name })),
              ]}
            />
          </div>

          <Input
            label="Appointment Date *"
            type="date"
            required
            value={bookingDate}
            onChange={(e) => setBookingDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
          />

          {/* Slots selection */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 tracking-wide">
              Available Time Slots *
            </label>
            {!bookingServiceId ? (
              <p className="text-xs text-slate-400 italic">Please select a service first.</p>
            ) : slotsLoading ? (
              <div className="flex items-center gap-2 py-3 text-xs text-slate-500">
                <Clock className="w-4 h-4 animate-spin text-blue-600" /> Querying verified schedule slots...
              </div>
            ) : slotsError ? (
              <p className="text-xs text-rose-600 font-medium">{slotsError}</p>
            ) : availableSlots.length === 0 ? (
              <p className="text-xs text-amber-600 font-medium">
                No slots available on {bookingDate} for this service. Try another date or staff member.
              </p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-36 overflow-y-auto p-1 border rounded-lg">
                {availableSlots.map((slot, idx) => {
                  const isSelected = selectedSlot?.startAt === slot.startAt && selectedSlot?.staffId === slot.staffId;
                  return (
                    <button
                      type="button"
                      key={idx}
                      onClick={() => setSelectedSlot(slot)}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-semibold border transition-all ${
                        isSelected
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
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

          {/* Customer Details */}
          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
              Customer Information
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Customer Full Name *"
                required
                placeholder="Ravi Kumar"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
              <Input
                label="Email"
                type="email"
                placeholder="ravi@example.com"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
              <Input
                label="Phone Number"
                type="tel"
                placeholder="+919876543210"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
              <Input
                label="Operational Notes"
                placeholder="Special requests or internal notes"
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!selectedSlot || !customerName}
              isLoading={isSubmitting}
            >
              Confirm Booking
            </Button>
          </div>
        </form>
      </Dialog>
    </DashboardLayout>
  );
}

export default function AppointmentsPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="w-8 h-8 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
        </div>
      }
    >
      <AppointmentsContent />
    </React.Suspense>
  );
}
