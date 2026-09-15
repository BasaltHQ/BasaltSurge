// Source actions enqueue durably; the authenticated notification worker sends through SES.
export { triggerNotification } from "./outbox";
export type { NotificationEventData } from "./outbox";
