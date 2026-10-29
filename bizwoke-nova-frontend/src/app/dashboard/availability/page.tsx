'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { businessService } from '@/lib/api/services/business';
import { staffService } from '@/lib/api/services/staff';
import { AvailabilityException, Staff, StaffAvailability } from '@/lib/api/types';
import { formatDateTime } from '@/lib/utils';
import { Clock, Plus, Trash2, CalendarOff, AlertTriangle, ShieldCheck } from 'lucide-react';
import { ApiClientError } from '@/lib/api/client';

const DAYS = [
  { day: 1, name: 'Monday' },
  { day: 2, name: 'Tuesday' },
  { day: 3, name: 'Wednesday' },
  { day: 4, name: 'Thursday' },
  { day: 5, name: 'Friday' },
  { day: 6, name: 'Saturday' },
  { day: 7, name: 'Sunday' },
];

export default function AvailabilityPage() {
  const { toast } = useToast();
  const [closures, setClosures] = useState<AvailabilityException[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [staffAvailability, setStaffAvailability] = useState<StaffAvailability | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Add Closure Modal
  const [closureModalOpen, setClosureModalOpen] = useState(false);
  const [closureType, setClosureType] = useState<'HOLIDAY' | 'LEAVE' | 'BLOCK'>('HOLIDAY');
  const [closureStartsAt, setClosureStartsAt] = useState('');
  const [closureEndsAt, setClosureEndsAt] = useState('');
  const [closureReason, setClosureReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [closuresRes, staffRes] = await Promise.all([
        businessService.getClosures(),
        staffService.list({ limit: 50, status: 'ACTIVE' }),
      ]);
      setClosures(closuresRes);
      setStaffList(staffRes.items);
      if (staffRes.items.length > 0 && !selectedStaffId) {
        setSelectedStaffId(staffRes.items[0].id || staffRes.items[0]._id || '');
      }
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Failed to load availability records',
        message: err instanceof Error ? err.message : 'Please check permissions.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [selectedStaffId, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load staff availability when selected staff changes
  useEffect(() => {
    if (!selectedStaffId) return;
    staffService
      .getAvailability(selectedStaffId)
      .then((data) => setStaffAvailability({ weekly: data.weekly, breaks: data.breaks }))
      .catch(() => setStaffAvailability(null));
  }, [selectedStaffId]);

  const handleAddClosure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (new Date(closureStartsAt) >= new Date(closureEndsAt)) {
      setError('Start time must be before end time.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await businessService.addClosure({
        type: closureType,
        startsAt: new Date(closureStartsAt).toISOString(),
        endsAt: new Date(closureEndsAt).toISOString(),
        reason: closureReason.trim() || undefined,
      });
      toast({
        type: 'success',
        title: 'Business closure added',
        message: 'Availability engine will block appointments during this period.',
      });
      setClosureModalOpen(false);
      setClosureStartsAt('');
      setClosureEndsAt('');
      setClosureReason('');
      loadData();
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to record closure.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClosure = async (id: string) => {
    if (!confirm('Remove this closure block?')) return;
    try {
      await businessService.deleteClosure(id);
      toast({ type: 'success', title: 'Closure removed' });
      loadData();
    } catch {
      toast({ type: 'error', title: 'Failed to remove closure' });
    }
  };

  return (
    <DashboardLayout
      title="Availability & Business Hours"
      description="Define business-wide closures, holidays, weekly schedules, and staff shifts"
      actions={
        <Button onClick={() => setClosureModalOpen(true)} size="sm" variant="primary" className="gap-1.5 shadow-xs">
          <CalendarOff className="w-4 h-4" /> Add Closure / Holiday
        </Button>
      }
      breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Availability' }]}
    >
      <div className="space-y-6">
        {/* Business-wide Closures / Holidays */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle>Business-wide Closures & Holidays</CardTitle>
              <CardDescription>
                During these periods, all services and staff are unavailable for booking.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {closures.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400">
                No active or upcoming business closures registered.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Starts At</TableHead>
                    <TableHead>Ends At</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closures.map((c) => (
                    <TableRow key={c._id}>
                      <TableCell className="font-semibold text-xs text-slate-800">
                        {c.type}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700">
                        {formatDateTime(c.startsAt)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700">
                        {formatDateTime(c.endsAt)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 italic">
                        {c.reason || 'None specified'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteClosure(c._id)}
                          className="text-slate-400 hover:text-rose-600 p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Staff Weekly Shift Schedules */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle>Staff Member Weekly Shift Schedule</CardTitle>
                <CardDescription>Inspect configured weekly working windows and break intervals</CardDescription>
              </div>
              <div className="w-60">
                <Select
                  value={selectedStaffId}
                  onChange={(e) => setSelectedStaffId(e.target.value)}
                  options={staffList.map((st) => ({ value: st._id, label: st.name }))}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!staffAvailability || staffAvailability.weekly.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                Default 09:00 - 17:00 weekday hours apply for this staff member until a custom schedule is set.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {DAYS.map((d) => {
                  const shifts = staffAvailability.weekly.filter((w) => w.dayOfWeek === d.day);
                  const breaks = staffAvailability.breaks.filter((b) => b.dayOfWeek === d.day);
                  return (
                    <div
                      key={d.day}
                      className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 space-y-1.5"
                    >
                      <div className="text-xs font-bold text-slate-800">{d.name}</div>
                      {shifts.length === 0 ? (
                        <p className="text-[11px] text-slate-400 italic">Off</p>
                      ) : (
                        shifts.map((s, idx) => (
                          <div key={idx} className="text-xs text-emerald-700 font-medium">
                            {s.start} – {s.end}
                          </div>
                        ))
                      )}
                      {breaks.length > 0 && (
                        <div className="text-[10px] text-amber-700 font-medium pt-1">
                          Break: {breaks.map((b) => `${b.start}–${b.end}`).join(', ')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add Closure Modal */}
      <Dialog
        open={closureModalOpen}
        onOpenChange={setClosureModalOpen}
        title="Add Business Closure or Holiday"
        description="Block appointment booking across the entire business for a designated period."
      >
        {error && <div className="mb-4 text-xs text-rose-600 font-medium">{error}</div>}
        <form onSubmit={handleAddClosure} className="space-y-4">
          <Select
            label="Closure Type"
            value={closureType}
            onChange={(e) => setClosureType(e.target.value as 'HOLIDAY' | 'LEAVE' | 'BLOCK')}
            options={[
              { value: 'HOLIDAY', label: 'HOLIDAY — Public or festival closure' },
              { value: 'BLOCK', label: 'BLOCK — Maintenance or scheduled downtime' },
              { value: 'LEAVE', label: 'LEAVE — General business leave' },
            ]}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Starts At *"
              type="datetime-local"
              required
              value={closureStartsAt}
              onChange={(e) => setClosureStartsAt(e.target.value)}
            />
            <Input
              label="Ends At *"
              type="datetime-local"
              required
              value={closureEndsAt}
              onChange={(e) => setClosureEndsAt(e.target.value)}
            />
          </div>

          <Input
            label="Reason / Notes (Optional)"
            placeholder="e.g. National Holiday / Facility Renovation"
            value={closureReason}
            onChange={(e) => setClosureReason(e.target.value)}
          />

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="ghost" onClick={() => setClosureModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Add Closure Block
            </Button>
          </div>
        </form>
      </Dialog>
    </DashboardLayout>
  );
}
