'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/badge';
import { appointmentsService } from '@/lib/api/services/appointments';
import { staffService } from '@/lib/api/services/staff';
import { Appointment, Staff } from '@/lib/api/types';
import { formatTime, formatDate } from '@/lib/utils';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  CalendarPlus,
  Clock,
  User,
} from 'lucide-react';

function CalendarContent() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'month' | 'week'>('month');
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load staff
  useEffect(() => {
    staffService.list({ limit: 100, status: 'ACTIVE' }).then((res) => setStaffList(res.items)).catch(() => {});
  }, []);

  const loadAppointments = useCallback(async () => {
    setIsLoading(true);

    // Calculate month boundary
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const from = new Date(year, month, 1).toISOString();
    const to = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

    try {
      const res = await appointmentsService.list({
        limit: 100,
        from,
        to,
        staffId: selectedStaffId || undefined,
      });
      setAppointments(res.items);
    } catch {
      setAppointments([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentDate, selectedStaffId]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  // Calendar month grid generator
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDayIndex = new Date(year, month, 1).getDay(); // 0 is Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonthDays = new Date(year, month, 0).getDate();

  // Navigation handlers
  const handlePrev = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };
  const handleNext = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };
  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <DashboardLayout
      title="Appointment Calendar"
      description="Visual schedule matrix with date navigation and staff availability filtering"
      actions={
        <div className="flex items-center gap-2">
          <Link href="/dashboard/appointments?create=true">
            <Button size="sm" variant="primary" className="gap-1.5 shadow-xs">
              <CalendarPlus className="w-4 h-4" /> Book Appointment
            </Button>
          </Link>
        </div>
      }
      breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Calendar' }]}
    >
      {/* Calendar Controls */}
      <Card className="mb-6">
        <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleToday}>
              Today
            </Button>
            <div className="flex items-center gap-1 border border-slate-200 rounded-lg p-0.5 bg-white">
              <button
                onClick={handlePrev}
                className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                aria-label="Previous month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleNext}
                className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                aria-label="Next month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <h2 className="text-base font-bold text-slate-900 ml-2">{monthName}</h2>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="w-48">
              <Select
                value={selectedStaffId}
                onChange={(e) => setSelectedStaffId(e.target.value)}
                options={[
                  { value: '', label: 'All Staff' },
                  ...staffList.map((st) => ({ value: st._id, label: st.name })),
                ]}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Calendar Grid */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold text-slate-600 py-2.5">
          <span>Sun</span>
          <span>Mon</span>
          <span>Tue</span>
          <span>Wed</span>
          <span>Thu</span>
          <span>Fri</span>
          <span>Sat</span>
        </div>

        <div className="grid grid-cols-7 divide-x divide-y divide-slate-100 bg-white">
          {/* Leading days from previous month */}
          {Array.from({ length: firstDayIndex }).map((_, i) => (
            <div
              key={`prev-${i}`}
              className="min-h-[110px] p-2 bg-slate-50/40 text-slate-300 text-xs select-none"
            >
              {prevMonthDays - firstDayIndex + i + 1}
            </div>
          ))}

          {/* Current month days */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNumber = i + 1;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;

            // Find appointments on this day
            const dayAppts = appointments.filter((a) => a.startAt.startsWith(dateStr));
            const isToday =
              new Date().toISOString().split('T')[0] === dateStr;

            return (
              <div
                key={`day-${dayNumber}`}
                className={`min-h-[110px] p-2 transition-colors hover:bg-slate-50/50 ${
                  isToday ? 'bg-blue-50/20' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className={`text-xs font-bold ${
                      isToday
                        ? 'flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white'
                        : 'text-slate-700'
                    }`}
                  >
                    {dayNumber}
                  </span>
                  {dayAppts.length > 0 && (
                    <span className="text-[10px] text-slate-400 font-medium">
                      {dayAppts.length} appt{dayAppts.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  {dayAppts.slice(0, 3).map((appt) => (
                    <Link
                      key={appt._id}
                      href={`/dashboard/appointments/${appt._id}`}
                      className="block truncate rounded px-1.5 py-0.5 text-[10px] font-semibold border transition-all hover:scale-[1.02]"
                      style={{
                        backgroundColor:
                          appt.status === 'CONFIRMED'
                            ? '#ecfdf5'
                            : appt.status === 'COMPLETED'
                            ? '#f1f5f9'
                            : appt.status === 'CANCELLED'
                            ? '#fef2f2'
                            : '#eff6ff',
                        color:
                          appt.status === 'CONFIRMED'
                            ? '#065f46'
                            : appt.status === 'COMPLETED'
                            ? '#334155'
                            : appt.status === 'CANCELLED'
                            ? '#991b1b'
                            : '#1e40af',
                        borderColor:
                          appt.status === 'CONFIRMED'
                            ? '#a7f3d0'
                            : appt.status === 'COMPLETED'
                            ? '#e2e8f0'
                            : appt.status === 'CANCELLED'
                            ? '#fecaca'
                            : '#bfdbfe',
                      }}
                      title={`${formatTime(appt.startAt)} - ${appt.reference}`}
                    >
                      {formatTime(appt.startAt)} {appt.reference}
                    </Link>
                  ))}
                  {dayAppts.length > 3 && (
                    <span className="text-[9px] font-bold text-slate-400 pl-1 block">
                      +{dayAppts.length - 3} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </DashboardLayout>
  );
}

export default function CalendarPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="w-8 h-8 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
        </div>
      }
    >
      <CalendarContent />
    </React.Suspense>
  );
}
