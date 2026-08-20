import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Spin, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import appLogo from '../assets/shipitanyway_logo.png';
import AppFooter from '../components/AppFooter';
import { acceptInvite, validateInvite } from '../api/client';
import { APP_DESCRIPTION, APP_NAME } from '../utils/appMeta';

export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid'>('loading');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    if (!token) { setStatus('invalid'); return; }
    validateInvite(token)
      .then((res) => { if (active) { setEmail(res.email); setStatus('valid'); } })
      .catch(() => { if (active) setStatus('invalid'); });
    return () => { active = false; };
  }, [token]);

  const handleSubmit = async (values: { password: string }) => {
    setSubmitting(true);
    setError('');
    try {
      await acceptInvite(token, values.password);
      navigate('/login', { state: { notice: 'Invite accepted — please sign in.' } });
    } catch {
      setError('Could not accept this invite. It may have expired or already been used.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 48%, #e2e8f0 100%)',
      padding: 24
    }}>
      <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Card style={{ width: 400, borderRadius: 24, boxShadow: '0 30px 80px rgba(15, 23, 42, 0.35)' }}>
          <div style={{ textAlign: 'center', marginBottom: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <img src={appLogo} alt={`${APP_NAME} logo`} style={{ width: 56, height: 56, objectFit: 'contain' }} />
            <Typography.Title level={3} style={{ margin: 0 }}>
              {APP_NAME}
            </Typography.Title>
            <Typography.Text type="secondary">Accept your invitation</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {APP_DESCRIPTION}
            </Typography.Text>
          </div>

          {status === 'loading' && (
            <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
          )}

          {status === 'invalid' && (
            <Alert
              message="Invalid or expired invite"
              description="This invitation link is no longer valid. Ask an administrator to send a new one."
              type="error"
              showIcon
            />
          )}

          {status === 'valid' && (
            <>
              {error && <Alert message={error} type="error" style={{ marginBottom: 16 }} showIcon />}
              <Form layout="vertical" onFinish={handleSubmit}>
                <Form.Item label="Email">
                  <Input value={email} disabled size="large" />
                </Form.Item>
                <Form.Item
                  name="password"
                  label="Choose a password"
                  rules={[{ required: true, min: 8, message: 'At least 8 characters' }]}
                >
                  <Input.Password prefix={<LockOutlined />} placeholder="New password" size="large" />
                </Form.Item>
                <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
                  Accept invite
                </Button>
              </Form>
            </>
          )}
        </Card>
      </div>
      <div style={{ width: '100%' }}>
        <AppFooter bottomPadding={0} />
      </div>
    </div>
  );
}
