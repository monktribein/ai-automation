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
import { knowledgeBaseService } from '@/lib/api/services/ai';
import { KnowledgeArticle, KnowledgeStatus } from '@/lib/api/types';
import { formatDate } from '@/lib/utils';
import { BookOpen, Plus, Search, CheckCircle, Edit2, Archive, ShieldCheck } from 'lucide-react';
import { ApiClientError } from '@/lib/api/client';

export default function KnowledgeBasePage() {
  const { toast } = useToast();
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Create / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<KnowledgeArticle | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadArticles = useCallback(async () => {
    setIsLoading(true);
    try {
      if (searchQuery.trim()) {
        const results = await knowledgeBaseService.search(searchQuery.trim());
        setArticles(results);
      } else {
        const res = await knowledgeBaseService.list({
          status: statusFilter ? (statusFilter as KnowledgeStatus) : undefined,
          limit: 50,
        });
        setArticles(res.items);
      }
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Failed to load knowledge articles',
        message: err instanceof Error ? err.message : 'Please check permissions.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, statusFilter, toast]);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  const openCreateModal = () => {
    setEditingArticle(null);
    setTitle('');
    setContent('');
    setTagsInput('');
    setError(null);
    setModalOpen(true);
  };

  const openEditModal = (a: KnowledgeArticle) => {
    setEditingArticle(a);
    setTitle(a.title);
    setContent(a.content);
    setTagsInput(a.tags?.join(', ') || '');
    setError(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      if (editingArticle) {
        await knowledgeBaseService.update(editingArticle._id, {
          title,
          content,
          tags,
        });
        toast({
          type: 'success',
          title: 'Article updated',
          message: 'Edits automatically reset status to DRAFT until reviewed.',
        });
      } else {
        await knowledgeBaseService.create({
          title,
          content,
          tags,
        });
        toast({
          type: 'success',
          title: 'Draft article created',
        });
      }
      setModalOpen(false);
      loadArticles();
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to save article.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async (id: string, articleTitle: string) => {
    try {
      await knowledgeBaseService.update(id, { status: 'APPROVED' });
      toast({
        type: 'success',
        title: 'Article approved',
        message: `"${articleTitle}" is now active and accessible to the AI assistant.`,
      });
      loadArticles();
    } catch {
      toast({ type: 'error', title: 'Approval failed' });
    }
  };

  const handleArchive = async (id: string) => {
    if (!confirm('Are you sure you want to archive this knowledge article?')) return;
    try {
      await knowledgeBaseService.archive(id);
      toast({ type: 'success', title: 'Article archived' });
      loadArticles();
    } catch {
      toast({ type: 'error', title: 'Failed to archive article' });
    }
  };

  return (
    <DashboardLayout
      title="Knowledge Base"
      description="Manage factual business articles, policies, FAQs, and pricing for AI assistant knowledge retrieval"
      actions={
        <Button onClick={openCreateModal} size="sm" variant="primary" className="gap-1.5 shadow-xs">
          <Plus className="w-4 h-4" /> Add Article
        </Button>
      }
      breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Knowledge Base' }]}
    >
      {/* Search and Filters */}
      <Card className="mb-6">
        <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              loadArticles();
            }}
            className="flex-1 flex gap-2 w-full"
          >
            <Input
              placeholder="Search approved articles (keyword search)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              icon={<Search className="w-4 h-4" />}
            />
            <Button type="submit" variant="outline" size="md">
              Search
            </Button>
          </form>

          <div className="w-full sm:w-48">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: '', label: 'All Statuses' },
                { value: 'APPROVED', label: 'APPROVED — Active in AI' },
                { value: 'DRAFT', label: 'DRAFT — Pending Review' },
                { value: 'ARCHIVED', label: 'ARCHIVED' },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton rows={6} columns={5} />
      ) : articles.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="w-8 h-8" />}
          title="No knowledge articles found"
          description="Create FAQs, service policies, location directions, and operating guidelines so your AI assistant answers accurately."
          actionLabel="Create First Article"
          onAction={openCreateModal}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Article Title</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {articles.map((a) => (
              <TableRow key={a._id}>
                <TableCell>
                  <div className="font-semibold text-slate-900">{a.title}</div>
                  <div className="text-xs text-slate-500 line-clamp-1 mt-0.5">{a.content}</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {a.tags && a.tags.length > 0 ? (
                      a.tags.map((t, idx) => (
                        <span key={idx} className="text-[10px] font-medium bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                          #{t}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={a.status} />
                </TableCell>
                <TableCell className="text-xs text-slate-400">
                  {formatDate(a.updatedAt || a.createdAt)}
                </TableCell>
                <TableCell className="text-right space-x-1">
                  {a.status === 'DRAFT' && (
                    <Button
                      size="sm"
                      variant="success"
                      onClick={() => handleApprove(a._id, a.title)}
                      className="text-xs gap-1"
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> Approve
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openEditModal(a)}
                    className="p-1.5 text-slate-600 hover:text-blue-600"
                    title="Edit"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleArchive(a._id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600"
                    title="Archive"
                  >
                    <Archive className="w-3.5 h-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create / Edit Article Modal */}
      <Dialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingArticle ? 'Edit Article' : 'Create Knowledge Article'}
        description="Provide comprehensive, truthful information. Only APPROVED articles are supplied to the AI engine."
        maxWidth="lg"
      >
        {error && <div className="mb-4 text-xs text-rose-600 font-medium">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Article Title *"
            required
            placeholder="e.g. Parking and Location Directions"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 tracking-wide">
              Article Content *
            </label>
            <textarea
              required
              rows={8}
              placeholder="Enter exact business guidelines, pricing details, or FAQ answer..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="block w-full rounded-lg border border-slate-300 bg-white p-3 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <Input
            label="Tags (Comma-separated)"
            placeholder="parking, directions, location, facility"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            hint="Keywords used to match customer queries"
          />

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              {editingArticle ? 'Save Changes' : 'Save Draft'}
            </Button>
          </div>
        </form>
      </Dialog>
    </DashboardLayout>
  );
}
