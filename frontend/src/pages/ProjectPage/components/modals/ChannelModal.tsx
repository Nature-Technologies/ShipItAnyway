import { Alert, Button, Checkbox, Col, Input, Modal, Row, Space, Typography } from 'antd';
import { useProjectPage } from '../../hooks/useProjectPage';
import { channelRuleDescriptions } from '../../utils';

const { Text } = Typography;

export default function ChannelModal() {
  const {
    channelModalOpen,
    setChannelModalOpen,
    channelMode,
    channelType,
    channelForm,
    setChannelForm,
    channelSaving,
    channelTesting,
    channelTestFeedback,
    channelDraftReadyForTest,
    saveChannel,
    sendChannelDraftTest
  } = useProjectPage();

  return (
    <Modal
      title={
        channelMode === 'edit'
          ? channelType === 'telegram'
            ? 'Edit Telegram alert'
            : 'Edit Slack alert'
          : channelType === 'telegram'
            ? 'Add Telegram alert'
            : 'Add Slack alert'
      }
      open={channelModalOpen}
      onCancel={() => setChannelModalOpen(false)}
      confirmLoading={channelSaving}
      width={760}
      centered
      style={{ top: 24 }}
      styles={{
        body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }
      }}
      footer={
        <Space wrap style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={() => setChannelModalOpen(false)}>Cancel</Button>
          <Button onClick={() => void sendChannelDraftTest()} loading={channelTesting} disabled={!channelDraftReadyForTest || channelTesting}>
            Send test notification
          </Button>
          <Button type="primary" onClick={() => void saveChannel()} loading={channelSaving}>
            {channelMode === 'edit' ? 'Save changes' : 'Create alert'}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Text type="secondary">Alert name</Text>
          <Input
            value={channelForm.name}
            onChange={(event) => setChannelForm((current) => ({ ...current, name: event.target.value }))}
            placeholder={channelType === 'telegram' ? 'Dev alerts' : 'Production alerts'}
            style={{ marginTop: 8 }}
          />
        </div>

        {channelType === 'telegram' ? (
          <Row gutter={16}>
            <Col span={12}>
              <div>
                <Text type="secondary">Bot token</Text>
                <Input.Password
                  value={channelForm.botToken}
                  onChange={(event) => setChannelForm((current) => ({ ...current, botToken: event.target.value }))}
                  placeholder="123456789:AA..."
                  autoComplete="new-password"
                  style={{ marginTop: 8 }}
                />
              </div>
            </Col>
            <Col span={12}>
              <div>
                <Text type="secondary">Chat ID</Text>
                <Input
                  value={channelForm.chatId}
                  onChange={(event) => setChannelForm((current) => ({ ...current, chatId: event.target.value }))}
                  placeholder="-1001234567890"
                  style={{ marginTop: 8 }}
                />
                <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                  Add the bot to your Telegram chat or channel, then paste the chat ID here.
                </Text>
              </div>
            </Col>
          </Row>
        ) : (
          <div>
            <Text type="secondary">Webhook URL</Text>
            {channelMode === 'edit' ? (
              <Input.Password
                value={channelForm.webhookUrl}
                onChange={(event) => setChannelForm((current) => ({ ...current, webhookUrl: event.target.value }))}
                placeholder="Replace webhook URL"
                autoComplete="new-password"
                style={{ marginTop: 8 }}
              />
            ) : (
              <Input
                value={channelForm.webhookUrl}
                onChange={(event) => setChannelForm((current) => ({ ...current, webhookUrl: event.target.value }))}
                placeholder="https://hooks.slack.com/services/..."
                autoComplete="off"
                style={{ marginTop: 8 }}
              />
            )}
            <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              Paste an incoming webhook URL from your Slack workspace.
            </Text>
          </div>
        )}

        <div style={{ display: 'grid', gap: 12 }}>
          <Text strong>Notification rules</Text>
          {channelRuleDescriptions().map((rule) => {
            const key = rule.key;
            return (
              <div key={rule.key} style={{ display: 'grid', gap: 4 }}>
                <Checkbox
                  checked={channelForm[key]}
                  onChange={(event) => setChannelForm((current) => ({ ...current, [key]: event.target.checked }))}
                >
                  {rule.label}
                </Checkbox>
                <Text type="secondary" style={{ fontSize: 12, marginLeft: 24 }}>
                  {rule.helper}
                </Text>
              </div>
            );
          })}
        </div>

        {channelTestFeedback ? (
          <Alert
            type={channelTestFeedback.type}
            showIcon
            message={channelTestFeedback.text}
          />
        ) : null}
      </Space>
    </Modal>
  );
}
