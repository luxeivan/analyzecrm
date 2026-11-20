import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SearchOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Input,
  List,
  Progress,
  Segmented,
  Slider,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { api } from '../api';
import type { SearchEntity, SemanticSearchResult } from '../types';

const { Text, Title } = Typography;

const ENTITY_OPTIONS: { value: SearchEntity; label: string }[] = [
  { value: 'company', label: 'Компании' },
  { value: 'contact', label: 'Контакты' },
  { value: 'deal', label: 'Сделки' },
  { value: 'lead', label: 'Лиды' },
];

const PATHS: Record<SearchEntity, string> = {
  company: '/companies',
  contact: '/contacts',
  deal: '/deals',
  lead: '/leads',
};

const EXAMPLES: Record<SearchEntity, string[]> = {
  company: [
    'производство металлообрабатывающих станков',
    'оптовая торговля стройматериалами',
    'монтаж промышленного оборудования',
    'типография и полиграфия',
  ],
  contact: ['директор по закупкам', 'главный инженер', 'снабженец', 'маркетолог'],
  deal: ['поставка оборудования на монтаж', 'ремонт и обслуживание', 'шеф-монтаж', 'запчасти'],
  lead: ['заявка с сайта на оборудование', 'запрос коммерческого предложения', 'не дозвонились'],
};

const scoreColor = (score: number) => (score > 0.9 ? 'success' : score > 0.85 ? 'blue' : 'default');

interface DuplicatePair {
  a_id: number;
  a_title: string | null;
  b_id: number;
  b_title: string | null;
  score: number;
}

/** Семантический поиск: запрос векторизуется и сравнивается с карточками через pgvector. */
export default function SearchPage() {
  const [entity, setEntity] = useState<SearchEntity>('company');
  const [q, setQ] = useState('');
  const [result, setResult] = useState<SemanticSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [threshold, setThreshold] = useState(0.9);
  const [duplicates, setDuplicates] = useState<DuplicatePair[] | null>(null);
  const [dupLoading, setDupLoading] = useState(false);

  const run = async (value = q) => {
    const text = value.trim();
    if (text.length < 3) return;
    setQ(text);
    setLoading(true);
    setError(null);
    try {
      setResult(await api.semanticSearch(entity, text, 25));
    } catch (err) {
      const typed = err as Error & { payload?: { hint?: string } };
      setError({ message: typed.message, hint: typed.payload?.hint });
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const findDuplicates = async () => {
    setDupLoading(true);
    try {
      const response = await fetch(
        `/api/search/duplicates?entity=${entity}&threshold=${threshold}&sample=2000`,
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? 'Не удалось найти дубли');
      setDuplicates(payload.items as DuplicatePair[]);
    } catch (err) {
      setDuplicates(null);
      setError({ message: (err as Error).message });
    } finally {
      setDupLoading(false);
    }
  };

  return (
    <Flex vertical gap={16}>
      <div>
        <Title level={4} style={{ margin: 0 }}>
          Поиск по смыслу
        </Title>
        <Text type="secondary">
          Запрос сравнивается с карточками через векторные эмбеддинги (pgvector), а не по подстроке — можно
          писать обычными словами.
        </Text>
      </div>

      <Card size="small">
        <Flex vertical gap={12}>
          <Segmented
            value={entity}
            onChange={(value) => {
              setEntity(value as SearchEntity);
              setResult(null);
              setError(null);
            }}
            options={ENTITY_OPTIONS}
          />
          <Input.Search
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onSearch={run}
            enterButton={
              <Button type="primary" icon={<SearchOutlined />} loading={loading}>
                Найти
              </Button>
            }
            placeholder="Например: производство станков в Московской области"
            size="large"
            allowClear
          />
          <Space wrap size={[8, 8]}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Примеры:
            </Text>
            {EXAMPLES[entity].map((example) => (
              <Tag
                key={example}
                style={{ cursor: 'pointer' }}
                onClick={() => run(example)}
              >
                {example}
              </Tag>
            ))}
          </Space>
        </Flex>
      </Card>

      {error ? (
        <Alert
          type="warning"
          showIcon
          message={error.message}
          description={error.hint ?? 'Возможно, векторизация ещё не завершена — проверьте прогресс в «Админке».'}
        />
      ) : null}

      {result ? (
        <Card
          size="small"
          title={`Найдено: ${result.items.length} · ${result.q}`}
          extra={<Text type="secondary">{result.model}</Text>}
        >
          {result.items.length === 0 ? (
            <Empty description="Ничего похожего не нашлось" />
          ) : (
            <List
              dataSource={result.items}
              renderItem={(item, index) => (
                <List.Item
                  extra={
                    <Flex align="center" gap={8}>
                      <Progress
                        percent={Math.round(item.score * 100)}
                        size="small"
                        showInfo={false}
                        style={{ width: 90 }}
                      />
                      <Tag color={scoreColor(item.score)}>{(item.score * 100).toFixed(1)}%</Tag>
                    </Flex>
                  }
                >
                  <Space size={8}>
                    <Text type="secondary">{index + 1}.</Text>
                    <Link to={`${PATHS[result.entity as SearchEntity]}/${item.id}`}>
                      {item.title || `#${item.id}`}
                    </Link>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </Card>
      ) : null}

      <Card
        size="small"
        title="Кандидаты в дубли"
        extra={
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              порог близости
            </Text>
            <Slider
              min={0.85}
              max={0.98}
              step={0.01}
              value={threshold}
              onChange={setThreshold}
              style={{ width: 120 }}
            />
            <Text strong>{(threshold * 100).toFixed(0)}%</Text>
            <Button onClick={findDuplicates} loading={dupLoading}>
              Найти дубли
            </Button>
          </Space>
        }
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          Проверяются последние 2 000 записей выбранной сущности: для каждой ищется ближайший сосед по
          вектору. Пары выше порога — вероятные дубли, их стоит проверить вручную.
        </Text>
        {duplicates ? (
          <Table
            style={{ marginTop: 12 }}
            size="small"
            rowKey={(row) => `${row.a_id}:${row.b_id}`}
            dataSource={duplicates}
            pagination={{
              defaultPageSize: 10,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              size: 'small',
            }}
            locale={{ emptyText: 'Похожих пар не найдено' }}
            columns={[
              {
                title: 'Запись A',
                dataIndex: 'a_id',
                render: (value: number, row) => (
                  <Link to={`${PATHS[entity]}/${value}`}>{row.a_title || `#${value}`}</Link>
                ),
              },
              {
                title: 'Запись B',
                dataIndex: 'b_id',
                render: (value: number, row) => (
                  <Link to={`${PATHS[entity]}/${value}`}>{row.b_title || `#${value}`}</Link>
                ),
              },
              {
                title: 'Близость',
                dataIndex: 'score',
                width: 110,
                render: (value: number) => (
                  <Tag color={scoreColor(value)}>{(value * 100).toFixed(1)}%</Tag>
                ),
              },
            ]}
          />
        ) : null}
      </Card>
    </Flex>
  );
}
