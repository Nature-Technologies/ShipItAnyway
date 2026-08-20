import assert from 'node:assert/strict';
import test from 'node:test';

delete process.env.SMTP_HOST; // force jsonTransport (log) mode (read at call time)
import { sendMail, sendInviteEmail } from '../src/services/mailer';

test('sendInviteEmail logs the accept link via jsonTransport (no SMTP)', async () => {
  const info = await sendInviteEmail('invitee@example.com', 'https://app.test/accept-invite?token=RAW');
  const message = JSON.parse(info.message as string);
  assert.equal(message.to[0].address, 'invitee@example.com');
  assert.match(message.subject, /ShipItAnyway/);
  assert.ok(message.text.includes('https://app.test/accept-invite?token=RAW'));
});

test('sendMail returns a reusable message shape (Phase 3 seam)', async () => {
  const info = await sendMail({ to: 'r@example.com', subject: 'Report', text: 'body' });
  const message = JSON.parse(info.message as string);
  assert.equal(message.subject, 'Report');
  assert.equal(message.text, 'body');
});
