import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  App as AntApp,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Drawer,
  Flex,
  List,
  Row,
  Slider,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '../api';
import { fmtDay, money } from '../format';
import type {
  DuplicateGroupDetails,
  DuplicateGroupItem,
  DuplicateGroupsPage,
  DuplicatesSummary,
  DuplicatesSummaryRow,
} from '../types';

const { Text, Title } = Typography;

const PATHS: Record<string, string> = {
  company: '/companies',
  contact: '/contacts',
  lead: '/leads',
};

const FIELD_LABELS: Record<string, string> = {
  city: 'Город',
  region: 'Регион',
  address: 'Адрес',
  inn: 'ИНН',
  date_create: 'Создана',
  date_modify: 'Изменена',
  name: 'Имя',
  last_name: 'Фамилия',
  second_name: 'Отчество',
  company_id: 'Компания (ID)',
  company_title: 'Компания',
  post: 'Должность',
  phones: 'Телефоны',
  emails: 'Email',
};

const fmtDateTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const scoreColor = (score: number) => (score >= 0.999 ? 'red' : score >= 0.95 ? 'orange' : 'green');

/** Отчёт по дублям: группы карточек (2+), сравнение всех участников и их сделок. */
export default function DuplicatesPage() {
  const { message } = AntApp.useApp();
  const [summary, setSummary] = useState<DuplicatesSummary | null>(null);
  const [threshold, setThreshold] = useState(0.9);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [groups, setGroups] = useState<DuplicateGroupsPage | null>(null);
  const [entity, setEntity] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [running, setRunning] = useState(false);
  const [details, setDetails] = useState<{ entity: string; data: DuplicateGroupDetails } | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await api.duplicatesSummary());
    } catch {
      /* оставляем прошлые данные */
    }
  }, []);

  useEffect(() => {
    loadSummary();
    const timer = setInterval(loadSummary, 7000);
    return () => clearInterval(timer);
  }, [loadSummary]);

  const loadGroups = useCallback(
    async (nextEntity: string, nextPage = page, nextLimit = limit) => {
      setLoadingGroups(true);
      try {
        setGroups(await api.duplicatesGroups(nextEntity, { threshold, page: nextPage, limit: nextLimit }));
      } catch (err) {
        message.error((err as Error).message);
        setGroups(null);
      } finally {
        setLoadingGroups(false);
      }
    },
    [threshold, page, limit, message],
  );

  useEffect(() => {
    if (entity) loadGroups(entity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, threshold, page, limit]);

  const runCalc = async () => {
    setRunning(true);
    try {
      await api.duplicatesRun(threshold);
      message.success('Расчёт дублей запущен в фоне — статистика обновится сама');
      setTimeout(loadSummary, 3000);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const openGroup = async (groupEntity: string, group: DuplicateGroupItem) => {
    setDetailsLoading(true);
    try {
      const data = await api.duplicatesGroup(
        groupEntity,
        group.records.map((record) => record.id),
      );
      setDetails({ entity: groupEntity, data });
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setDetailsLoading(false);
    }
  };

  const groupsTable = (row: DuplicatesSummaryRow) => (
    <Flex vertical gap={12}>
      <Flex gap={16} wrap>
        <Text>
          Групп: <Text strong>{(groups?.total ?? 0).toLocaleString('ru-RU')}</Text>
        </Text>
        <Text>
          Карточек в группах: <Text strong>{(groups?.recordsInGroups ?? 0).toLocaleString('ru-RU')}</Text>
        </Text>
        <Text>
          Полных совпадений (100%): <Text strong type="danger">{(groups?.exactGroups ?? 0).toLocaleString('ru-RU')}</Text>
        </Text>
      </Flex>

      {row.embedded < row.total ? (
        <Text type="secondary">
          Учтены только записи с вектором: {row.embedded.toLocaleString('ru-RU')} из {row.total.toLocaleString('ru-RU')}.
          Пересчитайте после завершения векторизации.
        </Text>
      ) : null}

      <Table
        size="small"
        rowKey="key"
        loading={loadingGroups && entity === row.entity}
        dataSource={entity === row.entity ? groups?.items ?? [] : []}
        pagination={{
          current: entity === row.entity ? groups?.page ?? page : page,
          pageSize: limit,
          total: entity === row.entity ? groups?.total ?? 0 : 0,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100],
          onChange: (nextPage, nextSize) => {
            if (nextSize !== limit) {
              setLimit(nextSize);
              setPage(1);
            } else {
              setPage(nextPage);
            }
          },
          showTotal: (total) => `Групп: ${total.toLocaleString('ru-RU')}`,
        }}
        columns={[
          {
            title: 'Карточек',
            dataIndex: 'size',
            width: 110,
            render: (value: number) => <Tag color={value >= 5 ? 'red' : value >= 3 ? 'orange' : 'default'}>{value}</Tag>,
          },
          {
            title: 'Совпадение',
            dataIndex: 'minScore',
            width: 140,
            render: (value: number, group) => (
              <Tag color={scoreColor(value)}>
                {value >= 0.999
                  ? '100%'
                  : `${(value * 100).toFixed(1)}%${group.maxScore < 1 ? `–${(group.maxScore * 100).toFixed(1)}%` : ''}`}
              </Tag>
            ),
          },
          {
            title: 'Записи в группе',
            render: (_: unknown, group) => (
              <Text>
                {group.records
                  .slice(0, 3)
                  .map((record) => record.title || `#${record.id}`)
                  .join(' · ')}
                {group.records.length > 3 ? ` и ещё ${group.records.length - 3}` : ''}
              </Text>
            ),
          },
          {
            title: '',
            width: 130,
            render: (_: unknown, group) => (
              <Button
                size="small"
                icon={<SearchOutlined />}
                onClick={() => openGroup(row.entity, group)}
              >
                Сравнить
              </Button>
            ),
          },
        ]}
        locale={{
          emptyText:
            row.pairs === 0
              ? 'Дублей не найдено — запустите расчёт'
              : 'По этому порогу групп нет — уменьшите минимальную близость',
        }}
      />
    </Flex>
  );

  const items = useMemo(
    () =>
      (summary?.byEntity ?? []).map((row) => ({
        key: row.entity,
        label: (
          <Flex justify="space-between" align="center" gap={12} wrap>
            <Space size={10}>
              <Text strong>{row.label}</Text>
              <Tag color={row.pairs > 0 ? 'volcano' : 'default'}>{row.pairs.toLocaleString('ru-RU')} пар</Tag>
            </Space>
            <Space size={12} wrap>
              <Text type="secondary" style={{ fontSize: 12 }}>
                векторы: {row.embedded.toLocaleString('ru-RU')} / {row.total.toLocaleString('ru-RU')}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                рассчитано: {fmtDateTime(row.computedAt)}
              </Text>
            </Space>
          </Flex>
        ),
        children: groupsTable(row),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summary, groups, entity, page, limit, loadingGroups],
  );

  return (
    <Flex vertical gap={16}>
      <Flex align="baseline" justify="space-between" wrap gap={8}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Дубли
          </Title>
          <Text type="secondary">
            Пары объединяются в группы: видно не только двойники, но и множественное задублирование одной карточки.
          </Text>
        </div>
        <Space wrap>
          <Text type="secondary">порог</Text>
          <Slider
            min={0.85}
            max={0.99}
            step={0.01}
            value={threshold}
            onChange={setThreshold}
            style={{ width: 140 }}
          />
          <Text strong>{(threshold * 100).toFixed(0)}%</Text>
          <Button icon={<ReloadOutlined />} loading={running} onClick={runCalc}>
            Пересчитать
          </Button>
        </Space>
      </Flex>

      <Row gutter={[16, 16]}>
        {(summary?.byEntity ?? []).map((row) => (
          <Col xs={24} sm={8} key={row.entity}>
            <Card size="small">
              <Text type="secondary">{row.label}</Text>
              <Title level={3} style={{ margin: 0 }}>
                {row.pairs.toLocaleString('ru-RU')}
              </Title>
              <Text type="secondary" style={{ fontSize: 12 }}>
                пар · векторы {row.embedded.toLocaleString('ru-RU')} / {row.total.toLocaleString('ru-RU')}
              </Text>
            </Card>
          </Col>
        ))}
      </Row>

      <Collapse
        accordion
        items={items}
        activeKey={openKeys}
        onChange={(keys) => {
          const next = Array.isArray(keys) ? keys : [keys];
          setOpenKeys(next);
          const nextEntity = next[0];
          if (nextEntity && nextEntity !== entity) {
            setPage(1);
            setEntity(nextEntity);
          }
        }}
      />

      <Drawer
        width="100%"
        title={details ? `Группа из ${details.data.records.length} карточек` : 'Сравнение'}
        open={Boolean(details)}
        onClose={() => setDetails(null)}
        loading={detailsLoading}
      >
        {details ? (
          <Flex gap={16} style={{ overflowX: 'auto', alignItems: 'flex-start', paddingBottom: 8 }}>
            {details.data.records.map((record) => (
              <Card
                key={record.id}
                size="small"
                style={{ minWidth: 340, maxWidth: 380, flex: '0 0 auto' }}
                title={
                  <Link to={`${PATHS[details.entity]}/${record.id}`}>{record.title || `#${record.id}`}</Link>
                }
                extra={<Text type="secondary">#{record.id}</Text>}
              >
                <Descriptions column={1} size="small" bordered>
                  {record.fields.map((field) => (
                    <Descriptions.Item key={field.key} label={FIELD_LABELS[field.label] ?? field.label}>
                      {field.value || <Text type="secondary">—</Text>}
                    </Descriptions.Item>
                  ))}
                  {record.statusName ? (
                    <Descriptions.Item label="Статус">{record.statusName}</Descriptions.Item>
                  ) : null}
                </Descriptions>

                <Card size="small" type="inner" title="Сделки" style={{ marginTop: 12 }}>
                  <Flex gap={16} wrap>
                    <Statistic title="Всего" value={record.deals.count} valueStyle={{ fontSize: 18 }} />
                    <Statistic
                      title="Сумма"
                      value={money(record.deals.sum)}
                      valueStyle={{ fontSize: 18 }}
                    />
                    <Statistic
                      title="Выиграно"
                      value={money(record.deals.won_sum)}
                      valueStyle={{ fontSize: 18 }}
                    />
                  </Flex>
                  {record.deals.items.length ? (
                    <List
                      size="small"
                      style={{ marginTop: 8 }}
                      dataSource={record.deals.items}
                      renderItem={(deal) => (
                        <List.Item>
                          <Flex vertical style={{ width: '100%' }}>
                            <Link to={`/deals/${deal.id}`}>{deal.title || `#${deal.id}`}</Link>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {fmtDay(deal.date_create)} · {deal.stageName} · {money(deal.opportunity)}
                            </Text>
                          </Flex>
                        </List.Item>
                      )}
                    />
                  ) : (
                    <Text type="secondary">Сделок нет</Text>
                  )}
                </Card>
              </Card>
            ))}
          </Flex>
        ) : null}
      </Drawer>
    </Flex>
  );
}
