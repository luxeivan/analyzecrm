import { useEffect, useRef, useState } from 'react';
import {
  CaretRightOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  StopOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Flex,
  Progress,
  Space,
  Tag,
  Typography,
} from 'antd';
import { api } from '../api';
import { fmtNumber } from '../format';
import type { SyncStatus } from '../types';

const { Text } = Typography;

const LABELS: Record<SyncStatus['status'], string> = {
  idle: 'Готово к запуску',
  running: 'Выполняется',
  pausing: 'Пауза…',
  paused: 'Пауза',
  stopping: 'Останавливаем…',
  stopped: 'Остановлено',
  done: 'Завершено',
  error: 'Ошибка',
};

const COLORS: Record<SyncStatus['status'], string> = {
  idle: 'default',
  running: 'processing',
  pausing: 'warning',
  paused: 'warning',
  stopping: 'error',
  stopped: 'error',
  done: 'success',
  error: 'error',
};

const ENTITY_LABELS: Record<string, string> = {
  company: 'Компании',
  contact: 'Контакты',
  lead: 'Лиды',
  deal: 'Сделки',
};

const ENTITY_COLORS: Record<string, string> = {
  company: '#1677ff',
  contact: '#722ed1',
  lead: '#52c41a',
  deal: '#faad14',
};

const PROGRESS_LABELS: Record<string, string> = {
  pending: 'в очереди',
  running: 'идёт',
  delta: 'дельта',
  done: 'готово',
  error: 'ошибка',
};

const PROGRESS_TAG: Record<string, string> = {
  pending: 'default',
  running: 'processing',
  delta: 'processing',
  done: 'success',
  error: 'error',
};

const isActive = (status?: SyncStatus['status']) =>
  status === 'running' || status === 'pausing' || status === 'stopping';

export default function SyncControls({ onFinished }: { onFinished?: () => void }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const activeRef = useRef(false);

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      try {
        const next = await api.syncStatus();
        if (!alive) return;

        if (activeRef.current && !isActive(next.status)) finishedRef.current?.();
        activeRef.current = isActive(next.status);
        setStatus(next);
      } catch {
        /* API временно недоступен — ждём следующий тик */
      }
    };

    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const run = async (action: () => Promise<SyncStatus>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      activeRef.current = isActive(next.status);
      setStatus(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const current = status?.status ?? 'idle';
  const canStart = !isActive(current) && current !== 'paused';
  const canPause = current === 'running';
  const canResume = current === 'paused' || current === 'pausing';
  const canStop = isActive(current) || current === 'paused';

  const percent =
    status?.total && status.total > 0
      ? Math.min(100, Math.round((status.fetched / status.total) * 100))
      : 0;

  return (
    <Card
      title={
        <Space wrap>
          <span>Выгрузка из Битрикс24</span>
          <Tag color={COLORS[current]}>{LABELS[current]}</Tag>
        </Space>
      }
      extra={
        <Checkbox
          checked={full}
          disabled={isActive(current) || current === 'paused'}
          onChange={(event) => setFull(event.target.checked)}
        >
          полная перевыгрузка
        </Checkbox>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text type="secondary">
          {status?.message || 'Порциями по 50 записей, сразу в PostgreSQL.'}
          {status?.entity ? ` · сущность: ${status.entity}` : ''}
        </Text>

        <Space wrap>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            disabled={busy || !canStart}
            onClick={() => run(() => api.syncStart(full))}
          >
            Старт
          </Button>
          <Button
            icon={<PauseCircleOutlined />}
            disabled={busy || !canPause}
            onClick={() => run(api.syncPause)}
          >
            Пауза
          </Button>
          <Button
            icon={<CaretRightOutlined />}
            disabled={busy || !canResume}
            onClick={() => run(api.syncResume)}
          >
            Продолжить
          </Button>
          <Button
            danger
            icon={<StopOutlined />}
            disabled={busy || !canStop}
            onClick={() => run(api.syncStop)}
          >
            Остановить
          </Button>

          {status?.startedAt ? (
            <Text type="secondary" style={{ marginLeft: 8 }}>
              старт: {new Date(status.startedAt).toLocaleTimeString('ru-RU')}
              {status.finishedAt
                ? ` · финиш: ${new Date(status.finishedAt).toLocaleTimeString('ru-RU')}`
                : ''}
            </Text>
          ) : null}
        </Space>

        <Progress
          percent={percent}
          status={
            current === 'error'
              ? 'exception'
              : current === 'done'
                ? 'success'
                : isActive(current)
                  ? 'active'
                  : 'normal'
          }
          strokeColor={current === 'paused' ? 'orange' : undefined}
        />

        {status?.progress?.length ? (
          <Flex vertical gap={6}>
            <Text strong>По сущностям</Text>
            {status.progress.map((row) => {
              const pct =
                row.total && row.total > 0
                  ? Math.min(100, Math.round((row.fetched / row.total) * 100))
                  : row.status === 'done'
                    ? 100
                    : 0;
              return (
                <div key={row.entity}>
                  <Flex justify="space-between" align="baseline" gap={8} wrap>
                    <Space size={6}>
                      <Text strong>{ENTITY_LABELS[row.entity] ?? row.entity}</Text>
                      <Tag color={PROGRESS_TAG[row.status] ?? 'default'}>
                        {PROGRESS_LABELS[row.status] ?? row.status}
                      </Tag>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {fmtNumber(row.fetched)}
                      {row.total ? ` / ${fmtNumber(row.total)} · ${pct}%` : ''}
                    </Text>
                  </Flex>
                  <Progress
                    percent={pct}
                    size="small"
                    showInfo={false}
                    status={row.status === 'error' ? 'exception' : row.status === 'done' ? 'success' : 'normal'}
                    strokeColor={ENTITY_COLORS[row.entity]}
                  />
                </div>
              );
            })}
          </Flex>
        ) : null}

        <Flex wrap gap={24}>
          <Text type="secondary">
            обработано: {fmtNumber(status?.fetched)}
            {status?.total ? ` из ${fmtNumber(status.total)}` : ''}
          </Text>
          <Text type="secondary">страниц: {fmtNumber(status?.page)}</Text>
          <Text type="secondary">last_id: {fmtNumber(status?.lastId)}</Text>
        </Flex>

        {error ? <Alert type="error" showIcon message={error} /> : null}
        {status?.error ? <Alert type="error" showIcon message={status.error} /> : null}

        {status && status.log.length > 0 ? (
          <Collapse
            size="small"
            items={[
              {
                key: 'log',
                label: `Журнал выгрузки (${status.log.length})`,
                children: (
                  <div className="sync-log">
                    {status.log.map((line, index) => (
                      <div key={`${index}-${line}`}>{line}</div>
                    ))}
                  </div>
                ),
              },
            ]}
          />
        ) : null}
      </Space>
    </Card>
  );
}
