import { useState } from 'react';
import { LockOutlined, MoonOutlined, SunOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Flex, Form, Input, Segmented, Typography, theme as antdTheme } from 'antd';
import { useAuth } from '../auth';
import { useThemeMode, type ThemeMode } from '../theme';

const { Title, Text } = Typography;

export default function LoginPage() {
  const { login } = useAuth();
  const { token } = antdTheme.useToken();
  const { mode, setMode } = useThemeMode();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (values: { login: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      await login(values.login.trim(), values.password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flex
      align="center"
      justify="center"
      style={{ minHeight: '100vh', background: token.colorBgLayout, padding: 16, position: 'relative' }}
    >
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <Segmented
          value={mode}
          onChange={(value) => setMode(value as ThemeMode)}
          options={[
            { value: 'light', icon: <SunOutlined />, title: 'Светлая тема' },
            { value: 'dark', icon: <MoonOutlined />, title: 'Тёмная тема' },
          ]}
        />
      </div>

      <Card style={{ width: 380 }} styles={{ body: { padding: 28 } }}>
        <Flex vertical gap={4} style={{ marginBottom: 20 }}>
          <Flex align="center" gap={10}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: token.colorPrimary,
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 700,
              }}
            >
              B
            </div>
            <Title level={4} style={{ margin: 0 }}>
              CRM Analyzer
            </Title>
          </Flex>
          <Text type="secondary">Вход в панель анализа Битрикс24</Text>
        </Flex>

        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}

        <Form layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item
            label="Логин"
            name="login"
            rules={[{ required: true, message: 'Введите логин' }]}
          >
            <Input prefix={<UserOutlined />} autoComplete="username" autoFocus size="large" />
          </Form.Item>
          <Form.Item
            label="Пароль"
            name="password"
            rules={[{ required: true, message: 'Введите пароль' }]}
          >
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={loading}>
            Войти
          </Button>
        </Form>
      </Card>
    </Flex>
  );
}
