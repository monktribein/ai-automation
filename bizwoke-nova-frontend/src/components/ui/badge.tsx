import * as React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?:
    | 'default'
    | 'success'
    | 'warning'
    | 'danger'
    | 'destructive'
    | 'secondary'
    | 'info'
    | 'purple'
    | 'neutral'
    | 'outline';
  size?: 'sm' | 'md';
}

export function Badge({ className, variant = 'default', size = 'sm', children, ...props }: BadgeProps) {
  const variants = {
    default: 'bg-blue-50 text-blue-700 border-blue-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-rose-50 text-rose-700 border-rose-200',
    destructive: 'bg-rose-50 text-rose-700 border-rose-200',
    secondary: 'bg-slate-100 text-slate-700 border-slate-200',
    info: 'bg-sky-50 text-sky-700 border-sky-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
    outline: 'bg-transparent text-slate-600 border-slate-300',
  };

  const sizes = {
    sm: 'text-[11px] px-2 py-0.5 leading-4 font-medium',
    md: 'text-xs px-2.5 py-1 leading-4 font-medium',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border tracking-wide uppercase',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
    // Appointment Statuses
    CONFIRMED: { label: 'Confirmed', variant: 'success' },
    CHECKED_IN: { label: 'Checked In', variant: 'info' },
    COMPLETED: { label: 'Completed', variant: 'neutral' },
    REQUESTED: { label: 'Requested', variant: 'warning' },
    PENDING_CONFIRMATION: { label: 'Pending', variant: 'warning' },
    CANCELLED: { label: 'Cancelled', variant: 'danger' },
    NO_SHOW: { label: 'No Show', variant: 'danger' },

    // Lead Statuses
    NEW: { label: 'New', variant: 'info' },
    CONTACTED: { label: 'Contacted', variant: 'warning' },
    QUALIFIED: { label: 'Qualified', variant: 'purple' },
    CONVERTED: { label: 'Converted', variant: 'success' },
    LOST: { label: 'Lost', variant: 'danger' },

    // Conversation Statuses
    OPEN: { label: 'Open', variant: 'info' },
    HANDOFF: { label: 'Handoff', variant: 'warning' },
    CLOSED: { label: 'Closed', variant: 'neutral' },

    // Generic / Tenant Statuses
    ACTIVE: { label: 'Active', variant: 'success' },
    INACTIVE: { label: 'Inactive', variant: 'neutral' },
    SUSPENDED: { label: 'Suspended', variant: 'warning' },
    DEACTIVATED: { label: 'Deactivated', variant: 'danger' },
    ARCHIVED: { label: 'Archived', variant: 'neutral' },

    // Notification / Job Statuses
    QUEUED: { label: 'Queued', variant: 'warning' },
    SENT: { label: 'Sent', variant: 'info' },
    DELIVERED: { label: 'Delivered', variant: 'success' },
    READ: { label: 'Read', variant: 'success' },
    FAILED: { label: 'Failed', variant: 'danger' },
    PROCESSING: { label: 'Processing', variant: 'warning' },
  };

  const item = map[status] || { label: status, variant: 'neutral' };
  return <Badge variant={item.variant}>{item.label}</Badge>;
}
