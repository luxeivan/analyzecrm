import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RiseOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Flex, Progress, Slider, Space, Table, Tag, Typography } from 'antd';
import { api } from '../api';
import type { LookalikeItem } from '../types';

const { Text, Title } = Typography;

/** Компании, похожие на лучших клиентов (по центроиду векторов top-N по выручке). */
export default function LookAlikePage() {
  const [top, setTop] = useState(50);
  const [limit, setLimit] = useState(25);
  const [items, setItems] = useState<LookalikeItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.lookalike(limit, top);
      setItems(result.items);
    } catch (err) {
      setError((err as Error).message);
      setItems(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, limit]);

  return (
    <Flex vertical gap={16}>
      <div>
        <Title level={4} style={{ margin: 0 }}>
          <RiseOutlined /> Потенциальные клиенты
        </Title>
        <Text type="secondary">
          Кому ещё можно продать: компании из базы, профиль которых похож на ваших лучших покупателей, но у них
          нет ни одной успешной сделки. Это не дубли — карточки разные, совпадает только «портрет» компании.
        </Text>
      </div>

      <Card size="small">
        <Flex gap={32} wrap>
          <div style={{ minWidth: 260 }}>
            <Text type="secondary">Эталон: топ-{top} клиентов по выручке (кому уже продали больше всех)</Text>
            <Slider min={10} max={200} step={10} value={top} onChange={setTop} />
          </div>
          <div style={{ minWidth: 260 }}>
            <Text type="secondary">Показать кандидатов: {limit}</Text>
            <Slider min={10} max={100} step={5} value={limit} onChange={setLimit} />
          </div>
        </Flex>
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 8 }}
          message="Как строится список"
          description="Берём компании, которые принесли больше всего выручки, усредняем их «портрет» и ищем в базе компании с похожим профилем, у которых ещё нет ни одной успешной сделки. В колонке «Похожа на» — конкретный крупный клиент, на которого кандидат больше всего похож. Это не дубли: карточки разные, совпадает только профиль компании."
        />
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}

      <Card
        size="small"
        title={`Кого обзвонить (${items?.length ?? 0})`}
        extra={<Button onClick={load} loading={loading}>Пересчитать</Button>}
      >
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={items ?? []}
          pagination={{
            defaultPageSize: 25,
            showSizeChanger: true,
            pageSizeOptions: [25, 50, 100],
            showTotal: (total) => `Всего: ${total}`,
          }}
          locale={{ emptyText: 'Кандидатов не найдено — возможно, векторизация ещё не завершена' }}
          columns={[
            {
              title: 'Компания',
              dataIndex: 'title',
              render: (_: unknown, row) => (
                <Link to={`/companies/${row.id}`}>{row.title || `#${row.id}`}</Link>
              ),
            },
            {
              title: 'Город',
              dataIndex: 'city',
              render: (value: string | null, row) => value || row.region || '—',
            },
            {
              title: 'Похожа на',
              dataIndex: 'similar_to',
              render: (value: string | null, row) =>
                value ? (
                  <Space size={6}>
                    <Text ellipsis style={{ maxWidth: 220 }}>
                      {value}
                    </Text>
                    <Tag>{Math.round((row.similar_to_score ?? 0) * 100)}%</Tag>
                  </Space>
                ) : (
                  '—'
                ),
            },
            {
              title: 'Похожесть на профиль',
              dataIndex: 'score',
              width: 170,
              render: (value: number) => (
                <Space>
                  <Progress percent={Math.round(value * 100)} size="small" showInfo={false} style={{ width: 90 }} />
                  <Tag color={value > 0.85 ? 'success' : 'blue'}>{(value * 100).toFixed(1)}%</Tag>
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </Flex>
  );
}
