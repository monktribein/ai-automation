'use client';

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { importsExportsService } from '@/lib/api/services/imports-exports';
import { ExcelResource, ImportJob, ExportJob } from '@/lib/api/types';
import {
  FileSpreadsheet,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  FileCheck,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { ApiClientError } from '@/lib/api/client';

export default function DataManagementPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'import' | 'export'>('import');
  const [resource, setResource] = useState<ExcelResource>('customers');

  // Import State
  const [file, setFile] = useState<File | null>(null);
  const [duplicateStrategy, setDuplicateStrategy] = useState<'skip' | 'update' | 'fail'>('skip');
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [validationReport, setValidationReport] = useState<{
    totalRows: number;
    validRows: number;
    invalidRows: number;
    errors: Array<{ row: number; column?: string; message: string }>;
  } | null>(null);
  const [activeImportJob, setActiveImportJob] = useState<ImportJob | null>(null);

  // Export State
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [activeExportJob, setActiveExportJob] = useState<ExportJob | null>(null);

  // Poll import job if processing
  useEffect(() => {
    if (!activeImportJob || activeImportJob.status === 'COMPLETED' || activeImportJob.status === 'FAILED') {
      return;
    }
    const timer = setInterval(async () => {
      try {
        const updated = await importsExportsService.getImportStatus(activeImportJob._id || activeImportJob.id!);
        setActiveImportJob(updated);
        if (updated.status === 'COMPLETED') {
          toast({ type: 'success', title: 'Import completed successfully' });
        }
      } catch {}
    }, 2500);

    return () => clearInterval(timer);
  }, [activeImportJob, toast]);

  // Poll export job if processing
  useEffect(() => {
    if (!activeExportJob || activeExportJob.status === 'COMPLETED' || activeExportJob.status === 'FAILED') {
      return;
    }
    const timer = setInterval(async () => {
      try {
        const updated = await importsExportsService.getExportStatus(activeExportJob._id || activeExportJob.id!);
        setActiveExportJob(updated);
        if (updated.status === 'COMPLETED') {
          toast({ type: 'success', title: 'Export ready for download' });
        }
      } catch {}
    }, 2000);

    return () => clearInterval(timer);
  }, [activeExportJob, toast]);

  const handleDownloadTemplate = async () => {
    try {
      await importsExportsService.downloadTemplate(resource);
      toast({ type: 'success', title: 'Template downloaded' });
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Download failed',
        message: err instanceof Error ? err.message : 'Please check permissions.',
      });
    }
  };

  const handleDryRunValidate = async () => {
    if (!file) return;
    setIsValidating(true);
    setValidationReport(null);

    try {
      const report = await importsExportsService.validateImport(resource, file, duplicateStrategy);
      setValidationReport(report);
      if (report.invalidRows === 0) {
        toast({ type: 'success', title: `All ${report.validRows} rows passed validation!` });
      } else {
        toast({
          type: 'error',
          title: `Validation failed for ${report.invalidRows} row(s)`,
          message: 'Review row errors below before importing.',
        });
      }
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Validation failed',
        message: err instanceof ApiClientError ? err.message : 'Check file format.',
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleStartImport = async () => {
    if (!file) return;
    setIsImporting(true);

    try {
      const job = await importsExportsService.startImport(resource, file, duplicateStrategy);
      setActiveImportJob(job as unknown as ImportJob);
      toast({ type: 'info', title: 'Import job queued for processing' });
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Failed to start import',
        message: err instanceof ApiClientError ? err.message : 'Upload rejected.',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleStartExport = async () => {
    setIsExporting(true);
    try {
      const job = await importsExportsService.startExport(resource, {
        from: exportFrom ? new Date(exportFrom).toISOString() : undefined,
        to: exportTo ? new Date(exportTo).toISOString() : undefined,
      });
      setActiveExportJob(job as unknown as ExportJob);
      toast({ type: 'info', title: 'Export job initiated' });
    } catch (err: unknown) {
      toast({
        type: 'error',
        title: 'Export request failed',
        message: err instanceof ApiClientError ? err.message : 'Please check permissions.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadExport = async () => {
    if (!activeExportJob) return;
    try {
      await importsExportsService.downloadExport(
        activeExportJob._id || activeExportJob.id!,
        `${resource}-export.xlsx`
      );
    } catch {
      toast({ type: 'error', title: 'Download failed' });
    }
  };

  return (
    <DashboardLayout
      title="Excel Data Management"
      description="Bulk import data with dry-run verification, download templates, and export authorized tenant records"
      breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Data Management' }]}
    >
      {/* Resource & Operation Selector */}
      <Card className="mb-6">
        <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-700">Target Resource:</span>
            <div className="w-56">
              <Select
                value={resource}
                onChange={(e) => {
                  setResource(e.target.value as ExcelResource);
                  setValidationReport(null);
                  setActiveImportJob(null);
                  setActiveExportJob(null);
                }}
                options={[
                  { value: 'customers', label: 'Customers' },
                  { value: 'leads', label: 'Leads & Enquiries' },
                  { value: 'services', label: 'Services Catalog' },
                  { value: 'staff', label: 'Staff Directory' },
                  { value: 'appointments', label: 'Appointments' },
                ]}
              />
            </div>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('import')}
              className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeTab === 'import'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Bulk Import
            </button>
            <button
              onClick={() => setActiveTab('export')}
              className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeTab === 'export'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Export Records
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Import View */}
      {activeTab === 'import' && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>1. Download Official Template</CardTitle>
                <CardDescription>
                  Download the formatted .xlsx template with validated columns for {resource}.
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={handleDownloadTemplate} className="gap-1.5">
                <Download className="w-4 h-4 text-emerald-600" /> Download Template
              </Button>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Upload Workbook & Validate</CardTitle>
              <CardDescription>
                Select an .xlsx file to execute a dry-run validation. Row-level errors are reported without writing to database.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 block">Select .xlsx File</label>
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(e) => {
                      setFile(e.target.files?.[0] || null);
                      setValidationReport(null);
                    }}
                    className="block w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer border rounded-lg p-1"
                  />
                </div>

                <Select
                  label="Duplicate Strategy"
                  value={duplicateStrategy}
                  onChange={(e) => setDuplicateStrategy(e.target.value as 'skip' | 'update' | 'fail')}
                  options={[
                    { value: 'skip', label: 'Skip duplicates on unique keys' },
                    { value: 'update', label: 'Update existing records' },
                    { value: 'fail', label: 'Fail entire import on collision' },
                  ]}
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Button
                  variant="outline"
                  size="md"
                  disabled={!file}
                  isLoading={isValidating}
                  onClick={handleDryRunValidate}
                  className="gap-1.5"
                >
                  <FileCheck className="w-4 h-4 text-blue-600" /> Run Dry-Run Validation
                </Button>

                <Button
                  variant="primary"
                  size="md"
                  disabled={!file || (validationReport !== null && validationReport.invalidRows > 0)}
                  isLoading={isImporting}
                  onClick={handleStartImport}
                  className="gap-1.5"
                >
                  <Upload className="w-4 h-4" /> Start Official Import
                </Button>
              </div>

              {/* Validation Report Card */}
              {validationReport && (
                <div className="mt-4 p-4 rounded-xl border bg-slate-50 space-y-3">
                  <div className="flex items-center gap-4 text-xs">
                    <span className="font-semibold text-slate-700">Validation Results:</span>
                    <span className="text-emerald-700 font-bold">
                      ✓ {validationReport.validRows} valid rows
                    </span>
                    {validationReport.invalidRows > 0 && (
                      <span className="text-rose-700 font-bold">
                        ✗ {validationReport.invalidRows} invalid rows
                      </span>
                    )}
                  </div>

                  {validationReport.errors && validationReport.errors.length > 0 && (
                    <div className="border border-rose-200 rounded-lg overflow-hidden bg-white">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-rose-50/50">
                            <TableHead className="text-rose-900">Row #</TableHead>
                            <TableHead className="text-rose-900">Column</TableHead>
                            <TableHead className="text-rose-900">Error Description</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {validationReport.errors.map((err, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-mono text-xs font-bold text-slate-800">
                                {err.row}
                              </TableCell>
                              <TableCell className="text-xs font-mono text-slate-600">
                                {err.column || 'General'}
                              </TableCell>
                              <TableCell className="text-xs text-rose-700 font-medium">
                                {err.message}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}

              {/* Active Import Job Progress */}
              {activeImportJob && (
                <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-blue-600 animate-spin" />
                    <div>
                      <h4 className="text-xs font-bold text-blue-900">
                        Import Job #{activeImportJob._id || activeImportJob.id}
                      </h4>
                      <p className="text-[11px] text-blue-700 mt-0.5">
                        Status: <span className="font-bold uppercase">{activeImportJob.status}</span>
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Export View */}
      {activeTab === 'export' && (
        <Card>
          <CardHeader>
            <CardTitle>Export {resource.toUpperCase()} Records</CardTitle>
            <CardDescription>
              Generate an official .xlsx workbook containing authorized records. PII is masked unless your account holds the customers:pii permission.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
              <Input
                label="From Date (Optional)"
                type="date"
                value={exportFrom}
                onChange={(e) => setExportFrom(e.target.value)}
              />
              <Input
                label="To Date (Optional)"
                type="date"
                value={exportTo}
                onChange={(e) => setExportTo(e.target.value)}
              />
            </div>

            <Button
              variant="primary"
              size="md"
              isLoading={isExporting}
              onClick={handleStartExport}
              className="gap-1.5"
            >
              <FileSpreadsheet className="w-4 h-4" /> Generate Export File
            </Button>

            {activeExportJob && (
              <div className="p-4 rounded-xl border bg-slate-50 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-800">
                    Export Job #{activeExportJob._id || activeExportJob.id}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Status: <span className="font-semibold uppercase">{activeExportJob.status}</span>
                  </div>
                </div>
                {activeExportJob.status === 'COMPLETED' ? (
                  <Button size="sm" variant="success" onClick={handleDownloadExport} className="gap-1.5">
                    <Download className="w-4 h-4" /> Download .xlsx
                  </Button>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-blue-600">
                    <Clock className="w-4 h-4 animate-spin" /> Preparing file...
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </DashboardLayout>
  );
}
