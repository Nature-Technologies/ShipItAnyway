import assert from 'node:assert/strict';
import test from 'node:test';

delete process.env.SMTP_HOST; // force jsonTransport (log) mode
import { sendReportEmail } from '../src/services/mailer';

test('sendReportEmail renders the digest summary', async () => {
  const info = await sendReportEmail('ops@example.com', {
    projectName: 'Acme', environmentName: 'staging', reportName: 'Nightly',
    windowStart: new Date('2026-08-31T00:00:00Z'), windowEnd: new Date('2026-09-01T00:00:00Z'),
    total: 10, passed: 8, failed: 2, passRate: 80, avgDurationMs: 1500,
    failures: [{ checkName: 'Login', error: 'timeout' }],
    flaky: [{ checkName: 'Search', passRate: 60 }]
  });
  const message = JSON.parse((info as unknown as { message: string }).message);
  assert.equal(message.to[0].address, 'ops@example.com');
  assert.match(message.subject, /Nightly/);
  assert.match(message.subject, /staging/);
  assert.ok(message.text.includes('80%'));
  assert.ok(message.text.includes('Login'));
});

test('sendReportEmail escapes HTML in user-controlled values', async () => {
  const info = await sendReportEmail('ops@example.com', {
    projectName: 'Acme & Co', environmentName: '<prod>', reportName: '<script>alert("xss")</script>',
    windowStart: new Date('2026-08-31T00:00:00Z'), windowEnd: new Date('2026-09-01T00:00:00Z'),
    total: 1, passed: 0, failed: 1, passRate: 0, avgDurationMs: null,
    failures: [{ checkName: 'Login <img>', error: null }],
    flaky: []
  });
  const message = JSON.parse((info as unknown as { message: string }).message);
  const html = message.html;
  // Escaped forms should be in HTML
  assert.ok(html.includes('&lt;script&gt;'), 'reportName should be escaped');
  assert.ok(html.includes('&lt;prod&gt;'), 'environmentName should be escaped');
  assert.ok(html.includes('Acme &amp; Co'), 'projectName should be escaped');
  assert.ok(html.includes('Login &lt;img&gt;'), 'checkName should be escaped');
  // Raw forms should NOT be in HTML
  assert.ok(!html.includes('<script>alert'), 'should not contain raw script tag');
  assert.ok(!html.includes('<img>'), 'should not contain raw img tag');
});
