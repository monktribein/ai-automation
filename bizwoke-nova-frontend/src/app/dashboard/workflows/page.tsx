'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { workflowsService } from '@/lib/api/services/workflows';
import { Workflow, WorkflowExecution, WorkflowTrigger } from '@/lib/api/types';
import { formatDateTime } from '@/lib/utils';
import { GitBranch, Plus, History, Trash2, CheckCircle2, XCircle, Mail, MessageSquare } from 'lucide-react';
import { ApiClientError } from '@/lib/api/client';

export default function WorkflowsPage() {
  const { toast } = useToast();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Create Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<WorkflowTrigger>('appointment.created');
  const [channel, setChannel] = useState<'EMAIL' | 'WHATSAPP'>('EMAIL');
  const [recipient, setRecipient] = useState<'customer' | 'fixed'>('customer');
  const [fixedTo, setFixedTo] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('Hello {{customerName}}, your appointment at {{businessName}} is confirmed for {{startAt}}. Reference: {{reference}}');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Executions History Modal
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [isLoadingExecs, setIsLoadingExecs] = useState(false);

  const loadWorkflows = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await workflowsService.list();
      setWorkflows(res.items);
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Failed to load workflows',
        message: err instanceof Error ? err.message : 'Please check permissions.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const handleToggleWorkflow = async (wf: Workflow) => {
    try {
      await workflowsService.update(wf._id, { enabled: !wf.enabled });
      toast({
        type: 'success',
        title: wf.enabled ? 'Workflow disabled' : 'Workflow enabled',
      });
      loadWorkflows();
    } catch {
      toast({ type: 'error', title: 'Failed to update workflow' });
    }
  };

  const handleViewExecutions = async (wf: Workflow) => {
    setSelectedWorkflow(wf);
    setIsLoadingExecs(true);
    try {
      const res = await workflowsService.getExecutions(wf._id);
      setExecutions(res.items);
    } catch {
      setExecutions([]);
    } finally {
      setIsLoadingExecs(false);
    }
  };

  const handleDelete = async (id: string, workflowName: string) => {
    if (!confirm(`Delete workflow "${workflowName}"?`)) return;
    try {
      await workflowsService.delete(id);
      toast({ type: 'success', title: 'Workflow deleted' });
      loadWorkflows();
    } catch {
      toast({ type: 'error', title: 'Delete failed' });
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (recipient === 'fixed' && !fixedTo) {
      setError('Please provide an email address for fixed recipients.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await workflowsService.create({
        name,
        trigger,
        enabled: true,
        actions: [
          {
            type: 'send_notification',
            channel,
            recipient,
            fixedTo: recipient === 'fixed' ? fixedTo : undefined,
            subject: channel === 'EMAIL' ? subject || 'Appointment Update' : undefined,
            text,
            offsetMinutes: 0,
            relativeTo: 'event',
          },
        ],
      });
      toast({ type: 'success', title: 'Workflow created' });
      setModalOpen(false);
      setName('');
      loadWorkflows();
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to create workflow.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DashboardLayout
      title="Automations & Workflows"
      description="Configure trigger-based notification workflows and delivery triggers"
      actions={
        <Button onClick={() => setModalOpen(true)} size="sm" variant="primary" className="gap-1.5 shadow-xs">
          <Plus className="w-4 h-4" /> Create Workflow
        </Button>
      }
      breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Workflows' }]}
    >
      {isLoading ? (
        <TableSkeleton rows={5} columns={5} />
      ) : workflows.length === 0 ? (
        <EmptyState
          icon={<GitBranch className="w-8 h-8" />}
          title="No automation workflows configured"
          description="Create automated customer reminders, confirmation messages, and team notifications triggered by appointment and lead events."
          actionLabel="Create First Workflow"
          onAction={() => setModalOpen(true)}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workflow Name</TableHead>
              <TableHead>Trigger Event</TableHead>
              <TableHead>Action Channel</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workflows.map((wf) => (
              <TableRow key={wf._id}>
                <TableCell className="font-semibold text-slate-900">{wf.name}</TableCell>
                <TableCell className="text-xs font-mono text-blue-700 bg-blue-50/50 px-2 py-1 rounded inline-block my-2">
                  {wf.trigger}
                </TableCell>
                <TableCell className="text-xs text-slate-700">
                  {wf.actions.map((a, i) => (
                    <span key={i} className="inline-flex items-center gap-1 font-medium">
                      {a.channel === 'EMAIL' ? <Mail className="w-3.5 h-3.5 text-slate-400" /> : <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />}
                      {a.channel} ({a.recipient})
                    </span>
                  ))}
                </TableCell>
                <TableCell>
                  <button
                    onClick={() => handleToggleWorkflow(wf)}
                    className="focus:outline-none"
                    title="Click to toggle status"
                  >
                    {wf.enabled ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3" /> Enabled
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                        <XCircle className="w-3 h-3" /> Disabled
                      </span>
                    )}
                  </button>
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleViewExecutions(wf)}
                    className="text-xs gap-1"
                  >
                    <History className="w-3.5 h-3.5 text-blue-600" /> Runs
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(wf._id, wf.name)}
                    className="p-1.5 text-slate-400 hover:text-rose-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create Workflow Modal */}
      <Dialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Create Automation Workflow"
        description="Trigger an automated notification action based on appointment or lead state."
        maxWidth="lg"
      >
        {error && <div className="mb-4 text-xs text-rose-600 font-medium">{error}</div>}
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            label="Workflow Name *"
            required
            placeholder="e.g. Appointment Confirmation WhatsApp"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Trigger Event *"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value as WorkflowTrigger)}
              options={[
                { value: 'appointment.created', label: 'appointment.created' },
                { value: 'appointment.status_changed', label: 'appointment.status_changed' },
                { value: 'appointment.rescheduled', label: 'appointment.rescheduled' },
                { value: 'lead.created', label: 'lead.created' },
              ]}
            />
            <Select
              label="Notification Channel *"
              value={channel}
              onChange={(e) => setChannel(e.target.value as 'EMAIL' | 'WHATSAPP')}
              options={[
                { value: 'EMAIL', label: 'Email' },
                { value: 'WHATSAPP', label: 'WhatsApp (Meta Cloud API)' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Recipient Target *"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value as 'customer' | 'fixed')}
              options={[
                { value: 'customer', label: 'Customer (on file)' },
                { value: 'fixed', label: 'Fixed Team Member Address' },
              ]}
            />
            {recipient === 'fixed' && (
              <Input
                label="Fixed Recipient Email *"
                type="email"
                required
                placeholder="manager@business.com"
                value={fixedTo}
                onChange={(e) => setFixedTo(e.target.value)}
              />
            )}
            {channel === 'EMAIL' && (
              <Input
                label="Email Subject"
                placeholder="Your Appointment Details"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 block">
              Message Template *
            </label>
            <textarea
              required
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="block w-full rounded-lg border border-slate-300 bg-white p-3 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-mono"
            />
            <p className="text-[11px] text-slate-400">
              Supported template tags: <code className="text-slate-600 font-bold">&#123;&#123;customerName&#125;&#125;</code>, <code className="text-slate-600 font-bold">&#123;&#123;businessName&#125;&#125;</code>, <code className="text-slate-600 font-bold">&#123;&#123;reference&#125;&#125;</code>, <code className="text-slate-600 font-bold">&#123;&#123;startAt&#125;&#125;</code>
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Create Workflow
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Execution History Modal */}
      <Dialog
        open={Boolean(selectedWorkflow)}
        onOpenChange={(open) => !open && setSelectedWorkflow(null)}
        title={`Execution Runs: ${selectedWorkflow?.name}`}
        description="Historical execution log and action dispatch statuses."
        maxWidth="lg"
      >
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {isLoadingExecs ? (
            <p className="text-xs text-slate-400">Loading execution runs...</p>
          ) : executions.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No runs recorded for this workflow yet.</p>
          ) : (
            executions.map((ex) => (
              <div key={ex._id} className="p-3 bg-slate-50 rounded-lg border text-xs flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-800">{ex.trigger}</div>
                  <div className="text-[11px] text-slate-400">{formatDateTime(ex.createdAt)}</div>
                </div>
                <div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      ex.status === 'COMPLETED'
                        ? 'bg-emerald-50 text-emerald-700'
                        : ex.status === 'FAILED'
                        ? 'bg-rose-50 text-rose-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {ex.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </Dialog>
    </DashboardLayout>
  );
}
