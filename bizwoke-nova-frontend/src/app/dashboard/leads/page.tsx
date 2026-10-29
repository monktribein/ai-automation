'use client';

import React, { useEffect, useState, useCallback } from 'react';
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
import { leadsService } from '@/lib/api/services/leads';
import { Lead, LeadStatus } from '@/lib/api/types';
import { formatDate } from '@/lib/utils';
import { UserCheck, UserPlus, Search, ArrowLeft, ArrowRight, Mail, Phone, MessageSquare } from 'lucide-react';
import { ApiClientError } from '@/lib/api/client';

export default function LeadsPage() {
  const { toast } = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Create Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [interest, setInterest] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Status Change Dialog
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [newStatus, setNewStatus] = useState<LeadStatus>('NEW');

  const loadLeads = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await leadsService.list({
        page,
        limit: 15,
        status: statusFilter ? (statusFilter as LeadStatus) : undefined,
      });
      setLeads(res.items);
      setTotalPages(res.meta?.totalPages || 1);
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Failed to load leads',
        message: err instanceof Error ? err.message : 'Please check permissions.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [page, statusFilter, toast]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email && !phone) {
      setError('Please provide either an email or a phone number.');
      return;
    }
    setError(null);
    setIsSubmitting(true);

    try {
      await leadsService.create({
        name,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        message: message.trim() || undefined,
        interest: interest.trim() || undefined,
        sourceDetail: 'staff_portal',
      });
      toast({
        type: 'success',
        title: 'Lead created',
        message: `${name} has been added to prospective leads.`,
      });
      setCreateModalOpen(false);
      setName('');
      setEmail('');
      setPhone('');
      setMessage('');
      setInterest('');
      loadLeads();
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to create lead.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!selectedLead) return;
    try {
      await leadsService.update(selectedLead._id, { status: newStatus });
      toast({
        type: 'success',
        title: 'Lead status updated',
        message: `${selectedLead.name} marked as ${newStatus}`,
      });
      setSelectedLead(null);
      loadLeads();
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Status update failed',
        message: err instanceof Error ? err.message : 'Please check permissions.',
      });
    }
  };

  return (
    <DashboardLayout
      title="Lead & Enquiry Management"
      description="Track prospect enquiries, qualify incoming customer demands, and convert leads"
      actions={
        <Button onClick={() => setCreateModalOpen(true)} size="sm" variant="primary" className="gap-1.5 shadow-xs">
          <UserPlus className="w-4 h-4" /> Add Lead
        </Button>
      }
      breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Leads' }]}
    >
      {/* Filter */}
      <Card className="mb-6">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="w-64">
            <Select
              label="Filter by Lead Status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Statuses' },
                { value: 'NEW', label: 'New' },
                { value: 'CONTACTED', label: 'Contacted' },
                { value: 'QUALIFIED', label: 'Qualified' },
                { value: 'CONVERTED', label: 'Converted' },
                { value: 'LOST', label: 'Lost' },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton rows={8} columns={5} />
      ) : leads.length === 0 ? (
        <EmptyState
          icon={<UserCheck className="w-8 h-8" />}
          title="No leads found"
          description="Enquiries captured via the public booking website, WhatsApp assistant, or manual entry appear here."
          actionLabel="Create Lead"
          onAction={() => setCreateModalOpen(true)}
        />
      ) : (
        <div className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prospect Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Interest / Message</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead._id}>
                  <TableCell className="font-semibold text-slate-900">{lead.name}</TableCell>
                  <TableCell className="text-xs text-slate-600">
                    <div>{lead.email || '—'}</div>
                    <div className="text-slate-400">{lead.phone || ''}</div>
                  </TableCell>
                  <TableCell className="text-xs uppercase font-medium text-slate-500">
                    {lead.source}
                  </TableCell>
                  <TableCell className="text-xs text-slate-700 max-w-xs truncate">
                    {lead.interest ? (
                      <span className="font-semibold block">{lead.interest}</span>
                    ) : null}
                    {lead.message || '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={lead.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => {
                        setSelectedLead(lead);
                        setNewStatus(lead.status);
                      }}
                    >
                      Update Status
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="flex items-center justify-between text-xs text-slate-500 px-2 py-3 border-t border-slate-200">
            <div>Page {page} of {totalPages}</div>
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

      {/* Create Lead Modal */}
      <Dialog
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        title="Add New Lead"
        description="Record a new customer enquiry or prospective interest."
      >
        {error && <div className="mb-4 text-xs text-rose-600 font-medium">{error}</div>}
        <form onSubmit={handleCreateLead} className="space-y-4">
          <Input
            label="Prospect Name *"
            required
            placeholder="Alex Morgan"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Email Address"
            type="email"
            placeholder="alex@example.com"
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
            label="Primary Interest"
            placeholder="e.g. Dental cleaning or consultations"
            value={interest}
            onChange={(e) => setInterest(e.target.value)}
          />
          <Input
            label="Enquiry Message"
            placeholder="Details of what the customer is asking about"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="ghost" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Save Lead
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Update Status Dialog */}
      <Dialog
        open={Boolean(selectedLead)}
        onOpenChange={(open) => !open && setSelectedLead(null)}
        title={`Update Status: ${selectedLead?.name}`}
        description="Transition this lead through your qualification and conversion pipeline."
      >
        <div className="space-y-4">
          <Select
            label="Select New Status"
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value as LeadStatus)}
            options={[
              { value: 'NEW', label: 'NEW — Unprocessed enquiry' },
              { value: 'CONTACTED', label: 'CONTACTED — Initial follow-up done' },
              { value: 'QUALIFIED', label: 'QUALIFIED — Genuine prospective intent' },
              { value: 'CONVERTED', label: 'CONVERTED — Creates / links customer' },
              { value: 'LOST', label: 'LOST — Not interested or unreachable' },
            ]}
          />
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="ghost" onClick={() => setSelectedLead(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleUpdateStatus}>
              Update Status
            </Button>
          </div>
        </div>
      </Dialog>
    </DashboardLayout>
  );
}
