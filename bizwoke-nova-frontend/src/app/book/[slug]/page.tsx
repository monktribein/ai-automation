'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { publicBookingService, PublicBusinessInfo } from '@/lib/api/services/public-booking';
import { Service, Staff, Slot } from '@/lib/api/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Calendar,
  Clock,
  User,
  CheckCircle2,
  MapPin,
  Phone,
  Mail,
  ChevronRight,
  ChevronLeft,
  CalendarCheck,
  AlertCircle,
  Copy,
  ExternalLink,
  Sparkles,
} from 'lucide-react';

function BookingContent() {
  const params = useParams();
  const router = useRouter();
  const slug = (params?.slug as string) || '';
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [business, setBusiness] = useState<PublicBusinessInfo | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staffList, setStaffList] = useState<Array<Pick<Staff, '_id' | 'name' | 'title' | 'bio'>>>([]);
  const [notFound, setNotFound] = useState(false);

  // Booking Flow Steps: 1: Service, 2: Staff, 3: Slot, 4: Details, 5: Confirmed
  const [step, setStep] = useState(1);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  // Customer Form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [consentWhatsapp, setConsentWhatsapp] = useState(true);
  const [consentEmail, setConsentEmail] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Confirmed Appointment
  const [confirmedBooking, setConfirmedBooking] = useState<{
    reference?: string;
    id?: string;
    manageToken?: string;
    startAt?: string;
  } | null>(null);

  // Load Business Profile
  useEffect(() => {
    if (!slug) return;
    const fetchBusiness = async () => {
      try {
        setLoading(true);
        const [info, srvs] = await Promise.all([
          publicBookingService.getBusinessInfo(slug),
          publicBookingService.getServices(slug),
        ]);
        setBusiness(info);
        setServices(srvs || []);
      } catch (err: unknown) {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetchBusiness();
  }, [slug]);

  // Load Staff for Selected Service
  useEffect(() => {
    if (!slug || !selectedService) return;
    publicBookingService
      .getStaff(slug, selectedService.id)
      .then((res) => setStaffList(res || []))
      .catch(() => setStaffList([]));
  }, [slug, selectedService]);

  // Load Slots when Date, Service, or Staff changes
  const loadSlots = useCallback(async () => {
    if (!slug || !selectedService || !selectedDate) return;
    try {
      setLoadingSlots(true);
      setSelectedSlot(null);
      const srvId = selectedService.id || selectedService._id || '';
      const slotsData = await publicBookingService.getSlots(slug, {
        serviceId: srvId,
        from: `${selectedDate}T00:00:00.000Z`,
        to: `${selectedDate}T23:59:59.999Z`,
        staffId: selectedStaffId || undefined,
      });
      setSlots(slotsData || []);
    } catch (err: unknown) {
      setSlots([]);
      addToast('error', 'Failed to fetch available time slots');
    } finally {
      setLoadingSlots(false);
    }
  }, [slug, selectedService, selectedDate, selectedStaffId, addToast]);

  useEffect(() => {
    if (step === 3) {
      loadSlots();
    }
  }, [step, loadSlots]);

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedService || !selectedSlot) {
      addToast('error', 'Please choose an available appointment slot');
      return;
    }
    if (!name.trim()) {
      addToast('error', 'Please enter your full name');
      return;
    }
    if (!phone.trim() && !email.trim()) {
      addToast('error', 'Please provide either a phone number or email address');
      return;
    }

    try {
      setSubmitting(true);
      const idempotencyKey = `pub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const srvId = selectedService.id || selectedService._id || '';
      const res = await publicBookingService.bookAppointment(
        slug,
        {
          serviceId: srvId,
          staffId: selectedStaffId || selectedSlot.staffId,
          startAt: selectedSlot.startAt,
          customer: {
            name: name.trim(),
            email: email.trim() || undefined,
            phone: phone.trim() || undefined,
            consent: {
              whatsapp: consentWhatsapp,
              email: consentEmail,
            },
          },
          customerNotes: customerNotes.trim() || undefined,
        },
        idempotencyKey
      );

      const apptId = res.appointment?.id || (res.appointment as any)?._id || '';
      setConfirmedBooking({
        reference: res.appointment?.reference,
        id: apptId,
        manageToken: res.manageToken,
        startAt: selectedSlot.startAt,
      });
      setStep(5); // Success step
      addToast('success', 'Your appointment has been successfully scheduled!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Booking failed. Slot may no longer be available.';
      addToast('error', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const copyReference = (text: string) => {
    navigator.clipboard.writeText(text);
    addToast('info', 'Booking reference copied to clipboard');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-4">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (notFound || !business) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Business Page Not Found</h1>
          <p className="text-xs text-slate-500">
            The booking page for <code className="bg-slate-100 px-1 py-0.5 rounded font-mono font-semibold">{slug}</code> does not exist or online booking is currently disabled.
          </p>
          <Link href="/">
            <Button variant="outline" size="sm" className="mt-2 text-xs">
              Go to Home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Business Header Card */}
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <div className="h-3 bg-gradient-to-r from-blue-600 to-indigo-600" />
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                    {business.profile?.displayName || business.slug}
                  </h1>
                  <Badge variant="outline" className="text-[10px] uppercase font-mono">
                    {business.profile?.category || 'Service'}
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 max-w-xl">
                  {business.profile?.description || 'Book professional appointments online with real-time confirmation.'}
                </p>
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-2">
                  {business.profile?.address && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      {business.profile.address}
                    </span>
                  )}
                  {business.profile?.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5 text-slate-400" />
                      {business.profile.phone}
                    </span>
                  )}
                </div>
              </div>

              {business.slug && (
                <div className="shrink-0 text-right">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">Timezone</span>
                  <span className="text-xs font-mono font-medium text-slate-700">{business.timezone}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Wizard Steps Navigation */}
        {step < 5 && (
          <div className="flex items-center justify-between px-2 text-xs">
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] ${step >= 1 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                1
              </span>
              <span className={step === 1 ? 'font-semibold text-slate-900' : 'text-slate-500'}>Service</span>
            </div>
            <div className="h-0.5 flex-1 mx-3 bg-slate-200" />
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] ${step >= 2 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                2
              </span>
              <span className={step === 2 ? 'font-semibold text-slate-900' : 'text-slate-500'}>Staff</span>
            </div>
            <div className="h-0.5 flex-1 mx-3 bg-slate-200" />
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] ${step >= 3 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                3
              </span>
              <span className={step === 3 ? 'font-semibold text-slate-900' : 'text-slate-500'}>Date & Time</span>
            </div>
            <div className="h-0.5 flex-1 mx-3 bg-slate-200" />
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] ${step >= 4 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                4
              </span>
              <span className={step === 4 ? 'font-semibold text-slate-900' : 'text-slate-500'}>Details</span>
            </div>
          </div>
        )}

        {/* STEP 1: Select Service */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Select a Service</CardTitle>
              <CardDescription className="text-xs">
                Choose the appointment type or consultation you would like to book.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {services.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">
                  No public services are currently available for booking.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {services.map((srv) => {
                    const isSelected = selectedService?.id === srv.id;
                    return (
                      <div
                        key={srv.id}
                        onClick={() => setSelectedService(srv)}
                        className={`p-4 rounded-xl border cursor-pointer transition-all ${
                          isSelected
                            ? 'border-blue-600 bg-blue-50/50 shadow-xs'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold text-sm text-slate-900">{srv.name}</h3>
                            <p className="text-xs text-slate-500 mt-1 line-clamp-2">{srv.description}</p>
                          </div>
                          {isSelected && <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0" />}
                        </div>
                        <div className="flex items-center justify-between text-xs text-slate-600 pt-3 mt-3 border-t border-slate-100">
                          <span className="flex items-center gap-1 font-medium">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {srv.durationMinutes} mins
                          </span>
                          <span className="font-bold text-slate-900">
                            {formatCurrency(srv.priceInr || 0)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex justify-end pt-4">
                <Button
                  onClick={() => setStep(2)}
                  disabled={!selectedService}
                  className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
                >
                  Continue
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* STEP 2: Select Staff */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Choose Specialist / Provider</CardTitle>
              <CardDescription className="text-xs">
                Select a specific professional or choose any available provider for maximum availability.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Any Available Option */}
                <div
                  onClick={() => setSelectedStaffId('')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    selectedStaffId === ''
                      ? 'border-blue-600 bg-blue-50/50 shadow-xs'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
                        <Sparkles className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm text-slate-900">Any Available Provider</h4>
                        <p className="text-xs text-slate-500">First available specialist</p>
                      </div>
                    </div>
                    {selectedStaffId === '' && <CheckCircle2 className="w-5 h-5 text-blue-600" />}
                  </div>
                </div>

                {/* Specific Staff */}
                {staffList.map((st) => {
                  const isSelected = selectedStaffId === (st._id || '');
                  return (
                    <div
                      key={st._id}
                      onClick={() => setSelectedStaffId(st._id || '')}
                      className={`p-4 rounded-xl border cursor-pointer transition-all ${
                        isSelected
                          ? 'border-blue-600 bg-blue-50/50 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-sm">
                            {st.name?.slice(0, 1).toUpperCase()}
                          </div>
                          <div>
                            <h4 className="font-semibold text-sm text-slate-900">{st.name}</h4>
                            <p className="text-xs text-slate-500">{st.title || 'Specialist'}</p>
                          </div>
                        </div>
                        {isSelected && <CheckCircle2 className="w-5 h-5 text-blue-600" />}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setStep(1)} className="gap-2">
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </Button>
                <Button
                  onClick={() => setStep(3)}
                  className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
                >
                  Select Date & Time
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* STEP 3: Select Date & Slot */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pick Appointment Date & Time</CardTitle>
              <CardDescription className="text-xs">
                Real-time available time slots for {selectedService?.name}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 max-w-xs">
                <Input
                  label="Appointment Date"
                  type="date"
                  value={selectedDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </div>

              <div className="space-y-2 pt-2">
                <span className="text-xs font-semibold text-slate-700 block">Available Time Slots</span>
                {loadingSlots ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                    <Skeleton className="h-10 w-full rounded-lg" />
                    <Skeleton className="h-10 w-full rounded-lg" />
                    <Skeleton className="h-10 w-full rounded-lg" />
                    <Skeleton className="h-10 w-full rounded-lg" />
                  </div>
                ) : slots.length === 0 ? (
                  <div className="p-6 bg-slate-50 border border-dashed border-slate-200 rounded-lg text-center">
                    <p className="text-xs text-slate-500">No time slots are available on this date.</p>
                    <p className="text-[11px] text-slate-400 mt-1">Please choose another date or provider.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                    {slots.map((sl, idx) => {
                      const timeStr = new Date(sl.startAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      });
                      const isSelected = selectedSlot?.startAt === sl.startAt;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setSelectedSlot(sl)}
                          className={`py-2 px-3 text-xs font-semibold rounded-lg border transition-all ${
                            isSelected
                              ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-blue-400 hover:bg-blue-50/50'
                          }`}
                        >
                          {timeStr}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setStep(2)} className="gap-2">
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </Button>
                <Button
                  onClick={() => setStep(4)}
                  disabled={!selectedSlot}
                  className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
                >
                  Enter Your Details
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* STEP 4: Customer Details Form */}
        {step === 4 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contact Information</CardTitle>
              <CardDescription className="text-xs">
                Provide your contact details so we can send confirmation and appointment reminders.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleBook} className="space-y-4">
                {/* Booking summary badge */}
                <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-lg flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-blue-900">{selectedService?.name}</span>
                    <p className="text-blue-700 text-[11px]">
                      {selectedSlot && formatDate(selectedSlot.startAt, { includeTime: true })} ({selectedService?.durationMinutes} mins)
                    </p>
                  </div>
                  <span className="font-bold text-blue-900 text-sm">
                    {formatCurrency(selectedService?.priceInr || 0)}
                  </span>
                </div>

                <Input
                  label="Full Name"
                  required
                  placeholder="e.g. John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    label="WhatsApp / Phone Number"
                    placeholder="e.g. +91 9876543210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    helperText="Recommended for instant WhatsApp alerts"
                  />
                  <Input
                    label="Email Address"
                    type="email"
                    placeholder="e.g. john@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <Input
                  label="Special Notes or Requirements (Optional)"
                  placeholder="Any preferences or symptoms you would like to share"
                  value={customerNotes}
                  onChange={(e) => setCustomerNotes(e.target.value)}
                />

                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={consentWhatsapp}
                      onChange={(e) => setConsentWhatsapp(e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    <span>Receive instant booking confirmation and reminders on WhatsApp</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={consentEmail}
                      onChange={(e) => setConsentEmail(e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    <span>Receive calendar invite and notification via email</span>
                  </label>
                </div>

                <div className="flex justify-between pt-4">
                  <Button type="button" variant="outline" onClick={() => setStep(3)} className="gap-2">
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </Button>
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="bg-blue-600 hover:bg-blue-700 text-white min-w-[140px]"
                  >
                    {submitting ? 'Confirming...' : 'Confirm Appointment'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* STEP 5: Booking Confirmed */}
        {step === 5 && confirmedBooking && (
          <Card className="text-center p-6 space-y-5">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <h2 className="text-xl font-bold text-slate-900">Appointment Confirmed!</h2>
              <p className="text-xs text-slate-500 mt-1">
                Your appointment with <span className="font-semibold text-slate-800">{business.profile?.displayName}</span> has been confirmed.
              </p>
            </div>

            <div className="max-w-md mx-auto bg-slate-50 p-4 rounded-xl border border-slate-200 text-left space-y-2.5 text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                <span className="text-slate-500">Booking Reference:</span>
                <div className="flex items-center gap-1.5 font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                  {confirmedBooking.reference}
                  <button
                    onClick={() => copyReference(confirmedBooking.reference || '')}
                    className="text-slate-400 hover:text-blue-600"
                    title="Copy"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Service:</span>
                <span className="font-semibold text-slate-800">{selectedService?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Scheduled Time:</span>
                <span className="font-semibold text-slate-800">
                  {confirmedBooking.startAt && formatDate(confirmedBooking.startAt, { includeTime: true })}
                </span>
              </div>
            </div>

            {/* Self-service management card */}
            {confirmedBooking.id && confirmedBooking.manageToken && (
              <div className="max-w-md mx-auto p-4 bg-blue-50 border border-blue-200 rounded-xl text-left space-y-2">
                <p className="text-xs font-semibold text-blue-900">Need to reschedule or cancel later?</p>
                <p className="text-[11px] text-blue-700">
                  You can securely manage this appointment anytime using your private access link:
                </p>
                <Link
                  href={`/book/${slug}/manage/${confirmedBooking.id}?token=${confirmedBooking.manageToken}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                >
                  Manage / Reschedule My Appointment
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              </div>
            )}

            <div className="pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setStep(1);
                  setSelectedService(null);
                  setSelectedSlot(null);
                  setConfirmedBooking(null);
                }}
                className="text-xs"
              >
                Book Another Appointment
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function PublicBookingPage() {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="w-8 h-8 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
        </div>
      }
    >
      <BookingContent />
    </React.Suspense>
  );
}
