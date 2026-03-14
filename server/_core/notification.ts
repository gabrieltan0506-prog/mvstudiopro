export type NotificationPayload = {
  title: string;
  content: string;
};

export async function notifyOwner(
  _payload: NotificationPayload,
): Promise<boolean> {
  console.warn("[Notification] legacy notification bridge removed");
  return false;
}
