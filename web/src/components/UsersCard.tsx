import { useCallback, useEffect, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from '../api';
import { useAuth } from '../auth';
import type { AuthUser } from '../types';

const { Text } = Typography;

interface FormValues {
  login: string;
  password?: string;
  name?: string;
  role: 'admin' | 'user';
  active: boolean;
}

/** CRUD пользователей панели (только для администраторов). */
export default function UsersCard() {
  const { message } = AntApp.useApp();
  const { user: current } = useAuth();
  const [items, setItems] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<AuthUser | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.users();
      setItems(result.items);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ login: '', password: '', name: '', role: 'user', active: true });
    setOpen(true);
  };

  const openEdit = (user: AuthUser) => {
    setEditing(user);
    form.setFieldsValue({
      login: user.login,
      password: '',
      name: user.name ?? '',
      role: user.role,
      active: user.active,
    });
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing) {
        await api.updateUser(editing.id, {
          name: values.name,
          role: values.role,
          active: values.active,
          ...(values.password ? { password: values.password } : {}),
        });
        message.success('Пользователь обновлён');
      } else {
        await api.createUser({
          login: values.login.trim(),
          password: values.password ?? '',
          name: values.name,
          role: values.role,
        });
        message.success('Пользователь создан');
      }
      setOpen(false);
      load();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (user: AuthUser) => {
    try {
      await api.deleteUser(user.id);
      message.success('Пользователь удалён');
      load();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  return (
    <Card
      size="small"
      title="Пользователи"
      extra={
        <Button size="small" icon={<PlusOutlined />} onClick={openCreate}>
          Добавить
        </Button>
      }
    >
      <Table
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={items}
        pagination={false}
        columns={[
          {
            title: 'Логин',
            dataIndex: 'login',
            render: (value: string, user) => (
              <Space size={6}>
                <Text strong>{value}</Text>
                {user.isSystem ? <Tag color="gold">системный</Tag> : null}
                {user.id === current?.id ? <Tag>это вы</Tag> : null}
              </Space>
            ),
          },
          { title: 'Имя', dataIndex: 'name', render: (value: string | null) => value || '—' },
          {
            title: 'Роль',
            dataIndex: 'role',
            width: 130,
            render: (value: string) => (
              <Tag color={value === 'admin' ? 'blue' : 'default'}>
                {value === 'admin' ? 'администратор' : 'пользователь'}
              </Tag>
            ),
          },
          {
            title: 'Активен',
            dataIndex: 'active',
            width: 100,
            render: (value: boolean) => <Tag color={value ? 'success' : 'default'}>{value ? 'да' : 'нет'}</Tag>,
          },
          {
            title: 'Изменён',
            dataIndex: 'updatedAt',
            width: 160,
            render: (value: string | null) =>
              value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—',
          },
          {
            title: '',
            width: 130,
            render: (_: unknown, user) => (
              <Space size={4}>
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(user)} />
                <Popconfirm
                  title={`Удалить пользователя ${user.login}?`}
                  okText="Удалить"
                  cancelText="Отмена"
                  onConfirm={() => remove(user)}
                  disabled={user.isSystem || user.id === current?.id}
                >
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={user.isSystem || user.id === current?.id}
                  />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Text type="secondary" style={{ fontSize: 12 }}>
        Пароль системного администратора задаётся в <Text code>.env</Text> (AUTH_ADMIN_PASSWORD) и применяется при
        перезапуске API; его нельзя удалить или понизить.
      </Text>

      <Modal
        title={editing ? `Пользователь ${editing.login}` : 'Новый пользователь'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        okText={editing ? 'Сохранить' : 'Создать'}
        cancelText="Отмена"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false} requiredMark={false}>
          <Form.Item label="Логин" name="login" rules={editing ? [] : [{ required: true, min: 3, message: 'Минимум 3 символа' }]}>
            <Input disabled={Boolean(editing)} autoComplete="off" placeholder="например, ivanov" />
          </Form.Item>
          <Form.Item label="Имя" name="name" extra="Подпись в шапке панели. Необязательно.">
            <Input autoComplete="off" placeholder="например, Иван Иванов" />
          </Form.Item>
          <Form.Item
            label={editing ? 'Новый пароль (если нужно сменить)' : 'Пароль'}
            name="password"
            rules={editing ? [{ min: 6, message: 'Минимум 6 символов' }] : [{ required: true, min: 6, message: 'Минимум 6 символов' }]}
          >
            <Input.Password
              autoComplete="new-password"
              placeholder={editing ? 'оставьте пустым, чтобы не менять' : 'минимум 6 символов'}
            />
          </Form.Item>
          <Form.Item label="Роль" name="role">
            <Select
              options={[
                { value: 'user', label: 'Пользователь — просмотр данных' },
                { value: 'admin', label: 'Администратор — полный доступ' },
              ]}
            />
          </Form.Item>
          {editing ? (
            <Form.Item label="Активен" name="active" valuePropName="checked">
              <Switch disabled={editing.isSystem || editing.id === current?.id} />
            </Form.Item>
          ) : null}
          <Flex align="center" gap={6}>
            <KeyOutlined />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Пароли хранятся в виде scrypt-хэша, восстановить их нельзя — только сменить.
            </Text>
          </Flex>
        </Form>
      </Modal>
    </Card>
  );
}
