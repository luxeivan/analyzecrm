import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Card,
  Col,
  Flex,
  Row,
  Segmented,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  ApartmentOutlined,
  BulbOutlined,
  DollarCircleOutlined,
  TeamOutlined,
} from '@ant-design/icons';
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
import { fmtDay } from '../format';
import { CHART_PALETTE, useChartTheme } from '../theme';
import type { Stats, SyncState } from '../types';

const { Text } = Typography;

const chartBox = { height: 250 };

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [sync, setSync] = useState<SyncState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [funnel, setFunnel] = useState<'deals' | 'leads'>('deals');
  const chart = useChartTheme();

  const load = useCallback(async () => {
    try {
      const [statsData, syncData] = await Promise.all([api.stats(), api.sync()]);
      setStats(statsData);
      setSync(syncData.items);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const syncColumns = [
    { title: 'Сущность', dataIndex: 'entity', key: 'entity' },
    {
      title: 'Статус',
      dataIndex: 'status',
      key: 'status',
      render: (value: string) => (
        <Tag color={value === 'done' ? 'success' : value === 'error' ? 'error' : 'warning'}>
          {value}
        </Tag>
      ),
    },
    {
      title: 'last_id',
      dataIndex: 'last_id',
      key: 'last_id',
      render: (value: number) => value?.toLocaleString('ru-RU'),
    },
    {
      title: 'total',
      dataIndex: 'total',
      key: 'total',
      render: (value: number | null) => (value ? value.toLocaleString('ru-RU') : '—'),
    },
    {
      title: 'Обновлено',
      dataIndex: 'last_run',
      key: 'last_run',
      render: (value: string | null) => fmtDay(value),
    },
  ];

  if (error) {
    return (
      <Row gutter={[16, 16]}>
        <Col span={24}>
            </Col>
        <Col span={24}>
          <Alert
            type="error"
            showIcon
            message="Не удалось загрузить статистику"
            description={
              <span>
                {error}. Проверьте, что API и БД подняты (<Text code>docker compose ps</Text>).
              </span>
            }
          />
        </Col>
      </Row>
    );
  }

  if (!stats) {
    return (
      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Card loading />
        </Col>
      </Row>
    );
  }

  const { totals, quality } = stats;

  const keyCards = [
    {
      label: 'Компании',
      value: totals.companies,
      icon: <ApartmentOutlined />,
      color: '#1677ff',
      hint: 'карточек в базе',
    },
    {
      label: 'Контакты',
      value: totals.contacts,
      icon: <TeamOutlined />,
      color: '#722ed1',
      hint: 'карточек в базе',
    },
    {
      label: 'Сделки',
      value: totals.deals,
      icon: <DollarCircleOutlined />,
      color: '#faad14',
      hint: `в работе: ${quality.open_deals}`,
    },
    {
      label: 'Лиды',
      value: totals.leads,
      icon: <BulbOutlined />,
      color: '#52c41a',
      hint: 'включая конвертированные',
    },
  ];

  const qualityCards = [
    {
      label: 'Контакты без компании',
      value: quality.contacts_without_company,
      hint: 'кандидаты на связывание',
    },
    {
      label: 'Компании без контактов',
      value: quality.companies_without_contacts,
      hint: 'пустые карточки',
    },
    { label: 'Лиды без компании', value: quality.leads_without_company, hint: 'не привязаны' },
    { label: 'Без города', value: quality.companies_without_city, hint: 'нет адреса' },
  ];

  return (
    <Flex vertical gap={16}>
      <Row gutter={[16, 16]} align="stretch">
        {keyCards.map((card) => (
          <Col key={card.label} xs={12} xl={6}>
            <Card
              size="small"
              style={{
                height: '100%',
                borderColor: `${card.color}66`,
                background: `linear-gradient(135deg, ${card.color}22, transparent 72%)`,
              }}
              styles={{
                body: {
                  padding: 18,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 10,
                },
              }}
            >
              <Flex justify="space-between" align="flex-start" gap={8}>
                <div>
                  <Text type="secondary">{card.label}</Text>
                  <div style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.15 }}>
                    {card.value.toLocaleString('ru-RU')}
                  </div>
                </div>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: `${card.color}26`,
                    color: card.color,
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 19,
                    flex: 'none',
                  }}
                >
                  {card.icon}
                </div>
              </Flex>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {card.hint}
              </Text>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} align="stretch">
        {qualityCards.map((card) => (
          <Col key={card.label} xs={12} sm={8} xl={6}>
            <Card
              size="small"
              style={{ height: '100%' }}
              styles={{
                body: {
                  padding: 16,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 4,
                },
              }}
            >
              <Statistic title={card.label} value={card.value} valueStyle={{ fontSize: 20 }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {card.hint}
              </Text>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} align="stretch">

      <Col xs={24} xl={12}>
        <Card size="small" title="Сегменты клиентов" extra={<Tag>{stats.segmentField}</Tag>}>
          <div style={chartBox}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.segments}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="45%"
                  outerRadius="80%"
                  paddingAngle={2}
                >
                  {stats.segments.map((entry, index) => (
                    <Cell key={entry.name} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={chart.tooltip} />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: chart.axis.fill }}
                  formatter={(value) => String(value).slice(0, 24)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </Col>

      <Col xs={24} xl={12}>
        <Card size="small" title="Источники компаний" extra={<Tag>SOURCE_ID</Tag>}>
          <div style={chartBox}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.sources} margin={{ top: 4, right: 8, bottom: 4, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={chart.axis}
                  interval={0}
                  angle={-18}
                  dy={8}
                  height={50}
                />
                <YAxis tick={chart.axis} />
                <Tooltip contentStyle={chart.tooltip} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {stats.sources.map((entry, index) => (
                    <Cell key={entry.name} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </Col>

      <Col xs={24} xl={12}>
        <Card size="small" title="География" extra={<Tag>топ городов</Tag>}>
          <div style={chartBox}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stats.cities}
                layout="vertical"
                margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                <XAxis type="number" tick={chart.axis} />
                <YAxis type="category" dataKey="name" width={150} tick={chart.axis} />
                <Tooltip contentStyle={chart.tooltip} />
                <Bar dataKey="value" fill={CHART_PALETTE[3]} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </Col>

      <Col xs={24} xl={12}>
        <Card
          size="small"
          title="Воронка"
          extra={
            <Segmented
              size="small"
              value={funnel}
              onChange={(value) => setFunnel(value as 'deals' | 'leads')}
              options={[
                { value: 'deals', label: 'Сделки' },
                { value: 'leads', label: 'Лиды' },
              ]}
            />
          }
        >
          <div style={chartBox}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={funnel === 'deals' ? stats.stages : stats.leadStages}
                margin={{ top: 4, right: 8, bottom: 4, left: -12 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={chart.axis}
                  interval={0}
                  angle={-18}
                  dy={8}
                  height={50}
                />
                <YAxis tick={chart.axis} />
                <Tooltip contentStyle={chart.tooltip} />
                <Bar dataKey="value" fill={CHART_PALETTE[1]} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </Col>

      <Col xs={24} xl={16}>
        <Card size="small" title="Новые компании за 12 месяцев">
          <div style={chartBox}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.timeline} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id="companiesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_PALETTE[0]} stopOpacity={0.6} />
                    <stop offset="100%" stopColor={CHART_PALETTE[0]} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis dataKey="name" tick={chart.axis} />
                <YAxis tick={chart.axis} />
                <Tooltip contentStyle={chart.tooltip} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={CHART_PALETTE[0]}
                  strokeWidth={2}
                  fill="url(#companiesFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </Col>

      <Col xs={24} xl={8}>
        <Card size="small" title="Статус выгрузки ETL">
          <Table
            size="small"
            rowKey="entity"
            columns={syncColumns}
            dataSource={sync}
            pagination={false}
            scroll={{ x: 420 }}
            locale={{ emptyText: 'ETL ещё не запускался' }}
          />
        </Card>
      </Col>
      </Row>
    </Flex>
  );
}
