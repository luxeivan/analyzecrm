import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Card, Flex, Input, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import type { SortOrder } from 'antd/es/table/interface';
import { api } from '../api';
import { fmtDay, isLostStage, isWonStage, money } from '../format';
import type { DealRow, FieldDef, Page } from '../types';

const { Title, Text } = Typography;

type SortField = 'id' | 'title' | 'company' | 'stage' | 'opportunity' | 'date_modify';

export default function Deals() {
  const navigate = useNavigate();
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({
    field: 'date_modify',
    dir: 'desc',
  });
  const [data, setData] = useState<Page<DealRow> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .fields('deal')
      .then((result) => setFields(result.fields))
      .catch(() => setFields([]));
  }, []);

  const stageItems = fields.find((field) => field.code === 'STAGE_ID')?.items ?? [];

  const params = useMemo(
    () => ({
      q: q.trim(),
      stage,
      page,
      limit,
      sort: sort.field,
      dir: sort.dir,
    }),
    [q, stage, page, limit, sort],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      api
        .deals(params)
        .then(setData)
        .catch((err: Error) => setError(err.message))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [params]);

  const sortOrderFor = (field: SortField): SortOrder =>
    sort.field === field ? (sort.dir === 'asc' ? 'ascend' : 'descend') : null;

  const columns: NonNullable<TableProps<DealRow>['columns']> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 90, sorter: true, sortOrder: sortOrderFor('id') },
    {
      title: 'Сделка',
      dataIndex: 'title',
      key: 'title',
      sorter: true,
      sortOrder: sortOrderFor('title'),
      ellipsis: true,
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: 'Компания',
      dataIndex: 'company_title',
      key: 'company',
      sorter: true,
      sortOrder: sortOrderFor('company'),
      ellipsis: true,
      render: (value: string | null, row) => value ?? (row.company_id ? `#${row.company_id}` : '—'),
    },
    {
      title: 'Контакт',
      dataIndex: 'contact_title',
      key: 'contact',
      ellipsis: true,
      render: (value: string | null, row) => value ?? (row.contact_id ? `#${row.contact_id}` : '—'),
    },
    {
      title: 'Стадия',
      dataIndex: 'stage',
      key: 'stage',
      width: 190,
      sorter: true,
      sortOrder: sortOrderFor('stage'),
      render: (value: string | null) =>
        value ? (
          <Tag color={isWonStage(value) ? 'success' : isLostStage(value) ? 'error' : 'processing'}>
            {value}
          </Tag>
        ) : (
          '—'
        ),
    },
    {
      title: 'Сумма',
      dataIndex: 'opportunity',
      key: 'opportunity',
      width: 150,
      sorter: true,
      sortOrder: sortOrderFor('opportunity'),
      align: 'right',
      render: (value: number | null, row) => money(value, row.currency_id),
    },
    {
      title: 'Изменена',
      dataIndex: 'date_modify',
      key: 'date_modify',
      width: 110,
      sorter: true,
      sortOrder: sortOrderFor('date_modify'),
      render: (value: string | null) => fmtDay(value),
    },
  ];

  const onTableChange: TableProps<DealRow>['onChange'] = (pagination, _filters, sorter, extra) => {
    if (extra.action === 'sort') {
      const single = Array.isArray(sorter) ? sorter[0] : sorter;
      if (single?.columnKey && single.order) {
        setSort({
          field: String(single.columnKey) as SortField,
          dir: single.order === 'ascend' ? 'asc' : 'desc',
        });
      }
      setPage(1);
    } else if (extra.action === 'paginate') {
      if (pagination.pageSize && pagination.pageSize !== limit) {
        setLimit(pagination.pageSize);
        setPage(1);
      } else if (pagination.current) {
        setPage(pagination.current);
      }
    }
  };

  return (
    <Flex vertical gap={16}>
      <Flex align="baseline" gap={12} wrap>
        <Title level={4} style={{ margin: 0 }}>
          Сделки
        </Title>
        <Text type="secondary">воронка, суммы, привязка к компаниям и контактам</Text>
      </Flex>

      <Card size="small">
        <Space wrap size={12}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Название сделки…"
            style={{ width: 320 }}
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Стадия"
            style={{ width: 240 }}
            value={stage || undefined}
            onChange={(value) => {
              setStage(value ?? '');
              setPage(1);
            }}
            options={stageItems.map((item) => ({ value: item.id, label: item.value }))}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              setQ('');
              setStage('');
              setPage(1);
            }}
          >
            Сбросить
          </Button>
        </Space>
      </Card>

      {error ? (
        <Card>
          <Text type="danger">Ошибка: {error}</Text>
        </Card>
      ) : null}

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<DealRow>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={data?.items ?? []}
          onChange={onTableChange}
          scroll={{ x: 1100 }}
          locale={{ emptyText: 'Сделок нет. Запустите выгрузку на дашборде.' }}
          pagination={{
            current: page,
            pageSize: limit,
            total: data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [25, 50, 100, 200],
            showTotal: (total) => `Всего: ${total.toLocaleString('ru-RU')}`,
          }}
          onRow={(row) => ({
            onClick: () => navigate(`/deals/${row.id}`),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>
    </Flex>
  );
}
