// Sends email through Azure Communication Services. The connection string comes from the key vault.
import { EmailClient } from '@azure/communication-email';

let client;
function mailer() {
  const cs = process.env.ACS_CONNECTION_STRING || '';
  if (!cs || cs.startsWith('@Microsoft.KeyVault(')) return null;
  if (!client) client = new EmailClient(cs);
  return client;
}

export function canSendMail() { return !!mailer() && !!process.env.MAIL_FROM; }

// Starts the send and returns once Azure has accepted it. Delivery itself continues in the background.
export async function sendMail({ to, subject, text, html }) {
  const c = mailer();
  if (!c || !process.env.MAIL_FROM) throw new Error('Email is not configured.');
  const poller = await c.beginSend({
    senderAddress: process.env.MAIL_FROM,
    content: { subject, plainText: text, html },
    recipients: { to: [{ address: to }] },
  });
  return poller.getOperationState().id || 'accepted';
}
