import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  DatabaseOutlined,
  FieldTimeOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import SyncControls from '../components/SyncControls';
import UsersCard from '../components/UsersCard';
import EmbedProgress from '../components/EmbedProgress';
import { api } from '../api';
import { fmtNumber } from '../format';
import type { AdminOverview } from '../types';

const { Text } = Typography;

const ENTITY_LABELS: Record<string, string> = {
  companies: 'Компании',
  contacts: 'Контакты',
  deals: 'Сделки',
  leads: 'Лиды',
};

const formatBytes = (bytes: number) => {
  if (!bytes) return '—';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const formatDuration = (seconds: number) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${m} мин`;
  return `${m} мин`;
};

const formatDateTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export default function AdminPage() {
  const { message } = AntApp.useApp();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.adminOverview();
      setData(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const runAction = async (name: 'embed' | 'reconcile') => {
    setBusy(name);
    try {
      await api.adminAction(name);
      message.success(
        name === 'embed' ? 'Векторизация запущена в фоне' : 'Сверка удалённых запущена в фоне',
      );
      setTimeout(load, 2000);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return (
      <Card loading={!error}>
        {error ? <Alert type="error" message={error} showIcon /> : null}
      </Card>
    );
  }

  const totalRows = data.tables.reduce((sum, row) => sum + row.rows, 0);
  const totalEmbedded = data.tables.reduce((sum, row) => sum + row.embedded, 0);
  const embedPercent = totalRows > 0 ? Math.round((totalEmbedded / totalRows) * 1000) / 10 : 0;

  const { settings } = data;
  const running = data.sync.status === 'running';

  return (
    <Flex vertical gap={16}>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card style={{ height: '100%' }}>
            <Statistic title="Записей в БД" value={totalRows} formatter={(v) => fmtNumber(Number(v))} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              компании · контакты · сделки · лиды
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card style={{ height: '100%' }}>
            <Statistic
              title="Векторов"
              value={embedPercent}
              suffix="%"
              prefix={<ThunderboltOutlined />}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {fmtNumber(totalEmbedded)} из {fmtNumber(totalRows)}
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card style={{ height: '100%' }}>
            <Statistic
              title="Размер БД"
              value={formatBytes(data.postgres.sizeBytes)}
              prefix={<DatabaseOutlined />}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {data.postgres.version}
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card style={{ height: '100%' }}>
            <Statistic
              title="Аптайм API"
              value={formatDuration(data.uptimeSec)}
              prefix={<FieldTimeOutlined />}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Node {data.node} · {data.memoryMb} МБ RSS
            </Text>
          </Card>
        </Col>
      </Row>

      <SyncControls onFinished={load} />
      <EmbedProgress />
      <UsersCard />

      <Card size="small" title="Таблицы и векторы">
        <Table
          size="small"
          rowKey="table"
          pagination={false}
          dataSource={data.tables}
          columns={[
            {
              title: 'Таблица',
              dataIndex: 'table',
              render: (value: string) => ENTITY_LABELS[value] ?? value,
            },
            {
              title: 'Записей',
              dataIndex: 'rows',
              align: 'right',
              render: (value: number) => fmtNumber(value),
            },
            {
              title: 'С вектором',
              dataIndex: 'embedded',
              align: 'right',
              render: (value: number, row) => (
                <Space>
                  <Text>{fmtNumber(value)}</Text>
                  <Text type="secondary">
                    {row.rows > 0 ? Math.round((value / row.rows) * 1000) / 10 : 0}%
                  </Text>
                </Space>
              ),
            },
            {
              title: 'Векторы',
              dataIndex: 'embedded',
              width: 160,
              render: (value: number, row) => (
                <Progress
                  percent={row.rows > 0 ? Math.round((value / row.rows) * 100) : 0}
                  size="small"
                  status={value === row.rows ? 'success' : 'normal'}
                />
              ),
            },
            {
              title: 'Обновлено за сутки',
              dataIndex: 'fresh',
              align: 'right',
              render: (value: number) => fmtNumber(value),
            },
            {
              title: 'HNSW-индекс',
              dataIndex: 'table',
              render: (value: string) => {
                const found = data.vectorIndexes.find((index) => index.table === value);
                return found ? <Tag color="success">{found.index}</Tag> : <Tag>нет</Tag>;
              },
            },
          ]}
        />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card size="small" title="Система" style={{ height: '100%' }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="PostgreSQL">{data.postgres.version}</Descriptions.Item>
              <Descriptions.Item label="Размер базы">{formatBytes(data.postgres.sizeBytes)}</Descriptions.Item>
              <Descriptions.Item label="Удалённые записи (аудит)">{fmtNumber(data.deletedRecords)}</Descriptions.Item>
              <Descriptions.Item label="Последняя сверка">
                {data.lastReconcile?.finishedAt ? formatDateTime(data.lastReconcile.finishedAt) : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Векторы">
                {data.embed ? (
                  <Space wrap>
                    <Tag color={data.embed.error ? 'error' : data.embed.finishedAt ? 'success' : 'processing'}>
                      {data.embed.error ? 'ошибка' : data.embed.finishedAt ? 'готово' : 'в работе'}
                    </Tag>
                    <Text type="secondary">{data.embed.model}</Text>
                  </Space>
                ) : (
                  'не запускались'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Записей в CRM">
                {data.sync.progress?.length
                  ? data.sync.progress
                      .map((row) => `${row.entity}: ${fmtNumber(row.fetched)}${row.total ? `/${fmtNumber(row.total)}` : ''}`)
                      .join(' · ')
                  : '—'}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card size="small" title="Настройки" style={{ height: '100%' }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Выгрузка">
                {running ? <Tag color="processing">идёт</Tag> : <Tag>простой</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="Пауза между страницами">{settings.sleepMs} мс</Descriptions.Item>
              <Descriptions.Item label="Страница / повторы">
                {settings.pageLimit} записей · {settings.maxRetries} повторов
              </Descriptions.Item>
              <Descriptions.Item label="Автоповтор job'а">
                {settings.autoRetry} попыток
              </Descriptions.Item>
              <Descriptions.Item label="Планировщик">
                {settings.syncScheduler ? (
                  <Tag color="success">включён, каждые {settings.syncIntervalMin} мин</Tag>
                ) : (
                  <Tag>выключен (SYNC_SCHEDULER=0)</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Сверка удалённых">раз в {settings.reconcileDays} дн.</Descriptions.Item>
              <Descriptions.Item label="Модель эмбеддингов">{settings.embeddingModel}</Descriptions.Item>
              <Descriptions.Item label="Вебхук Битрикс24">
                {settings.bitrixConfigured ? <Tag color="success">задан</Tag> : <Tag color="error">не задан</Tag>}
              </Descriptions.Item>
            </Descriptions>

            <Flex gap={8} wrap style={{ marginTop: 12 }}>
              <Button
                icon={<ThunderboltOutlined />}
                loading={busy === 'embed'}
                onClick={() => runAction('embed')}
              >
                Векторизация
              </Button>
              <Button
                icon={<ReloadOutlined />}
                loading={busy === 'reconcile'}
                onClick={() => runAction('reconcile')}
              >
                Сверка удалённых
              </Button>
            </Flex>

            {!settings.syncScheduler ? (
              <Alert
                style={{ marginTop: 12 }}
                type="info"
                showIcon
                message="Автообновление выключено"
                description={
                  <span>
                    Включить: <Text code>SYNC_SCHEDULER=1</Text> в <Text code>.env</Text>, затем{' '}
                    <Text code>docker compose up -d --force-recreate api</Text>. Дальше каждые{' '}
                    {settings.syncIntervalMin} мин будут догружаться новые записи и правки, а раз в{' '}
                    {settings.reconcileDays} дн. — сверка удалённых.
                  </span>
                }
              />
            ) : null}
          </Card>
        </Col>
      </Row>
    </Flex>
  );
}
