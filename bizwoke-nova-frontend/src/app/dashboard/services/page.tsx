'use client';

import React, { useEffect, useState, useCallback } from 'react';
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
import { servicesService } from '@/lib/api/services/services';
import { Service } from '@/lib/api/types';
import { formatCurrency } from '@/lib/utils';
import { Briefcase, Plus, Search, Edit2, Archive, CheckCircle2, XCircle } from 'lucide-react';
import { ApiClientError } from '@/lib/api/client';

export default function ServicesPage() {
  const { toast } = useToast();
  const [services, setServices] = useState<Service[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Create / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [bufferMinutes, setBufferMinutes] = useState(5);
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [currency, setCurrency] = useState('USD');
  const [category, setCategory] = useState('');
  const [publiclyBookable, setPubliclyBookable] = useState(true);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadServices = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await servicesService.list({
        search: search.trim() || undefined,
        limit: 50,
      });
      setServices(res.items);
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Failed to load services',
        message: err instanceof Error ? err.message : 'Please check permissions.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [search, toast]);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  const openCreateModal = () => {
    setEditingService(null);
    setName('');
    setDescription('');
    setDurationMinutes(30);
    setBufferMinutes(5);
    setPrice(undefined);
    setCurrency('USD');
    setCategory('');
    setPubliclyBookable(true);
    setError(null);
    setModalOpen(true);
  };

  const openEditModal = (s: Service) => {
    setEditingService(s);
    setName(s.name);
    setDescription(s.description || '');
    setDurationMinutes(s.durationMinutes);
    setBufferMinutes(s.bufferMinutes || 0);
    setPrice(s.price);
    setCurrency(s.currency || 'USD');
    setCategory(s.category || '');
    setPubliclyBookable(s.publiclyBookable);
    setError(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (durationMinutes % 5 !== 0 || bufferMinutes % 5 !== 0) {
      setError('Duration and buffer minutes must be multiples of 5.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      if (editingService) {
        const srvId = editingService.id || editingService._id || '';
        await servicesService.update(srvId, {
          name,
          description: description || undefined,
          durationMinutes,
          bufferMinutes,
          price: price !== undefined && !isNaN(price) ? price : undefined,
          currency,
          category: category || undefined,
          publiclyBookable,
        });
        toast({
          type: 'success',
          title: 'Service updated',
          message: `${name} has been updated.`,
        });
      } else {
        await servicesService.create({
          name,
          description: description || undefined,
          durationMinutes,
          bufferMinutes,
          price: price !== undefined && !isNaN(price) ? price : undefined,
          currency,
          category: category || undefined,
          publiclyBookable,
        });
        toast({
          type: 'success',
          title: 'Service created',
          message: `${name} has been added to your business catalog.`,
        });
      }
      setModalOpen(false);
      loadServices();
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to save service.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async (id: string, serviceName: string) => {
    if (!confirm(`Are you sure you want to archive "${serviceName}"? Existing appointments remain unaffected.`)) {
      return;
    }
    try {
      await servicesService.delete(id);
      toast({
        type: 'success',
        title: 'Service archived',
      });
      loadServices();
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
      title="Services Management"
      description="Configure bookable services, durations, buffer times, and public booking settings"
      actions={
        <Button onClick={openCreateModal} size="sm" variant="primary" className="gap-1.5 shadow-xs">
          <Plus className="w-4 h-4" /> Add Service
        </Button>
      }
      breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Services' }]}
    >
      {/* Search */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              loadServices();
            }}
            className="flex gap-2 max-w-md"
          >
            <Input
              placeholder="Search service by name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              icon={<Search className="w-4 h-4" />}
            />
            <Button type="submit" variant="outline" size="md">
              Search
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Services Table */}
      {isLoading ? (
        <TableSkeleton rows={6} columns={6} />
      ) : services.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="w-8 h-8" />}
          title="No services created"
          description="Add services that your staff provide so customers can book time slots."
          actionLabel="Add Service"
          onAction={openCreateModal}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Buffer Time</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Public Booking</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.map((s) => (
              <TableRow key={s._id}>
                <TableCell>
                  <div className="font-semibold text-slate-900">{s.name}</div>
                  {s.description && (
                    <div className="text-xs text-slate-400 max-w-xs truncate">{s.description}</div>
                  )}
                </TableCell>
                <TableCell className="text-xs font-medium text-slate-700">
                  {s.durationMinutes} mins
                </TableCell>
                <TableCell className="text-xs text-slate-500">
                  {s.bufferMinutes ? `${s.bufferMinutes} mins` : 'None'}
                </TableCell>
                <TableCell className="text-xs font-medium text-slate-900">
                  {s.price !== undefined ? formatCurrency(s.price, s.currency || 'USD') : 'Free / Not set'}
                </TableCell>
                <TableCell>
                  {s.publiclyBookable ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      <CheckCircle2 className="w-3 h-3" /> Bookable
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                      <XCircle className="w-3 h-3" /> Internal only
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={s.status} />
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openEditModal(s)}
                    className="p-1.5 text-slate-600 hover:text-blue-600"
                    title="Edit Service"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleArchive(s.id || s._id || '', s.name)}
                    className="p-1.5 text-slate-400 hover:text-rose-600"
                    title="Archive Service"
                  >
                    <Archive className="w-3.5 h-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Modal */}
      <Dialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingService ? 'Edit Service' : 'Create New Service'}
        description="Configure service duration, buffer intervals, and public portal availability."
      >
        {error && <div className="mb-4 text-xs text-rose-600 font-medium">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Service Name *"
            required
            placeholder="e.g. Comprehensive Dental Checkup"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Description"
            placeholder="Details about what the service covers"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Duration (Minutes) *"
              type="number"
              required
              min={5}
              step={5}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              hint="Multiple of 5"
            />
            <Input
              label="Buffer Time (Minutes) *"
              type="number"
              required
              min={0}
              step={5}
              value={bufferMinutes}
              onChange={(e) => setBufferMinutes(Number(e.target.value))}
              hint="Preparation / clean up buffer"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Price (Optional)"
              type="number"
              step="any"
              min={0}
              placeholder="0.00"
              value={price ?? ''}
              onChange={(e) => setPrice(e.target.value ? Number(e.target.value) : undefined)}
            />
            <Input
              label="Currency"
              placeholder="USD"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 pt-1">
            <input
              type="checkbox"
              checked={publiclyBookable}
              onChange={(e) => setPubliclyBookable(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Visible on Public Booking Page
          </label>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              {editingService ? 'Save Changes' : 'Create Service'}
            </Button>
          </div>
        </form>
      </Dialog>
    </DashboardLayout>
  );
}
