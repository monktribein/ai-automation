'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { auditLogsService } from '@/lib/api/services/team';
import { AuditLog, PaginationMeta } from '@/lib/api/types';
import { formatDate } from '@/lib/utils';
import {
  FileText,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Shield,
  Eye,
  Terminal,
  Calendar,
} from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';

export default function AuditLogsPage() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [actionFilter, setActionFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [inspectLog, setInspectLog] = useState<AuditLog | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await auditLogsService.list({
        page,
        limit: 25,
        action: actionFilter.trim() || undefined,
        resourceType: resourceFilter !== 'ALL' ? resourceFilter : undefined,
      });
      setLogs(res.items || []);
      if (res.meta) setMeta(res.meta);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load audit logs';
      addToast('error', msg);
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, resourceFilter, addToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getActionBadge = (action: string) => {
    if (action.includes('CREATE') || action.includes('ADD')) {
      return <Badge variant="success">{action}</Badge>;
    }
    if (action.includes('DELETE') || action.includes('REVOKE') || action.includes('CANCEL')) {
      return <Badge variant="destructive">{action}</Badge>;
    }
    if (action.includes('UPDATE') || action.includes('PATCH') || action.includes('EDIT')) {
      return <Badge variant="warning">{action}</Badge>;
    }
    return <Badge variant="outline">{action}</Badge>;
  };

  return (
    <DashboardLayout
      title="Audit & Compliance Logs"
      description="Immutable activity record of administrative operations, security events, and tenant data changes"
      requiredPermission="audit:read"
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={loadData}
          disabled={loading}
          className="gap-2"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Filter Controls */}
        <Card>
          <CardContent className="p-4 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex-1 w-full md:max-w-md">
              <Input
                placeholder="Filter by action keyword (e.g. MEMBER, APPOINTMENT)..."
                value={actionFilter}
                onChange={(e) => {
                  setActionFilter(e.target.value);
                  setPage(1);
                }}
                className="text-xs h-9"
              />
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
              <Select
                value={resourceFilter}
                onChange={(e) => {
                  setResourceFilter(e.target.value);
                  setPage(1);
                }}
                options={[
                  { value: 'ALL', label: 'All Resources' },
                  { value: 'Appointment', label: 'Appointments' },
                  { value: 'Customer', label: 'Customers' },
                  { value: 'Lead', label: 'Leads' },
                  { value: 'Member', label: 'Team Members' },
                  { value: 'Settings', label: 'Settings' },
                  { value: 'Workflow', label: 'Workflows' },
                  { value: 'AI', label: 'AI Configuration' },
                ]}
                className="text-xs h-9 min-w-[150px]"
              />
            </div>
          </CardContent>
        </Card>

        {/* Audit Log Table */}
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ) : logs.length === 0 ? (
          <EmptyState
            title="No audit entries found"
            description={
              actionFilter || resourceFilter !== 'ALL'
                ? 'No log records match the applied criteria.'
                : 'Activity logs will record here as users make operational changes.'
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Actor</th>
                    <th className="py-3 px-4">Resource</th>
                    <th className="py-3 px-4">IP Address</th>
                    <th className="py-3 px-4 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                        {formatDate(log.createdAt, { includeTime: true })}
                      </td>
                      <td className="py-3 px-4 font-mono">{getActionBadge(log.action)}</td>
                      <td className="py-3 px-4 text-slate-800 font-medium">
                        {log.actorEmail || log.actorUserId || 'System Automation'}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        <span className="font-semibold text-slate-800">{log.resourceType}</span>
                        {log.resourceId && (
                          <span className="text-slate-400 font-mono text-[11px] ml-1.5 truncate inline-block max-w-[120px]">
                            #{log.resourceId.slice(-6)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                        {log.ipAddress || '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setInspectLog(log)}
                          className="h-7 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2"
                        >
                          <Eye className="w-3.5 h-3.5 mr-1" />
                          Inspect
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50 text-xs text-slate-500">
              <span>
                Showing {logs.length} of {meta.total} records (Page {page} of {meta.totalPages || 1})
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="h-8 px-2.5 text-xs"
                >
                  <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= (meta.totalPages || 1)}
                  className="h-8 px-2.5 text-xs"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Inspect Log Entry Dialog */}
        <Dialog
          isOpen={!!inspectLog}
          onClose={() => setInspectLog(null)}
          title={`Audit Event: ${inspectLog?.action}`}
        >
          {inspectLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Actor</span>
                  <span className="font-semibold text-slate-800">{inspectLog.actorEmail || inspectLog.actorUserId || 'System'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Timestamp</span>
                  <span className="text-slate-700">{formatDate(inspectLog.createdAt, { includeTime: true })}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Resource</span>
                  <span className="text-slate-800 font-medium">{inspectLog.resourceType} {inspectLog.resourceId ? `(${inspectLog.resourceId})` : ''}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">IP / User Agent</span>
                  <span className="text-slate-700 font-mono text-[11px] truncate block">{inspectLog.ipAddress || 'Unknown IP'}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-700 block flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-blue-600" />
                  Payload Diff & State Changes
                </span>
                <pre className="bg-slate-900 text-slate-100 p-3 rounded-lg text-[11px] font-mono overflow-x-auto max-h-64">
                  {inspectLog.diff ? JSON.stringify(inspectLog.diff, null, 2) : '// No diff payload recorded for this operation'}
                </pre>
              </div>

              <div className="flex justify-end pt-2">
                <Button variant="outline" onClick={() => setInspectLog(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
