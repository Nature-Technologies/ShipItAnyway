import nodemailer from 'nodemailer';

const FROM = process.env.SMTP_FROM ?? 'ShipItAnyway <no-reply@shipitanyway.local>';

// Escape user-controlled values for HTML text/attribute contexts (XSS guard).
function escHtml(s: string) {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Shared branded shell: outer card + indigo header + footer. Inline-styled, table-based —
// the only thing email clients (Outlook especially) render reliably. No <style>, no external CSS.
// `header` fields must be pre-escaped by the caller; `innerRows` is raw <tr> markup.
function emailShell(header: { title: string; subtitle?: string; meta?: string }, innerRows: string) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#eef2f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="background:#4f46e5;padding:28px 32px;">
          <div style="font-size:20px;font-weight:700;color:#ffffff;">${header.title}</div>
          ${header.subtitle ? `<div style="font-size:13px;color:#c7d2fe;margin-top:4px;">${header.subtitle}</div>` : ''}
          ${header.meta ? `<div style="font-size:12px;color:#a5b4fc;margin-top:8px;">${header.meta}</div>` : ''}
        </td></tr>
        ${innerRows}
        <tr><td style="padding:28px 32px;color:#94a3b8;font-size:11px;border-top:1px solid #f1f5f9;">
          Sent by ShipItAnyway
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

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
  const href = escHtml(acceptUrl); // attribute-safe; token is URL-safe but escape defensively
  const body =
    `<tr><td style="padding:32px 32px 8px 32px;font-size:15px;color:#334155;line-height:1.6;">
       You've been invited to collaborate on <strong>ShipItAnyway</strong> — automated browser checks,
       schedules, and reports for your team.
     </td></tr>
     <tr><td style="padding:16px 32px 8px 32px;">
       <a href="${href}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;">Accept your invite</a>
     </td></tr>
     <tr><td style="padding:8px 32px 24px 32px;font-size:12px;color:#94a3b8;line-height:1.6;">
       If the button doesn't work, paste this link into your browser:<br/>
       <a href="${href}" style="color:#4f46e5;word-break:break-all;">${href}</a>
     </td></tr>`;
  return sendMail({
    to,
    subject: 'You are invited to ShipItAnyway',
    text: `You've been invited to ShipItAnyway. Accept your invite: ${acceptUrl}`,
    html: emailShell({ title: 'You are invited', subtitle: 'ShipItAnyway' }, body)
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
  const fmtDate = (dt: Date) => `${dt.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
  const range = `${fmtDate(d.windowStart)} → ${fmtDate(d.windowEnd)}`;
  const avg = d.avgDurationMs == null
    ? 'n/a'
    : d.avgDurationMs >= 1000 ? `${(d.avgDurationMs / 1000).toFixed(1)} s` : `${d.avgDurationMs} ms`;
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

  const html = renderReportHtml(d, { range, avg });

  return sendMail({ to, subject: `[${d.environmentName}] ${d.reportName} report`, text, html });
}

// Inline-styled, table-based layout — the only thing email clients (Outlook especially)
// render reliably. No <style> block, no external CSS.
function renderReportHtml(
  d: ReportDigest,
  ctx: { range: string; avg: string }
) {
  const { range, avg } = ctx;
  const esc = escHtml;
  const rate = d.passRate;
  const rateColor = rate >= 95 ? '#16a34a' : rate >= 80 ? '#d97706' : '#dc2626';

  const stat = (label: string, value: string, color = '#0f172a') =>
    `<td align="center" style="padding:14px 8px;border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;">
       <div style="font-size:22px;font-weight:700;color:${color};line-height:1;">${value}</div>
       <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-top:6px;">${label}</div>
     </td>`;

  const section = (title: string, rowsHtml: string) =>
    `<tr><td style="padding:24px 32px 0 32px;">
       <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:10px;">${title}</div>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rowsHtml}</table>
     </td></tr>`;

  const emptyRow = (msg: string) =>
    `<tr><td style="padding:10px 14px;font-size:13px;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">${msg}</td></tr>`;

  const failureRows = d.failures.length
    ? d.failures.map((f) =>
        `<tr><td style="padding:10px 14px;font-size:13px;border:1px solid #fecaca;border-left:3px solid #dc2626;background:#fef2f2;">
           <span style="font-weight:600;color:#0f172a;">${esc(f.checkName)}</span>
           <div style="color:#b91c1c;margin-top:2px;">${esc(f.error ?? 'failed')}</div>
         </td></tr><tr><td style="height:6px;line-height:6px;">&nbsp;</td></tr>`
      ).join('')
    : emptyRow('No failures in this window. 🎉');

  const flakyRows = d.flaky.length
    ? d.flaky.map((f) =>
        `<tr><td style="padding:10px 14px;font-size:13px;border:1px solid #fde68a;border-left:3px solid #d97706;background:#fffbeb;">
           <span style="font-weight:600;color:#0f172a;">${esc(f.checkName)}</span>
           <span style="color:#92400e;float:right;">${f.passRate}% pass</span>
         </td></tr><tr><td style="height:6px;line-height:6px;">&nbsp;</td></tr>`
      ).join('')
    : emptyRow('No flaky checks detected.');

  const statRow =
    `<tr><td style="padding:24px 32px 0 32px;">
       <table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="border-collapse:separate;">
         <tr>
           ${stat('Runs', String(d.total))}
           ${stat('Passed', String(d.passed), '#16a34a')}
           ${stat('Failed', String(d.failed), d.failed > 0 ? '#dc2626' : '#0f172a')}
           ${stat('Pass rate', `${rate}%`, rateColor)}
           ${stat('Avg', avg)}
         </tr>
       </table>
     </td></tr>`;

  return emailShell(
    {
      title: esc(d.reportName),
      subtitle: `${esc(d.projectName)} · ${esc(d.environmentName)}`,
      meta: range
    },
    statRow + section('Failures', failureRows) + section('Flaky', flakyRows)
  );
}
