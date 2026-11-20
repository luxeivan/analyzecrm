import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api';
import { fmtDate, money } from '../format';
import { CHART_PALETTE, useChartTheme } from '../theme';
import type { ProductReport, ProductReportCompany, ProductReportDeal } from '../types';

const { Title, Text } = Typography;

const PRESETS = [
  { value: '30d', label: '30 дней' },
  { value: '90d', label: 'Квартал' },
  { value: 'year', label: 'Год' },
  { value: 'all', label: 'Всё время' },
];

const GROUPS = [
  { value: 'month', label: 'Месяц' },
  { value: 'quarter', label: 'Квартал' },
  { value: 'year', label: 'Год' },
];

/** Пресет -> границы периода (YYYY-MM-DD). */
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

export default function ProductReportPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { grid, axis, tooltip } = useChartTheme();

  const [preset, setPreset] = useState('all');
  const [group, setGroup] = useState('month');
  const [stage, setStage] = useState<'won' | 'all'>('won');
  const [report, setReport] = useState<ProductReport | null>(null);
  const [options, setOptions] = useState<{ value: number; label: string }[]>([]);
  const [companyQuery, setCompanyQuery] = useState('');
  const [metric, setMetric] = useState<'revenue' | 'qty' | 'companies' | 'deals'>('revenue');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(
    () => ({ ...presetRange(preset), group, stage }),
    [preset, group, stage],
  );

  // Быстрый переход к другому товару: поиск по каталогу прямо в шапке отчёта
  const searchProducts = useCallback((value: string) => {
    api
      .products({ q: value.trim(), limit: 20, sort: 'revenue', dir: 'desc', stage: 'all' })
      .then((page) =>
        setOptions(
          page.items.map((item) => ({
            value: item.id,
            label: `${item.name}${item.revenue ? ` · ${money(item.revenue)}` : ''}`,
          })),
        ),
      )
      .catch(() => setOptions([]));
  }, []);

  useEffect(() => {
    searchProducts('');
  }, [searchProducts]);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    api
      .productReport(id, params)
      .then(setReport)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, params]);

  useEffect(load, [load]);

  if (error) {
    return (
      <Card>
        <Text type="danger">{error}</Text>
      </Card>
    );
  }

  if (!report) return <Card loading={loading} />;

  const { product, totals, timeline, companies } = report;
  const needle = companyQuery.trim().toLowerCase();
  const filteredCompanies = needle
    ? companies.filter((row) =>
        `${row.title ?? ''} ${row.city ?? ''} ${row.industry ?? ''}`.toLowerCase().includes(needle),
      )
    : companies;
  const currency = product.currency_id || 'RUB';
  const measure = product.measure ? '' : '';

  const companyColumns: NonNullable<TableProps<ProductReportCompany>['columns']> = [
    {
      title: 'Компания',
      dataIndex: 'title',
      render: (_value, row) => (
        <Space direction="vertical" size={0}>
          <Link to={`/companies/${row.id}`}>{row.title || `Компания #${row.id}`}</Link>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {[row.city, row.industry].filter(Boolean).join(' · ') || '—'}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Выручка',
      dataIndex: 'revenue',
      align: 'right',
      width: 140,
      sorter: (a, b) => a.revenue - b.revenue,
      defaultSortOrder: 'descend',
      render: (value: number) => <Text strong>{money(value, currency)}</Text>,
    },
    {
      title: 'Кол-во',
      dataIndex: 'qty',
      align: 'right',
      width: 110,
      sorter: (a, b) => a.qty - b.qty,
      render: (value: number) => Number(value).toLocaleString('ru-RU'),
    },
    {
      title: 'Сделок',
      dataIndex: 'deals',
      align: 'right',
      width: 110,
      sorter: (a, b) => a.deals - b.deals,
      render: (value: number, row) => (
        <Space size={4}>
          <Text>{value}</Text>
          {row.won_deals ? <Tag color="green">{row.won_deals}</Tag> : null}
        </Space>
      ),
    },
    {
      title: 'Контактов',
      dataIndex: 'contacts',
      align: 'right',
      width: 110,
      render: (value: number) => value || '—',
    },
    {
      title: 'Первая покупка',
      dataIndex: 'first_at',
      width: 140,
      render: (value: string | null) => fmtDate(value),
    },
    {
      title: 'Последняя покупка',
      dataIndex: 'last_at',
      width: 150,
      sorter: (a, b) => String(a.last_at).localeCompare(String(b.last_at)),
      render: (value: string | null) => fmtDate(value),
    },
    {
      title: '',
      width: 90,
      render: (_value, row) => (
        <Button size="small" type="link" onClick={() => navigate(`/companies/${row.id}`)}>
          Карточка
        </Button>
      ),
    },
  ];

  const dealColumns: NonNullable<TableProps<ProductReportDeal>['columns']> = [
    {
      title: 'Сделка',
      dataIndex: 'deal_title',
      render: (value: string | null, row) => <Link to={`/deals/${row.deal_id}`}>{value || `Сделка #${row.deal_id}`}</Link>,
    },
    {
      title: 'Стадия',
      dataIndex: 'stage',
      width: 220,
      render: (value: string | null, row) => {
        const won = String(row.stage_id || '').endsWith('WON');
        return <Tag color={won ? 'green' : 'default'}>{value || row.stage_id || '—'}</Tag>;
      },
    },
    {
      title: 'Компания',
      dataIndex: 'company_title',
      width: 240,
      render: (value: string | null, row) =>
        row.company_id ? (
          <Link to={`/companies/${row.company_id}`}>{value || `Компания #${row.company_id}`}</Link>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'Кол-во',
      dataIndex: 'quantity',
      align: 'right',
      width: 100,
      render: (value: number) => Number(value).toLocaleString('ru-RU'),
    },
    {
      title: 'Сумма строки',
      dataIndex: 'revenue',
      align: 'right',
      width: 140,
      render: (value: number) => money(value, currency),
    },
    {
      title: 'Дата',
      dataIndex: 'date_create',
      width: 130,
      render: (value: string | null) => fmtDate(value),
    },
  ];

  return (
    <Flex vertical gap={16}>
      <Card size="small">
        <Flex wrap gap={12} align="center" justify="space-between">
          <Space direction="vertical" size={2}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {product.section_path.length
                ? product.section_path.map((item) => item.name).filter(Boolean).join(' → ')
                : 'Без раздела'}
            </Text>
            <Title level={4} style={{ margin: 0 }}>
              {product.name}
            </Title>
            <Space size={6} wrap>
              <Tag>ID {product.id}</Tag>
              {product.active ? <Tag color="green">активен</Tag> : <Tag>не активен</Tag>}
              {product.price !== null ? <Tag>прайс {money(product.price, currency)}</Tag> : null}
              {product.measure ? <Tag>{product.measure}</Tag> : null}
              <Tag color={report.stage === 'won' ? 'blue' : 'default'}>
                {report.stage === 'won' ? 'только успешные сделки' : 'все сделки'}
              </Tag>
            </Space>
          </Space>

          <Space wrap>
            <Select
              showSearch
              allowClear
              placeholder="Выбрать другой товар"
              value={undefined}
              style={{ minWidth: 280 }}
              options={options}
              filterOption={false}
              onSearch={searchProducts}
              onChange={(value) => value && navigate(`/products/${value}`)}
            />
            <Segmented value={preset} onChange={(value) => setPreset(String(value))} options={PRESETS} />
            <Segmented value={group} onChange={(value) => setGroup(String(value))} options={GROUPS} />
            <Segmented
              value={stage}
              onChange={(value) => setStage(value as 'won' | 'all')}
              options={[
                { value: 'won', label: 'Продажи' },
                { value: 'all', label: 'Все сделки' },
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
            <Button
              icon={<DownloadOutlined />}
              onClick={() => api.productReportCsv(product.id, { ...params }).catch((err: Error) => setError(err.message))}
            >
              CSV
            </Button>
          </Space>
        </Flex>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Выручка" value={totals.revenue} precision={0} suffix="₽" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="Продано"
              value={totals.qty}
              precision={0}
              suffix={product.measure || ''}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Сделок" value={totals.deals} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Компаний" value={totals.companies} />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title={`Динамика по ${group === 'month' ? 'месяцам' : group === 'quarter' ? 'кварталам' : 'годам'}`}
        extra={
          <Flex gap={12} wrap align="center">
            <Segmented
              size="small"
              value={metric}
              onChange={(value) => setMetric(value as typeof metric)}
              options={[
                { value: 'revenue', label: 'Выручка' },
                { value: 'qty', label: 'Количество' },
                { value: 'companies', label: 'Компании' },
                { value: 'deals', label: 'Сделки' },
              ]}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
            {totals.first_at ? `первая продажа ${fmtDate(totals.first_at)}` : 'продаж нет'}
            {totals.last_at ? ` · последняя ${fmtDate(totals.last_at)}` : ''}
              {totals.discount ? ` · скидки ${money(totals.discount, currency)}` : ''}
            </Text>
          </Flex>
        }
      >
        {timeline.length ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={timeline} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="productRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_PALETTE[0]} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={CHART_PALETTE[0]} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="period" stroke={grid} tick={{ fontSize: 12, fill: axis.fill }} tickFormatter={(value) => fmtDate(String(value))} />
              <YAxis
                stroke={grid}
                tick={{ fontSize: 12, fill: axis.fill }}
                tickFormatter={(value) =>
                  metric === 'revenue' ? `${Math.round(Number(value) / 1000)}k` : String(Math.round(Number(value)))
                }
              />
              <ChartTooltip
                contentStyle={tooltip}
                formatter={(value: number, name: string) => {
                  if (name === 'revenue') return [money(value, currency), 'Выручка'];
                  const labels: Record<string, string> = { qty: 'Количество', deals: 'Сделок', companies: 'Компаний' };
                  return [Number(value).toLocaleString('ru-RU'), labels[name] ?? name];
                }}
                labelFormatter={(value) => fmtDate(String(value))}
              />
              <Area
                type="monotone"
                dataKey={metric}
                stroke={CHART_PALETTE[0]}
                strokeWidth={2}
                fill="url(#productRevenue)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <Empty description="За выбранный период продаж не было" />
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card
            size="small"
            title={`Компании, которые покупали (${filteredCompanies.length})`}
            extra={
              <Tooltip title="В скобках у сделок — количество успешных">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  сортировка по выручке
                </Text>
              </Tooltip>
            }
          >
            <Input
              allowClear
              placeholder="Фильтр по компании или городу"
              value={companyQuery}
              onChange={(event) => setCompanyQuery(event.target.value)}
              style={{ marginBottom: 12, maxWidth: 320 }}
            />
            <Table
              size="small"
              rowKey="id"
              loading={loading}
              dataSource={filteredCompanies}
              columns={companyColumns}
              pagination={{ pageSize: 25, showSizeChanger: true, pageSizeOptions: [25, 50, 100] }}
              scroll={{ x: 900 }}
            />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card size="small" title="Топ компаний" style={{ marginBottom: 16 }}>
            {companies.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={companies.slice(0, 8).map((row) => ({ name: row.title || `#${row.id}`, revenue: row.revenue }))}
                  layout="vertical"
                  margin={{ top: 4, right: 12, bottom: 4, left: 0 }}
                >
                  <CartesianGrid stroke={grid} horizontal={false} />
                  <XAxis type="number" stroke={grid} tick={{ fontSize: 11, fill: axis.fill }} />
                  <YAxis type="category" dataKey="name" width={120} stroke={grid} tick={{ fontSize: 11, fill: axis.fill }} />
                  <ChartTooltip contentStyle={tooltip} formatter={(value: number) => money(value, currency)} />
                  <Bar dataKey="revenue" fill={CHART_PALETTE[1]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="Нет покупателей" />
            )}
          </Card>

          <Card size="small" title="Последние сделки с товаром">
            <Table
              size="small"
              rowKey="deal_id"
              dataSource={report.deals}
              columns={dealColumns}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              scroll={{ x: 620 }}
            />
          </Card>
        </Col>
      </Row>
      {measure ? <Text type="secondary">{measure}</Text> : null}
    </Flex>
  );
}
