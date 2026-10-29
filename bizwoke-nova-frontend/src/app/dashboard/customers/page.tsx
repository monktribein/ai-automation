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
import { customersService } from '@/lib/api/services/customers';
import { Customer } from '@/lib/api/types';
import { formatDate } from '@/lib/utils';
import { UserPlus, Search, Users, Trash2, ArrowLeft, ArrowRight, ShieldCheck, Mail, Phone } from 'lucide-react';
import { ApiClientError } from '@/lib/api/client';

export default function CustomersPage() {
  const { toast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Create Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Erase PII Dialog
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const loadCustomers = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await customersService.list({
        page,
        limit: 15,
        search: search.trim() || undefined,
      });
      setCustomers(res.items);
      setTotalPages(res.meta?.totalPages || 1);
      setTotalCount(res.meta?.total || res.items.length);
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Failed to load customers',
        message: err instanceof Error ? err.message : 'Please check permissions.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [page, search, toast]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await customersService.create({
        name,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      toast({
        type: 'success',
        title: 'Customer created',
        message: `${name} has been added to customer directory.`,
      });
      setCreateModalOpen(false);
      setName('');
      setEmail('');
      setPhone('');
      setNotes('');
      loadCustomers();
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to create customer.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeletePii = async () => {
    if (!deleteId) return;
    try {
      await customersService.delete(deleteId);
      toast({
        type: 'success',
        title: 'Customer anonymized',
        message: 'Personal identifying information was permanently erased per GDPR compliance.',
      });
      setDeleteId(null);
      loadCustomers();
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Erase failed',
        message: err instanceof Error ? err.message : 'Permission denied.',
      });
    }
  };

  return (
    <DashboardLayout
      title="Customer Directory"
      description="Manage customer profiles, appointment history, consent preferences, and privacy controls"
      actions={
        <Button onClick={() => setCreateModalOpen(true)} size="sm" variant="primary" className="gap-1.5 shadow-xs">
          <UserPlus className="w-4 h-4" /> Add Customer
        </Button>
      }
      breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Customers' }]}
    >
      {/* Search Bar */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              loadCustomers();
            }}
            className="flex gap-2"
          >
            <Input
              placeholder="Search by customer name..."
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

      {/* Table */}
      {isLoading ? (
        <TableSkeleton rows={8} columns={5} />
      ) : customers.length === 0 ? (
        <EmptyState
          icon={<Users className="w-8 h-8" />}
          title="No customers recorded"
          description="Customers created through bookings, manual entry, or Excel imports will appear here."
          actionLabel="Add First Customer"
          onAction={() => setCreateModalOpen(true)}
        />
      ) : (
        <div className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c._id}>
                  <TableCell className="font-semibold text-slate-900">
                    <Link href={`/dashboard/customers/${c._id}`} className="hover:text-blue-600 transition-colors">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {c.email || '—'}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {c.phone || '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-xs text-slate-400">
                    {formatDate(c.createdAt)}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Link href={`/dashboard/customers/${c._id}`}>
                      <Button size="sm" variant="ghost" className="text-xs">
                        Profile
                      </Button>
                    </Link>
                    {c.status !== 'ANONYMIZED' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteId(c._id)}
                        className="text-slate-400 hover:text-rose-600 p-1.5"
                        title="Erase customer PII"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="flex items-center justify-between text-xs text-slate-500 px-2 py-3 border-t border-slate-200">
            <div>
              Showing {customers.length} of {totalCount} customers
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

      {/* Create Modal */}
      <Dialog
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        title="Create Customer Profile"
        description="Add a new customer profile to your workspace."
      >
        {error && <div className="mb-4 text-xs text-rose-600 font-medium">{error}</div>}
        <form onSubmit={handleCreateCustomer} className="space-y-4">
          <Input
            label="Full Name *"
            required
            placeholder="Jane Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Email Address"
            type="email"
            placeholder="jane@example.com"
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
          <Input
            label="Operational Notes"
            placeholder="Preferences, operational notes (no medical data)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="ghost" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Save Customer
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Erase PII Confirmation Dialog */}
      <Dialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Erase Customer PII (GDPR / Privacy Compliance)"
        description="Are you sure you want to erase this customer's personal information? Name, email, and phone will be replaced with anonymized tokens, and past appointment history will be retained in de-identified format."
      >
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="ghost" onClick={() => setDeleteId(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDeletePii}>
            Confirm Erase PII
          </Button>
        </div>
      </Dialog>
    </DashboardLayout>
  );
}
