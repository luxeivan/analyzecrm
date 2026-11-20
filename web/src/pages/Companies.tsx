import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Card, Flex, Input, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import type { ColumnsType, SortOrder } from 'antd/es/table/interface';
import { api } from '../api';
import { fmtDay } from '../format';
import type { CompanyRow, FieldDef, Page } from '../types';

const { Title, Text } = Typography;

type SortField = 'id' | 'title' | 'city' | 'date_modify';

const FILTERS_EMPTY = { q: '', industry: '', source: '', city: '', ufCode: '', ufValue: '' };

export default function Companies() {
  const navigate = useNavigate();
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [filters, setFilters] = useState(FILTERS_EMPTY);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({
    field: 'date_modify',
    dir: 'desc',
  });
  const [data, setData] = useState<Page<CompanyRow> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .fields('company')
      .then((result) => setFields(result.fields))
      .catch(() => setFields([]));
  }, []);

  const industryItems = fields.find((field) => field.code === 'INDUSTRY')?.items ?? [];
  const sourceItems = fields.find((field) => field.code === 'SOURCE_ID')?.items ?? [];
  const customEnumFields = fields.filter((field) => field.isCustom && field.items.length > 0);
  const activeCustomField = customEnumFields.find((field) => field.code === filters.ufCode);

  const params = useMemo(
    () => ({
      q: filters.q.trim(),
      industry: filters.industry,
      source: filters.source,
      city: filters.city.trim(),
      ...(filters.ufCode && filters.ufValue ? { [filters.ufCode]: filters.ufValue } : {}),
      page,
      limit,
      sort: sort.field,
      dir: sort.dir,
    }),
    [filters, page, limit, sort],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      api
        .companies(params)
        .then(setData)
        .catch((err: Error) => setError(err.message))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [params]);

  const update = (patch: Partial<typeof FILTERS_EMPTY>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const sortOrderFor = (field: SortField): SortOrder =>
    sort.field === field ? (sort.dir === 'asc' ? 'ascend' : 'descend') : null;

  const columns: ColumnsType<CompanyRow> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 90, sorter: true, sortOrder: sortOrderFor('id') },
    {
      title: 'Компания',
      dataIndex: 'title',
      key: 'title',
      sorter: true,
      sortOrder: sortOrderFor('title'),
      ellipsis: true,
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: 'Отрасль',
      dataIndex: 'industry',
      key: 'industry',
      width: 170,
      ellipsis: true,
      render: (value: string | null) => (value ? <Tag color="purple">{value}</Tag> : '—'),
    },
    {
      title: 'Источник',
      dataIndex: 'source',
      key: 'source',
      width: 150,
      render: (value: string | null) => (value ? <Tag color="blue">{value}</Tag> : '—'),
    },
    {
      title: 'Город',
      dataIndex: 'city',
      key: 'city',
      width: 150,
      sorter: true,
      sortOrder: sortOrderFor('city'),
      ellipsis: true,
      render: (value: string | null, row) => value ?? row.region ?? '—',
    },
    {
      title: 'Телефоны',
      dataIndex: 'phones',
      key: 'phones',
      width: 180,
      ellipsis: true,
      render: (phones: CompanyRow['phones']) => phones.map((phone) => phone.value).join(', ') || '—',
    },
    {
      title: 'Email',
      dataIndex: 'emails',
      key: 'emails',
      width: 180,
      ellipsis: true,
      render: (emails: CompanyRow['emails']) => emails.map((email) => email.value).join(', ') || '—',
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

  const onTableChange: TableProps<CompanyRow>['onChange'] = (pagination, _filters, sorter, extra) => {
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
          Компании
        </Title>
        <Text type="secondary">поиск по любым полям, включая кастомные UF_*</Text>
      </Flex>

      <Card size="small">
        <Space wrap size={12}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Название, телефон, email, ИНН…"
            style={{ width: 320 }}
            value={filters.q}
            onChange={(event) => update({ q: event.target.value })}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Отрасль"
            style={{ width: 190 }}
            value={filters.industry || undefined}
            onChange={(value) => update({ industry: value ?? '' })}
            options={industryItems.map((item) => ({ value: item.id, label: item.value }))}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Источник"
            style={{ width: 170 }}
            value={filters.source || undefined}
            onChange={(value) => update({ source: value ?? '' })}
            options={sourceItems.map((item) => ({ value: item.id, label: item.value }))}
          />
          <Input
            allowClear
            placeholder="Город"
            style={{ width: 150 }}
            value={filters.city}
            onChange={(event) => update({ city: event.target.value })}
          />

          {customEnumFields.length > 0 ? (
            <>
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Кастомное поле"
                style={{ width: 220 }}
                value={filters.ufCode || undefined}
                onChange={(value) => update({ ufCode: value ?? '', ufValue: '' })}
                options={customEnumFields.map((field) => ({
                  value: field.code,
                  label: field.label,
                }))}
              />
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Значение"
                style={{ width: 190 }}
                disabled={!activeCustomField}
                value={filters.ufValue || undefined}
                onChange={(value) => update({ ufValue: value ?? '' })}
                options={(activeCustomField?.items ?? []).map((item) => ({
                  value: item.id,
                  label: item.value,
                }))}
              />
            </>
          ) : null}

          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              setFilters(FILTERS_EMPTY);
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
        <Table<CompanyRow>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={data?.items ?? []}
          onChange={onTableChange}
          scroll={{ x: 1100 }}
          locale={{ emptyText: 'Ничего не найдено. Если таблица пуста — запустите выгрузку на дашборде.' }}
          pagination={{
            current: page,
            pageSize: limit,
            total: data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [25, 50, 100, 200],
            showTotal: (total) => `Всего: ${total.toLocaleString('ru-RU')}`,
          }}
          onRow={(row) => ({
            onClick: () => navigate(`/companies/${row.id}`),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>
    </Flex>
  );
}
