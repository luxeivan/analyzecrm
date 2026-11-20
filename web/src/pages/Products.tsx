import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import {
  Card,
  Col,
  Flex,
  Input,
  Row,
  Segmented,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  TreeSelect,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api';
import { money } from '../format';
import { CHART_PALETTE, useChartTheme } from '../theme';
import type { Page, ProductAnalytics, ProductRow, ProductSection } from '../types';

const { Title, Text } = Typography;

const PRESETS = [
  { value: '30d', label: '30 дней' },
  { value: '90d', label: 'Квартал' },
  { value: 'year', label: 'Год' },
  { value: 'all', label: 'Всё время' },
];

function presetRange(preset: string): { from?: string; to?: string } {
  const today = new Date();
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  if (preset === '30d') {
    const from = new Date(today);
    from.setDate(from.getDate() - 30);
    return { from: iso(from) };
  }
  if (preset === '90d') {
    const from = new Date(today);
    from.setDate(from.getDate() - 90);
    return { from: iso(from) };
  }
  if (preset === 'year') return { from: iso(new Date(today.getFullYear(), 0, 1)) };
  return {};
}

interface TreeNode {
  value: number;
  title: string;
  key: number;
  children: TreeNode[];
}

/** Плоский список разделов -> дерево для TreeSelect. */
function buildTree(sections: ProductSection[]): TreeNode[] {
  const nodes = new Map<number, TreeNode>();
  sections.forEach((section) => {
    nodes.set(section.id, {
      value: section.id,
      key: section.id,
      title: `${section.name ?? `Раздел #${section.id}`}${section.products ? ` (${section.products})` : ''}`,
      children: [],
    });
  });

  const roots: TreeNode[] = [];
  sections.forEach((section) => {
    const node = nodes.get(section.id)!;
    const parent = section.parent_id ? nodes.get(Number(section.parent_id)) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
}

export default function ProductsPage() {
  const navigate = useNavigate();
  const { grid, axis, tooltip } = useChartTheme();

  const [sections, setSections] = useState<ProductSection[]>([]);
  const [analytics, setAnalytics] = useState<ProductAnalytics | null>(null);
  const [data, setData] = useState<Page<ProductRow> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [section, setSection] = useState<number | undefined>();
  const [soldOnly, setSoldOnly] = useState(true);
  const [stage, setStage] = useState<'won' | 'all'>('won');
  const [preset, setPreset] = useState('all');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' }>({ field: 'revenue', dir: 'desc' });

  useEffect(() => {
    api.productSections().then((result) => setSections(result.items)).catch(() => setSections([]));
  }, []);

  const range = useMemo(() => presetRange(preset), [preset]);
  const tree = useMemo(() => buildTree(sections), [sections]);

  useEffect(() => {
    setPage(1);
  }, [q, section, soldOnly, stage, preset, limit]);

  const loadAnalytics = useCallback(() => {
    api
      .productAnalytics({ ...range, stage, limit: 12 })
      .then(setAnalytics)
      .catch((err: Error) => setError(err.message));
  }, [range, stage]);

  useEffect(loadAnalytics, [loadAnalytics]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      api
        .products({
          q: q.trim(),
          section,
          sold: soldOnly ? 1 : undefined,
          stage,
          ...range,
          page,
          limit,
          sort: sort.field,
          dir: sort.dir,
        })
        .then(setData)
        .catch((err: Error) => setError(err.message))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [q, section, soldOnly, stage, range, page, limit, sort]);

  const columns: NonNullable<TableProps<ProductRow>['columns']> = [
    {
      title: 'Товар',
      dataIndex: 'name',
      sorter: true,
      sortOrder: sort.field === 'name' ? (sort.dir === 'asc' ? 'ascend' : 'descend') : null,
      render: (_value, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{row.name}</Text>
          <Text type="secondary" className="mono" style={{ fontSize: 11 }}>
            #{row.id}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Прайс',
      dataIndex: 'price',
      align: 'right',
      width: 120,
      sorter: true,
      render: (value: number | null, row) => (value === null ? '—' : money(value, row.currency_id)),
    },
    {
      title: 'Продано',
      dataIndex: 'qty',
      align: 'right',
      width: 120,
      sorter: true,
      sortOrder: sort.field === 'qty' ? (sort.dir === 'asc' ? 'ascend' : 'descend') : null,
      render: (value: number) => Number(value).toLocaleString('ru-RU'),
    },
    {
      title: 'Выручка',
      dataIndex: 'revenue',
      align: 'right',
      width: 150,
      sorter: true,
      sortOrder: sort.field === 'revenue' ? (sort.dir === 'asc' ? 'ascend' : 'descend') : null,
      render: (value: number) => <Text strong>{money(value)}</Text>,
    },
    {
      title: 'Сделок',
      dataIndex: 'deals',
      align: 'right',
      width: 100,
      sorter: true,
      sortOrder: sort.field === 'deals' ? (sort.dir === 'asc' ? 'ascend' : 'descend') : null,
      render: (value: number) => value || '—',
    },
    {
      title: 'Компаний',
      dataIndex: 'companies',
      align: 'right',
      width: 110,
      sorter: true,
      sortOrder: sort.field === 'companies' ? (sort.dir === 'asc' ? 'ascend' : 'descend') : null,
      render: (value: number) => value || '—',
    },
    {
      title: '',
      width: 100,
      render: (_value, row) => (
        <Tag color={row.active ? 'green' : 'default'} style={{ cursor: 'pointer' }} onClick={() => navigate(`/products/${row.id}`)}>
          {row.active ? 'активен' : 'скрыт'}
        </Tag>
      ),
    },
  ];

  return (
    <Flex vertical gap={16}>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Space direction="vertical" size={0}>
          <Title level={4} style={{ margin: 0 }}>
            Товары и продажи
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Рейтинг по выручке → клик по товару открывает отчёт: динамика и компании-покупатели
          </Text>
        </Space>
        <Space wrap>
          <Segmented value={preset} onChange={(value) => setPreset(String(value))} options={PRESETS} />
          <Segmented
            value={stage}
            onChange={(value) => setStage(value as 'won' | 'all')}
            options={[
              { value: 'won', label: 'Продажи' },
              { value: 'all', label: 'Все сделки' },
            ]}
          />
          <ReloadOutlined
            style={{ cursor: 'pointer' }}
            onClick={() => {
              loadAnalytics();
              setSort((prev) => ({ ...prev }));
              setPage((prev) => prev);
            }}
          />
        </Space>
      </Flex>

      {analytics ? (
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic title="Выручка по товарам" value={analytics.totals.revenue} precision={0} suffix="₽" />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic title="Продано единиц" value={analytics.totals.qty} precision={0} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic title="Сделок с товарами" value={analytics.totals.deals} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic title="Товаров продано" value={analytics.totals.products} />
            </Card>
          </Col>
        </Row>
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card size="small" title="Топ товаров по выручке">
            {analytics?.topProducts.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={analytics.topProducts.slice(0, 10).map((row) => ({
                    name: (row.name || '').slice(0, 28),
                    revenue: row.revenue,
                    id: row.id,
                  }))}
                  layout="vertical"
                  margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
                  onClick={(state) => {
                    const id = state?.activePayload?.[0]?.payload?.id;
                    if (id) navigate(`/products/${id}`);
                  }}
                >
                  <CartesianGrid stroke={grid} horizontal={false} />
                  <XAxis type="number" stroke={grid} tick={{ fontSize: 11, fill: axis.fill }} />
                  <YAxis type="category" dataKey="name" width={190} tick={{ fontSize: 11, fill: axis.fill }} />
                  <ChartTooltip contentStyle={tooltip} formatter={(value: number) => money(value)} />
                  <Bar dataKey="revenue" fill={CHART_PALETTE[0]} radius={[0, 4, 4, 0]} cursor="pointer" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Text type="secondary">Продаж за период нет</Text>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card size="small" title="Топ категорий (со всеми подкатегориями)">
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={analytics?.topSections ?? []}
              columns={[
                { title: 'Категория', dataIndex: 'name', render: (value: string | null) => value || '—' },
                {
                  title: 'Выручка',
                  dataIndex: 'revenue',
                  align: 'right',
                  width: 140,
                  render: (value: number) => <Text strong>{money(value)}</Text>,
                },
                {
                  title: 'Сделок',
                  dataIndex: 'deals',
                  align: 'right',
                  width: 90,
                  render: (value: number) => value || '—',
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card size="small">
        <Flex wrap gap={12} align="center" style={{ marginBottom: 12 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Поиск по названию товара"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            style={{ maxWidth: 320 }}
          />
          <TreeSelect
            allowClear
            showSearch
            treeDefaultExpandAll={false}
            placeholder="Раздел каталога"
            value={section}
            onChange={(value) => setSection(value ?? undefined)}
            treeData={tree}
            style={{ minWidth: 260 }}
            treeNodeFilterProp="title"
          />
          <Space size={6}>
            <Switch checked={soldOnly} onChange={setSoldOnly} size="small" />
            <Text type="secondary">только с продажами</Text>
          </Space>
          {error ? <Text type="danger">{error}</Text> : null}
        </Flex>

        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={data?.items ?? []}
          columns={columns}
          onChange={(pagination, _filters, sorter) => {
            setLimit(pagination.pageSize ?? limit);
            setPage(pagination.current ?? 1);
            const single = Array.isArray(sorter) ? sorter[0] : sorter;
            if (single?.order) {
              setSort({ field: String(single.columnKey ?? single.field), dir: single.order === 'ascend' ? 'asc' : 'desc' });
            } else {
              setSort({ field: 'revenue', dir: 'desc' });
            }
          }}
          pagination={{
            current: page,
            pageSize: limit,
            total: data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [25, 50, 100, 200],
            showTotal: (total) => `Всего ${total.toLocaleString('ru-RU')}`,
          }}
          onRow={(row) => ({ onClick: () => navigate(`/products/${row.id}`), style: { cursor: 'pointer' } })}
          scroll={{ x: 900 }}
        />
      </Card>
    </Flex>
  );
}
