'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { notificationsService } from '@/lib/api/services/workflows';
import { NotificationLog, NotificationStatus } from '@/lib/api/types';
import { formatDateTime } from '@/lib/utils';
import { Bell, Mail, MessageSquare, ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react';

export default function NotificationsPage() {
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<NotificationLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [channelFilter, setChannelFilter] = useState<string>('');

  const loadNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await notificationsService.list({
        page,
        limit: 20,
        status: statusFilter ? (statusFilter as NotificationStatus) : undefined,
        channel: channelFilter ? (channelFilter as 'EMAIL' | 'WHATSAPP') : undefined,
      });
      setNotifications(res.items);
      setTotalPages(res.meta?.totalPages || 1);
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Failed to load notifications',
        message: err instanceof Error ? err.message : 'Please check permissions.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [page, statusFilter, channelFilter, toast]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  return (
    <DashboardLayout
      title="Notification Dispatch Log"
      description="Auditable delivery log for customer appointment confirmations, reminders, and alerts"
      actions={
        <Button onClick={loadNotifications} size="sm" variant="outline" className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      }
      breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Notifications' }]}
    >
      <Card className="mb-6">
        <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-3">
          <div className="w-full sm:w-56">
            <Select
              label="Filter Status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Statuses' },
                { value: 'QUEUED', label: 'Queued' },
                { value: 'SENT', label: 'Sent' },
                { value: 'DELIVERED', label: 'Delivered' },
                { value: 'READ', label: 'Read' },
                { value: 'FAILED', label: 'Failed' },
                { value: 'CANCELLED', label: 'Cancelled' },
              ]}
            />
          </div>
          <div className="w-full sm:w-56">
            <Select
              label="Filter Channel"
              value={channelFilter}
              onChange={(e) => {
                setChannelFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Channels' },
                { value: 'EMAIL', label: 'Email' },
                { value: 'WHATSAPP', label: 'WhatsApp' },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <TableSkeleton rows={8} columns={5} />
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={<Bell className="w-8 h-8" />}
          title="No notification records"
          description="Automated notifications dispatched to customers via WhatsApp or Email will appear in this audit log."
        />
      ) : (
        <div className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Template / Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dispatched</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notifications.map((n) => (
                <TableRow key={n._id}>
                  <TableCell className="text-xs font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      {n.channel === 'EMAIL' ? (
                        <Mail className="w-4 h-4 text-blue-500" />
                      ) : (
                        <MessageSquare className="w-4 h-4 text-emerald-500" />
                      )}
                      {n.channel}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-800">
                    {n.to}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {n.templateKey || 'Direct Notification'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={n.status} />
                  </TableCell>
                  <TableCell className="text-xs text-slate-400">
                    {formatDateTime(n.sentAt || n.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="flex items-center justify-between text-xs text-slate-500 px-2 py-3 border-t">
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
    </DashboardLayout>
  );
}
