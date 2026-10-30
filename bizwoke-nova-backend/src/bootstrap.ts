import { registerNotificationJobs } from './modules/notifications/notification.service';
import { registerAppointmentNotificationHandlers } from './modules/notifications/appointment-notifications';
import { registerWorkflowHandlers } from './modules/workflows/workflow.service';
import { registerWhatsAppJobs } from './modules/whatsapp/whatsapp.service';
import { registerImportExportJobs } from './modules/imports-exports/import-export.service';
import { registerCleanupJobs } from './jobs/cleanup';
import { registerHandoffHandlers } from './modules/conversations/handoff';
import { registerGoogleSheetHandlers } from './modules/google-sheets/google-sheet.service';

let done = false;

/** Wires domain-event listeners and job handlers. Shared by the API process and the worker. */
export function bootstrapModules() {
  if (done) return;
  done = true;
  registerNotificationJobs();
  registerAppointmentNotificationHandlers();
  registerWorkflowHandlers();
  registerWhatsAppJobs();
  registerImportExportJobs();
  registerCleanupJobs();
  registerHandoffHandlers();
  registerGoogleSheetHandlers();
}
