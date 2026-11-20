import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Button, Card, Flex, Segmented, Space, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import GraphView, { GRAPH_COLORS } from '../components/GraphView';
import type { GraphData } from '../types';

const { Title, Text } = Typography;

const LEGEND = [
  { color: GRAPH_COLORS.company, label: 'Компания' },
  { color: GRAPH_COLORS.contact, label: 'Контакт' },
  { color: GRAPH_COLORS.deal, label: 'Сделка' },
  { color: GRAPH_COLORS.lead, label: 'Лид' },
];

export default function Graph() {
  const { id } = useParams<{ id?: string }>();
  const [data, setData] = useState<GraphData | null>(null);
  const [limit, setLimit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    const request = id ? api.graphCompany(id) : api.graphOverview(limit);
    request
      .then((result) => alive && setData(result))
      .catch((err: Error) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [id, limit, reload]);

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="flex-end" gap={16} wrap>
        <div>
          <Link to={id ? `/companies/${id}` : '/companies'} style={{ fontSize: 12 }}>
            ← {id ? 'к карточке компании' : 'к компаниям'}
          </Link>
          <Title level={4} style={{ margin: '4px 0 0' }}>
            {id ? `Связи компании #${id}` : 'Обзор связей компаний'}
          </Title>
          <Text type="secondary">
            {id
              ? 'Компания → контакты → сделки и лиды'
              : 'Топ компаний по количеству привязанных контактов'}
          </Text>
        </div>

        <Space wrap>
          {LEGEND.map((item) => (
            <Tag key={item.label}>
              <Space size={6}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: item.color,
                  }}
                />
                {item.label}
              </Space>
            </Tag>
          ))}

          {!id ? (
            <Segmented
              value={limit}
              onChange={(value) => setLimit(Number(value))}
              options={[10, 25, 50, 100].map((value) => ({ value, label: `${value}` }))}
            />
          ) : null}

          <Button icon={<ReloadOutlined />} onClick={() => setReload((value) => value + 1)}>
            Обновить
          </Button>
        </Space>
      </Flex>

      {error ? (
        <Alert type="error" showIcon message={`Не удалось загрузить граф: ${error}`} />
      ) : null}

      <Card size="small" loading={loading} styles={{ body: { padding: 0 } }}>
        {!data || data.nodes.length === 0 ? (
          <Flex align="center" justify="center" style={{ height: 240 }}>
            <Text type="secondary">
              Связей пока нет. Запустите выгрузку на дашборде, чтобы загрузить контакты и сделки.
            </Text>
          </Flex>
        ) : (
          <GraphView data={data} />
        )}
      </Card>

      {data && data.nodes.length > 0 ? (
        <Text type="secondary">
          Узлов: {data.nodes.length} · связей: {data.links.length}. Колесо мыши — масштаб, drag —
          перемещение.
        </Text>
      ) : null}
    </Flex>
  );
}
