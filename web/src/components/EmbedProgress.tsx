import { useEffect, useState } from 'react';
import { Card, Flex, Progress, Space, Tag, Typography } from 'antd';
import { api } from '../api';
import { fmtNumber } from '../format';
import type { EmbedStatus } from '../types';

const { Text } = Typography;

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

const formatEta = (seconds?: number | null) => {
  if (seconds === null || seconds === undefined) return null;
  if (seconds <= 0) return 'готово';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `~${h} ч ${m} мин` : `~${m} мин`;
};

/** Прогресс векторизации pgvector (данные пишет embed.js в service_state). */
export default function EmbedProgress() {
  const [status, setStatus] = useState<EmbedStatus | null>(null);

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      try {
        const next = await api.embedStatus();
        if (alive) setStatus(next);
      } catch {
        /* API недоступен — ждём следующий тик */
      }
    };

    tick();
    const timer = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!status?.active || !status.entities?.length) return null;

  const processed = status.processed ?? 0;
  const total = status.total ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const finished = Boolean(status.finishedAt);
  const failed = Boolean(status.error);
  const running = !finished && !failed;

  return (
    <Card
      size="small"
      title={
        <Space wrap>
          <span>Векторизация pgvector</span>
          <Tag color={failed ? 'error' : finished ? 'success' : 'processing'}>
            {failed ? 'ошибка' : finished ? 'готово' : 'идёт'}
          </Tag>
          {status.model ? <Text type="secondary" style={{ fontSize: 12 }}>{status.model}</Text> : null}
        </Space>
      }
    >
      <Flex vertical gap={10}>
        <div>
          <Flex justify="space-between" wrap gap={8}>
            <Text type="secondary">Всего</Text>
            <Text type="secondary">
              {fmtNumber(processed)} / {fmtNumber(total)} · {percent}%
              {running && status.rate ? ` · ${status.rate}/с` : ''}
              {running && status.etaSec ? ` · осталось ${formatEta(status.etaSec)}` : ''}
            </Text>
          </Flex>
          <Progress
            percent={percent}
            status={failed ? 'exception' : finished ? 'success' : 'active'}
            showInfo={false}
          />
        </div>

        {status.entities.map((row) => {
          const rowPercent =
            row.total && row.total > 0 ? Math.min(100, Math.round((row.processed / row.total) * 100)) : 0;
          return (
            <div key={row.entity}>
              <Flex justify="space-between" align="baseline" gap={8} wrap>
                <Space size={6}>
                  <Text strong>{ENTITY_LABELS[row.entity] ?? row.entity}</Text>
                  {row.done ? <Tag color="success">готово</Tag> : null}
                </Space>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {fmtNumber(row.processed)}
                  {row.total ? ` / ${fmtNumber(row.total)} · ${rowPercent}%` : ''}
                </Text>
              </Flex>
              <Progress
                percent={rowPercent}
                size="small"
                showInfo={false}
                status={row.done ? 'success' : 'normal'}
                strokeColor={ENTITY_COLORS[row.entity]}
              />
            </div>
          );
        })}

        <Flex wrap gap={16}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            токенов: {fmtNumber(status.tokens ?? 0)}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            стоимость: {(status.costRub ?? 0).toFixed(2)} ₽
          </Text>
          {status.updatedAt ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              обновлено: {new Date(status.updatedAt).toLocaleTimeString('ru-RU')}
            </Text>
          ) : null}
        </Flex>

        {failed ? <Text type="danger">Ошибка: {status.error}</Text> : null}
      </Flex>
    </Card>
  );
}
