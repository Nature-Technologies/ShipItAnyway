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
  // Never log the rendered body — it carries the raw invite token (an account-takeover credential).
  if (!process.env.SMTP_HOST) console.warn('[mailer] logged (SMTP unset): to=%s id=%s', opts.to, (info as { messageId?: string }).messageId);
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

export type ReportDigest = {
  projectName: string;
  environmentName: string;
  reportName: string;
  windowStart: Date;
  windowEnd: Date;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  avgDurationMs: number | null;
  failures: Array<{ checkName: string; error: string | null }>;
  flaky: Array<{ checkName: string; passRate: number }>;
};

export async function sendReportEmail(to: string, d: ReportDigest) {
  const esc = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const range = `${d.windowStart.toISOString()} → ${d.windowEnd.toISOString()}`;
  const avg = d.avgDurationMs == null ? 'n/a' : `${d.avgDurationMs} ms`;
  const failureLines = d.failures.length
    ? d.failures.map((f) => `- ${f.checkName}: ${f.error ?? 'failed'}`).join('\n')
    : '- none';
  const flakyLines = d.flaky.length
    ? d.flaky.map((f) => `- ${f.checkName} (${f.passRate}% pass)`).join('\n')
    : '- none';

  const text =
    `${d.reportName} — ${d.projectName} / ${d.environmentName}\n` +
    `Window: ${range}\n\n` +
    `Runs: ${d.total} | Passed: ${d.passed} | Failed: ${d.failed} | Pass rate: ${d.passRate}% | Avg: ${avg}\n\n` +
    `Failures:\n${failureLines}\n\nFlaky:\n${flakyLines}\n`;

  const html =
    `<h2>${esc(d.reportName)}</h2>` +
    `<p><strong>${esc(d.projectName)} / ${esc(d.environmentName)}</strong><br/>Window: ${range}</p>` +
    `<p>Runs: ${d.total} · Passed: ${d.passed} · Failed: ${d.failed} · Pass rate: ${d.passRate}% · Avg: ${avg}</p>` +
    `<h3>Failures</h3><ul>${d.failures.map((f) => `<li>${esc(f.checkName)}: ${esc(f.error ?? 'failed')}</li>`).join('') || '<li>none</li>'}</ul>` +
    `<h3>Flaky</h3><ul>${d.flaky.map((f) => `<li>${esc(f.checkName)} (${f.passRate}% pass)</li>`).join('') || '<li>none</li>'}</ul>`;

  return sendMail({ to, subject: `[${d.environmentName}] ${d.reportName} report`, text, html });
}
