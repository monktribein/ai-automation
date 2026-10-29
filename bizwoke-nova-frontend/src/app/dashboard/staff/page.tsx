'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { staffService } from '@/lib/api/services/staff';
import { servicesService } from '@/lib/api/services/services';
import { Staff, Service } from '@/lib/api/types';
import { UserSquare2, Plus, Edit2, Archive, Clock, Mail, Phone } from 'lucide-react';
import { ApiClientError } from '@/lib/api/client';

export default function StaffPage() {
  const { toast } = useToast();
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [title, setTitle] = useState('');
  const [bio, setBio] = useState('');
  const [capacity, setCapacity] = useState(1);
  const [publiclyVisible, setPubliclyVisible] = useState(true);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [staffRes, servicesRes] = await Promise.all([
        staffService.list({ limit: 50 }),
        servicesService.list({ limit: 100 }),
      ]);
      setStaffList(staffRes.items);
      setServices(servicesRes.items);
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Failed to load staff list',
        message: err instanceof Error ? err.message : 'Please check permissions.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreateModal = () => {
    setEditingStaff(null);
    setName('');
    setEmail('');
    setPhone('');
    setTitle('');
    setBio('');
    setCapacity(1);
    setPubliclyVisible(true);
    setSelectedServiceIds([]);
    setError(null);
    setModalOpen(true);
  };

  const openEditModal = (st: Staff) => {
    setEditingStaff(st);
    setName(st.name);
    setEmail(st.email || '');
    setPhone(st.phone || '');
    setTitle(st.title || '');
    setBio(st.bio || '');
    setCapacity(st.capacity || 1);
    setPubliclyVisible(st.publiclyVisible);
    setSelectedServiceIds(st.serviceIds || []);
    setError(null);
    setModalOpen(true);
  };

  const toggleService = (serviceId: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(serviceId) ? prev.filter((id) => id !== serviceId) : [...prev, serviceId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (editingStaff) {
        const staffId = editingStaff.id || editingStaff._id || '';
        await staffService.update(staffId, {
          name,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          title: title.trim() || undefined,
          bio: bio.trim() || undefined,
          capacity,
          publiclyVisible,
          serviceIds: selectedServiceIds,
        });
        toast({
          type: 'success',
          title: 'Staff member updated',
        });
      } else {
        await staffService.create({
          name,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          title: title.trim() || undefined,
          bio: bio.trim() || undefined,
          capacity,
          publiclyVisible,
          serviceIds: selectedServiceIds,
        });
        toast({
          type: 'success',
          title: 'Staff member added',
        });
      }
      setModalOpen(false);
      loadData();
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to save staff record.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async (id: string, staffName: string) => {
    if (!confirm(`Are you sure you want to archive ${staffName}? Existing bookings will be retained.`)) {
      return;
    }
    try {
      await staffService.delete(id);
      toast({ type: 'success', title: 'Staff member archived' });
      loadData();
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Archive failed',
        message: err instanceof Error ? err.message : 'Please check permissions.',
      });
    }
  };

  return (
    <DashboardLayout
      title="Staff & Service Providers"
      description="Manage staff members, provider profiles, concurrency capacity, and service assignments"
      actions={
        <div className="flex items-center gap-2">
          <Link href="/dashboard/availability">
            <Button size="sm" variant="outline" className="gap-1.5">
              <Clock className="w-4 h-4" /> Schedule & Availability
            </Button>
          </Link>
          <Button onClick={openCreateModal} size="sm" variant="primary" className="gap-1.5 shadow-xs">
            <Plus className="w-4 h-4" /> Add Staff Member
          </Button>
        </div>
      }
      breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Staff' }]}
    >
      {isLoading ? (
        <TableSkeleton rows={6} columns={5} />
      ) : staffList.length === 0 ? (
        <EmptyState
          icon={<UserSquare2 className="w-8 h-8" />}
          title="No staff members registered"
          description="Add staff members or service providers who deliver services and fulfill booked appointments."
          actionLabel="Add Staff Member"
          onAction={openCreateModal}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Staff Name</TableHead>
              <TableHead>Title / Role</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Assigned Services</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staffList.map((st) => (
              <TableRow key={st._id}>
                <TableCell>
                  <div className="font-semibold text-slate-900">{st.name}</div>
                  <div className="text-xs text-slate-400">{st.email || st.phone || 'No direct contact'}</div>
                </TableCell>
                <TableCell className="text-xs text-slate-600">
                  {st.title || 'Service Provider'}
                </TableCell>
                <TableCell className="text-xs font-medium text-slate-700">
                  {st.capacity} concurrent appt{st.capacity > 1 ? 's' : ''}
                </TableCell>
                <TableCell className="text-xs text-slate-600">
                  {st.serviceIds && st.serviceIds.length > 0 ? (
                    <span className="font-medium text-slate-800">
                      {st.serviceIds.length} service{st.serviceIds.length > 1 ? 's' : ''} assigned
                    </span>
                  ) : (
                    <span className="text-slate-400 italic">None assigned</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={st.status} />
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openEditModal(st)}
                    className="p-1.5 text-slate-600 hover:text-blue-600"
                    title="Edit Staff Member"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleArchive(st.id || st._id || '', st.name)}
                    className="p-1.5 text-slate-400 hover:text-rose-600"
                    title="Archive Staff Member"
                  >
                    <Archive className="w-3.5 h-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create / Edit Modal */}
      <Dialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingStaff ? 'Edit Staff Member' : 'Add Staff Member'}
        description="Provide staff member profile details, concurrency limits, and services they provide."
        maxWidth="lg"
      >
        {error && <div className="mb-4 text-xs text-rose-600 font-medium">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Full Name *"
            required
            placeholder="Dr. Sarah Johnson"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Email Address"
              type="email"
              placeholder="sarah@business.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              icon={<Mail className="w-4 h-4" />}
            />
            <Input
              label="Phone Number"
              type="tel"
              placeholder="+919876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              icon={<Phone className="w-4 h-4" />}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Professional Title"
              placeholder="e.g. Senior Stylist / Orthodontist"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Input
              label="Concurrent Capacity (1–50) *"
              type="number"
              required
              min={1}
              max={50}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
              hint="Max appointments this staff can take at the same time"
            />
          </div>

          <Input
            label="Biography / Profile"
            placeholder="Brief description for public booking view"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />

          {/* Assigned Services Checklist */}
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <label className="text-xs font-semibold text-slate-700 block">
              Assigned Services (Select which services this staff member provides)
            </label>
            {services.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No services created yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 border rounded-lg">
                {services.map((s) => {
                  const sId = s.id || s._id || '';
                  const isChecked = selectedServiceIds.includes(sId);
                  return (
                    <label
                      key={sId}
                      className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 text-xs text-slate-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleService(sId)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="truncate">{s.name} ({s.durationMinutes}m)</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={publiclyVisible}
              onChange={(e) => setPubliclyVisible(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Publicly visible on client booking pages
          </label>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              {editingStaff ? 'Save Changes' : 'Create Staff Member'}
            </Button>
          </div>
        </form>
      </Dialog>
    </DashboardLayout>
  );
}
