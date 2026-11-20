import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ReloadOutlined, RobotOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Flex,
  List,
  Progress,
  Row,
  Segmented,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api';
import Markdown from '../components/Markdown';
import { fmtDate, money } from '../format';
import { CHART_PALETTE, useChartTheme } from '../theme';
import type { Analytics, AnalyticsRecommendation } from '../types';

const { Title, Text } = Typography;

const chartBox = { height: 260 };

const SEVERITY: Record<AnalyticsRecommendation['severity'], { color: string; label: string }> = {
  high: { color: 'red', label: 'важно' },
  medium: { color: 'orange', label: 'средне' },
  low: { color: 'gold', label: 'мелкое' },
  info: { color: 'blue', label: 'наблюдение' },
};

const ENTITY_LABEL: Record<string, string> = {
  company: 'Компании',
  contact: 'Контакты',
  deal: 'Сделки',
  lead: 'Лиды',
};

const AI_KEY = 'crm-analyzer-llm-insights';

type AiState = { text: string | null; hint: string | null; at: string | null };

const share = (value: number, total: number) =>
  total > 0 ? Math.round((value / total) * 1000) / 10 : 0;

type PeriodKey = 'month' | 'prev' | 'quarter' | 'year' | 'all';

const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: 'month', label: 'Текущий месяц' },
  { value: 'prev', label: 'Прошлый месяц' },
  { value: 'quarter', label: '3 месяца' },
  { value: 'year', label: 'Текущий год' },
  { value: 'all', label: 'Всё время' },
];

const ymd = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Границы периода в локальном календаре (BEGINDATE сделок и дата создания лидов). */
const periodRange = (key: PeriodKey): { from?: string; to?: string } => {
  if (key === 'all') return {};
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (key === 'month') return { from: ymd(new Date(year, month, 1)), to: ymd(new Date(year, month + 1, 1)) };
  if (key === 'prev') return { from: ymd(new Date(year, month - 1, 1)), to: ymd(new Date(year, month, 1)) };
  if (key === 'quarter')
    return { from: ymd(new Date(year, month - 2, 1)), to: ymd(new Date(year, month + 1, 1)) };
  return { from: ymd(new Date(year, 0, 1)), to: ymd(new Date(year + 1, 0, 1)) };
};

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ai, setAi] = useState<AiState>(() => {
    try {
      const raw = localStorage.getItem(AI_KEY);
      if (raw) return JSON.parse(raw) as AiState;
    } catch {
      // приватный режим / испорченное значение — просто стартуем пустыми
    }
    return { text: null, hint: null, at: null };
  });
  const [aiLoading, setAiLoading] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>('month');
  const range = useMemo(() => periodRange(period), [period]);
  const chart = useChartTheme();

  const persistAi = (updater: (prev: AiState) => AiState) => {
    setAi((prev) => {
      const next = updater(prev);
      try {
        localStorage.setItem(AI_KEY, JSON.stringify(next));
      } catch {
        // не критично: просто не запомним между переходами
      }
      return next;
    });
  };

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .analytics(range)
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(load, [load]);

  const runAi = async () => {
    setAiLoading(true);
    try {
      const result = await api.aiInsights();
      if (result.configured && result.text) {
        const usage = result.usage;
        persistAi(() => ({
          text: result.text ?? null,
          at: new Date().toISOString(),
          hint:
            [
              result.provider ? `провайдер: ${result.provider}` : null,
              result.model ? `модель: ${result.model}` : null,
              usage?.totalTokens
                ? `токенов: ${usage.totalTokens.toLocaleString('ru-RU')} (вход ${usage.promptTokens ?? '—'} / выход ${usage.completionTokens ?? '—'})`
                : null,
              usage?.costRub ? `стоимость: ${usage.costRub.toFixed(4)} ₽` : null,
            ]
              .filter(Boolean)
              .join(' · ') || null,
        }));
      } else {
        persistAi((prev) => ({ ...prev, hint: result.hint ?? 'LLM не настроена' }));
      }
    } catch (err) {
      persistAi((prev) => ({ ...prev, hint: (err as Error).message }));
    } finally {
      setAiLoading(false);
    }
  };

  if (error) {
    return (
      <Card>
        <Text type="danger">Не удалось загрузить аналитику: {error}</Text>
        <div style={{ marginTop: 12 }}>
          <Button onClick={load} icon={<ReloadOutlined />}>
            Повторить
          </Button>
        </div>
      </Card>
    );
  }

  if (!data || loading) {
    return (
      <Flex vertical gap={16}>
        <Skeleton active paragraph={{ rows: 2 }} />
        <Row gutter={[16, 16]}>
          {[0, 1, 2, 3].map((key) => (
            <Col key={key} xs={12} xl={6}>
              <Card loading />
            </Col>
          ))}
        </Row>
        <Card loading />
      </Flex>
    );
  }

  const q = data.quality;
  const qualityRows = [
    { key: 'c-phone', metric: 'Компании без телефона в выгрузке', value: q.companies.no_phone_exported, total: q.companies.total, note: 'PHONE не входил в select «*»' },
    { key: 'c-city', metric: 'Компании без города', value: q.companies.no_city, total: q.companies.total, note: 'city пуст, адрес в ADDRESS_CITY' },
    { key: 'c-industry', metric: 'Компании без отрасли', value: q.companies.no_industry, total: q.companies.total, note: 'INDUSTRY не заполнена' },
    { key: 'c-contacts', metric: 'Компании без контактов', value: q.companies.no_contacts, total: q.companies.total, note: 'нет ни одного контакта' },
    { key: 'ct-company', metric: 'Контакты без компании', value: q.contacts.no_company, total: q.contacts.total, note: 'ссылка не заполнена' },
    { key: 'ct-position', metric: 'Контакты без должности', value: q.contacts.no_position, total: q.contacts.total, note: 'POST пустой' },
    { key: 'd-contact', metric: 'Сделки без контакта', value: q.deals.no_contact, total: q.deals.total, note: 'нельзя оценить ЛПР' },
    { key: 'd-zero', metric: 'Сделки с нулевой суммой', value: q.deals.zero_sum, total: q.deals.total, note: 'занижает средний чек' },
    { key: 'd-gap', metric: 'Сделки на невыгруженную компанию', value: q.deals.company_not_loaded, total: q.deals.total, note: 'компания ещё не загружена' },
    { key: 'l-company', metric: 'Лиды без компании', value: q.leads.no_company, total: q.leads.total, note: 'нет привязки' },
    { key: 'l-contact', metric: 'Лиды без контакта', value: q.leads.no_contact, total: q.leads.total, note: 'нет привязки' },
    { key: 'dup-titles', metric: 'Дубли названий компаний', value: q.duplicates.company_title_rows, total: q.companies.total, note: `${q.duplicates.company_title_groups} групп` },
    { key: 'dup-names', metric: 'Дубли имён контактов', value: q.duplicates.contact_name_rows, total: q.contacts.total, note: `${q.duplicates.contact_name_groups} групп` },
  ];

  const qualityColumns: NonNullable<TableProps<(typeof qualityRows)[number]>['columns']> = [
    { title: 'Показатель', dataIndex: 'metric', key: 'metric' },
    {
      title: 'Значение',
      dataIndex: 'value',
      key: 'value',
      width: 120,
      align: 'right',
      render: (value: number) => value.toLocaleString('ru-RU'),
    },
    {
      title: 'Доля',
      key: 'share',
      width: 200,
      render: (_value, row) => (
        <Flex align="center" gap={8}>
          <Progress
            percent={share(row.value, row.total)}
            size="small"
            showInfo={false}
            strokeColor={share(row.value, row.total) > 50 ? '#ff4d4f' : '#faad14'}
          />
          <Text style={{ width: 52, textAlign: 'right' }}>{share(row.value, row.total)}%</Text>
        </Flex>
      ),
    },
    { title: 'Комментарий', dataIndex: 'note', key: 'note', width: 260 },
  ];

  const years = data.years.filter((row) => Number(row.year) >= 2015);
  const cityRows = data.cities.filter((row) => row.sum > 0 && row.city !== 'Без города').slice(0, 8);

  return (
    <Flex vertical gap={16}>
      <Flex align="baseline" justify="space-between" wrap gap={8}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Аналитика
          </Title>
          <Text type="secondary">
            данные на {fmtDate(data.dataAsOf)} · {' '}
            {period === 'all'
              ? 'всё время'
              : `${fmtDate(data.period?.from ?? range.from)} — ${fmtDate(data.period?.to ?? range.to)}`}
          </Text>
        </div>
        <Space wrap>
          <Segmented
            value={period}
            onChange={(value) => setPeriod(value as PeriodKey)}
            options={PERIOD_OPTIONS}
          />
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            Обновить
          </Button>
        </Space>
      </Flex>

      {period !== 'all' && data.deals.count === 0 ? (
        <Alert
          type="info"
          showIcon
          message="За выбранный период сделок нет"
          description="В выгрузке нет сделок с датой начала в этом периоде — переключитесь на «Всё время», чтобы увидеть всю историю."
          action={
            <Button size="small" onClick={() => setPeriod('all')}>
              Всё время
            </Button>
          }
        />
      ) : null}

      <Card size="small" title="Покрытие данных (загружено / всего в CRM)">
        <Row gutter={[16, 12]}>
          {data.coverage.map((row) => (
            <Col key={row.entity} xs={12} lg={6}>
              <Flex vertical gap={4}>
                <Flex justify="space-between">
                  <Text strong>{ENTITY_LABEL[row.entity]}</Text>
                  <Text type="secondary">{row.percent ?? '—'}%</Text>
                </Flex>
                <Progress
                  percent={row.percent ?? 0}
                  showInfo={false}
                  strokeColor={row.percent && row.percent > 95 ? '#52c41a' : '#1677ff'}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {row.loaded.toLocaleString('ru-RU')} из {row.total?.toLocaleString('ru-RU') ?? '—'}
                </Text>
              </Flex>
            </Col>
          ))}
        </Row>
      </Card>

      <Row gutter={[16, 16]} align="stretch">
        {[
          { label: 'Выручка по успешным сделкам', value: money(data.deals.wonSum), hint: `всего по сделкам: ${money(data.deals.sum)}` },
          { label: 'Средний чек', value: money(data.deals.avgDeal), hint: 'по сделкам с суммой > 0' },
          { label: 'Win rate', value: `${data.deals.winRate}%`, hint: `${data.deals.won.toLocaleString('ru-RU')} успешных из ${(data.deals.won + data.deals.lost).toLocaleString('ru-RU')}` },
          { label: 'Повторные клиенты', value: `${data.repeat.share}%`, hint: `выручки дают ${data.repeat.repeatCompanies.toLocaleString('ru-RU')} компаний` },
          { label: 'Лиды', value: data.leads.count.toLocaleString('ru-RU'), hint: `конверсия ${data.leads.conversion}%` },
          { label: 'JUNK-лиды', value: data.leads.junk.toLocaleString('ru-RU'), hint: `${share(data.leads.junk, data.leads.count)}% от всех лидов` },
        ].map((card) => (
          <Col key={card.label} xs={12} lg={8} xl={4}>
            <Card size="small" style={{ height: '100%' }} styles={{ body: { height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 4 } }}>
              <Statistic title={card.label} value={card.value} valueStyle={{ fontSize: 22 }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {card.hint}
              </Text>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} xl={14}>
          <Card size="small" title="Выручка по годам (BEGINDATE)">
            <div style={chartBox}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={years} margin={{ top: 4, right: 8, bottom: 4, left: -6 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="year" tick={chart.axis} />
                  <YAxis tick={chart.axis} tickFormatter={(value) => `${Math.round(Number(value) / 1_000_000)} млн`} />
                  <Tooltip contentStyle={chart.tooltip} formatter={(value) => money(Number(value))} />
                  <Bar dataKey="won_sum" name="Успешные сделки" fill={CHART_PALETTE[0]} radius={[6, 6, 0, 0]} />
                  <Bar dataKey="sum" name="Все сделки" fill={CHART_PALETTE[3]} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card size="small" title="Статусы лидов">
            <div style={chartBox}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.leads.byStatus} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="80%" paddingAngle={2}>
                    {data.leads.byStatus.map((entry, index) => (
                      <Cell key={entry.key ?? entry.name} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={chart.tooltip} />
                  <Legend wrapperStyle={{ fontSize: 11, color: chart.axis.fill }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} xl={12}>
          <Card size="small" title="Источники лидов: конверсия">
            <div style={chartBox}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.sources.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                  <XAxis type="number" tick={chart.axis} />
                  <YAxis type="category" dataKey="name" width={120} tick={chart.axis} />
                  <Tooltip contentStyle={chart.tooltip} />
                  <Legend wrapperStyle={{ fontSize: 11, color: chart.axis.fill }} />
                  <Bar dataKey="converted" name="Конвертировано" stackId="a" fill={CHART_PALETTE[2]} />
                  <Bar dataKey="junk" name="JUNK" stackId="a" fill={CHART_PALETTE[4]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title="География выручки (топ городов)">
            {cityRows.length ? (
              <div style={chartBox}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cityRows} margin={{ top: 4, right: 8, bottom: 4, left: -6 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                    <XAxis dataKey="city" tick={chart.axis} interval={0} angle={-18} dy={8} height={50} />
                    <YAxis tick={chart.axis} tickFormatter={(value) => `${Math.round(Number(value) / 1_000_000)} млн`} />
                    <Tooltip contentStyle={chart.tooltip} formatter={(value) => money(Number(value))} />
                    <Bar dataKey="sum" name="Выручка" fill={CHART_PALETTE[1]} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Alert
                type="info"
                showIcon
                message="Города почти не заполнены"
                description="У 95% компаний поле city пустое. Нужно разобрать ADDRESS_CITY / REG_ADDRESS_CITY в ETL — без этого география продаж не строится."
              />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} xl={12}>
          <Card size="small" title="Топ-10 компаний по выручке (успешные сделки)">
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={data.topCompanies}
              locale={{ emptyText: 'Нет данных' }}
              columns={[
                {
                  title: 'Компания',
                  dataIndex: 'title',
                  key: 'title',
                  ellipsis: true,
                  render: (value: string, row) => <Link to={`/companies/${row.id}`}>{value}</Link>,
                },
                { title: 'Сделок', dataIndex: 'deals', key: 'deals', width: 80, align: 'right' },
                {
                  title: 'Выручка',
                  dataIndex: 'sum',
                  key: 'sum',
                  width: 140,
                  align: 'right',
                  render: (value: number) => money(value),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title="Динамика по месяцам (последние 24 месяца)">
            {data.months.length ? (
              <div style={chartBox}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.months} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                    <defs>
                      <linearGradient id="analyticsFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_PALETTE[0]} stopOpacity={0.6} />
                        <stop offset="100%" stopColor={CHART_PALETTE[0]} stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                    <XAxis dataKey="month" tick={chart.axis} />
                    <YAxis tick={chart.axis} tickFormatter={(value) => `${Math.round(Number(value) / 1_000_000)} млн`} />
                    <Tooltip contentStyle={chart.tooltip} formatter={(value) => money(Number(value))} />
                    <Area type="monotone" dataKey="won_sum" name="Выручка" stroke={CHART_PALETTE[0]} strokeWidth={2} fill="url(#analyticsFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Alert
                type="info"
                showIcon
                message="Нет сделок за последние 24 месяца"
                description="В текущей выборке реальные даты сделок — 2018–2020. Динамика появится после полной выгрузки сделок."
              />
            )}
          </Card>
        </Col>
      </Row>

      <Card size="small" title="Качество данных">
        <Table
          size="small"
          rowKey="key"
          pagination={false}
          dataSource={qualityRows}
          columns={qualityColumns}
          scroll={{ x: 900 }}
        />
      </Card>

      <Card size="small" title={`Рекомендации (${data.recommendations.length})`}>
        <List
          dataSource={data.recommendations}
          renderItem={(item) => (
            <List.Item>
              <Flex vertical gap={4} style={{ width: '100%' }}>
                <Space wrap size={8}>
                  <Tag color={SEVERITY[item.severity].color}>{SEVERITY[item.severity].label}</Tag>
                  <Text strong>{item.title}</Text>
                </Space>
                <Text>{item.detail}</Text>
                <Text type="secondary">→ {item.action}</Text>
              </Flex>
            </List.Item>
          )}
        />
      </Card>

      <Card
        size="small"
        title={
          <Space>
            <RobotOutlined />
            Выводы LLM
          </Space>
        }
        extra={
          <Space>
            {ai.text ? (
              <Button onClick={() => persistAi(() => ({ text: null, hint: null, at: null }))}>Очистить</Button>
            ) : null}
            <Button type="primary" icon={<RobotOutlined />} loading={aiLoading} onClick={runAi}>
              Сгенерировать выводы
            </Button>
          </Space>
        }
      >
        {ai.hint ? (
          <Alert
            type={ai.text ? 'success' : 'info'}
            showIcon
            message={ai.hint}
            style={{ marginBottom: ai.text ? 12 : 0 }}
          />
        ) : null}
        {ai.text ? (
          <>
            {ai.at ? (
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                сформировано {fmtDate(ai.at)} — сохранено локально и не пропадёт при переходах
              </Text>
            ) : null}
            <Markdown text={ai.text} />
          </>
        ) : (
          <Text type="secondary">
            Блок формирует управленческие выводы по этим же данным через LLM. Без ключа показывается инструкция по
            настройке (LLM_API_KEY, LLM_BASE_URL, LLM_MODEL в .env).
          </Text>
        )}
      </Card>
    </Flex>
  );
}
