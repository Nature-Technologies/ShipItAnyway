import nodemailer from 'nodemailer';

const FROM = process.env.SMTP_FROM ?? 'ShipItAnyway <no-reply@shipitanyway.local>';

function getTransport() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
    });
  }
  // ponytail: nodemailer's built-in jsonTransport IS the log transport — no custom transport class.
  return nodemailer.createTransport({ jsonTransport: true });
}

console.warn(`[mailer] transport mode: ${process.env.SMTP_HOST ? 'smtp' : 'log (jsonTransport)'}`);

export async function sendMail(opts: {
  to: string; subject: string; text: string; html?: string;
}) {
  const info = await getTransport().sendMail({ from: FROM, ...opts });
  // jsonTransport returns a `message` JSON string not present on the generic SMTP SentMessageInfo type.
  if (!process.env.SMTP_HOST) console.warn('[mailer] logged (SMTP unset):', (info as { message?: string }).message);
  return info;
}

export async function sendInviteEmail(to: string, acceptUrl: string) {
  return sendMail({
    to,
    subject: 'You are invited to ShipItAnyway',
    text: `You've been invited to ShipItAnyway. Accept your invite: ${acceptUrl}`,
    html: `<p>You've been invited to ShipItAnyway.</p>`
      + `<p><a href="${acceptUrl}">Accept your invite</a></p>`
  });
}
