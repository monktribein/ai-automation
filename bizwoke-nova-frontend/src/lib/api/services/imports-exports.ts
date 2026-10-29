import { apiClient, downloadFile } from '../client';
import { ExcelResource, ImportJob, ExportJob } from '../types';

export const importsExportsService = {
  async downloadTemplate(resource: ExcelResource) {
    return downloadFile(`/imports/${resource}/template`, `${resource}-import-template.xlsx`);
  },

  async validateImport(resource: ExcelResource, file: File, duplicateStrategy: 'skip' | 'update' | 'fail' = 'skip') {
    const formData = new FormData();
    formData.append('file', file);
    const res = await apiClient<{
      resource: ExcelResource;
      dryRun: boolean;
      totalRows: number;
      validRows: number;
      invalidRows: number;
      errors: Array<{ row: number; column?: string; message: string }>;
    }>(`/imports/${resource}/validate`, {
      method: 'POST',
      body: formData,
      params: { duplicateStrategy },
    });
    return res.data;
  },

  async startImport(resource: ExcelResource, file: File, duplicateStrategy: 'skip' | 'update' | 'fail' = 'skip') {
    const formData = new FormData();
    formData.append('file', file);
    const res = await apiClient<{ id: string; status: string; resource: string }>(`/imports/${resource}`, {
      method: 'POST',
      body: formData,
      params: { duplicateStrategy },
    });
    return res.data;
  },

  async getImportStatus(jobId: string) {
    const res = await apiClient<ImportJob>(`/imports/${jobId}`);
    return res.data;
  },

  async startExport(resource: ExcelResource, filter?: { from?: string; to?: string; status?: string }) {
    const res = await apiClient<{ id: string; status: string; columns: string[] }>(`/exports/${resource}`, {
      method: 'POST',
      body: filter || {},
    });
    return res.data;
  },

  async getExportStatus(jobId: string) {
    const res = await apiClient<ExportJob>(`/exports/${jobId}`);
    return res.data;
  },

  async downloadExport(jobId: string, filename = 'export.xlsx') {
    return downloadFile(`/exports/${jobId}/download`, filename);
  },
};
