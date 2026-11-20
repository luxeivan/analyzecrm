import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Flex,
  Input,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import type { SortOrder } from 'antd/es/table/interface';
import { api } from '../api';
import { fmtDay } from '../format';
import type { ContactRow, FieldDef, Page } from '../types';

const { Title, Text } = Typography;

type SortField = 'id' | 'title' | 'company' | 'source' | 'date_modify';

const FILTERS_EMPTY = { q: '', source: '', city: '', ufCode: '', ufValue: '' };

export default function Contacts() {
  const navigate = useNavigate();
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [filters, setFilters] = useState(FILTERS_EMPTY);
  const [withoutCompany, setWithoutCompany] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({
    field: 'date_modify',
    dir: 'desc',
  });
  const [data, setData] = useState<Page<ContactRow> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .fields('contact')
      .then((result) => setFields(result.fields))
      .catch(() => setFields([]));
  }, []);

  const sourceItems = fields.find((field) => field.code === 'SOURCE_ID')?.items ?? [];
  const customEnumFields = fields.filter((field) => field.isCustom && field.items.length > 0);
  const activeCustomField = customEnumFields.find((field) => field.code === filters.ufCode);

  const params = useMemo(
    () => ({
      q: filters.q.trim(),
      source: filters.source,
      city: filters.city.trim(),
      without_company: withoutCompany ? 1 : '',
      ...(filters.ufCode && filters.ufValue ? { [filters.ufCode]: filters.ufValue } : {}),
      page,
      limit,
      sort: sort.field,
      dir: sort.dir,
    }),
    [filters, withoutCompany, page, limit, sort],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      api
        .contacts(params)
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

  const columns: NonNullable<TableProps<ContactRow>['columns']> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 90, sorter: true, sortOrder: sortOrderFor('id') },
    {
      title: 'Контакт',
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
      render: (value: string | null, row) =>
        value ?? (
          <Text type={row.company_id ? 'secondary' : 'warning'}>
            {row.company_id ? `#${row.company_id} (не выгружена)` : 'без компании'}
          </Text>
        ),
    },
    {
      title: 'Должность',
      dataIndex: 'position',
      key: 'position',
      width: 200,
      ellipsis: true,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: 'Телефоны',
      dataIndex: 'phones',
      key: 'phones',
      width: 180,
      ellipsis: true,
      render: (phones: ContactRow['phones']) => phones.map((phone) => phone.value).join(', ') || '—',
    },
    {
      title: 'Email',
      dataIndex: 'emails',
      key: 'emails',
      width: 180,
      ellipsis: true,
      render: (emails: ContactRow['emails']) => emails.map((email) => email.value).join(', ') || '—',
    },
    {
      title: 'Источник',
      dataIndex: 'source',
      key: 'source',
      width: 150,
      sorter: true,
      sortOrder: sortOrderFor('source'),
      render: (value: string | null) => (value ? <Tag color="blue">{value}</Tag> : '—'),
    },
    {
      title: 'Изменён',
      dataIndex: 'date_modify',
      key: 'date_modify',
      width: 110,
      sorter: true,
      sortOrder: sortOrderFor('date_modify'),
      render: (value: string | null) => fmtDay(value),
    },
  ];

  const onTableChange: TableProps<ContactRow>['onChange'] = (pagination, _filters, sorter, extra) => {
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
          Контакты
        </Title>
        <Text type="secondary">связи с компаниями, должности, телефоны и email</Text>
      </Flex>

      <Card size="small">
        <Space wrap size={12}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Имя, телефон, email, должность…"
            style={{ width: 320 }}
            value={filters.q}
            onChange={(event) => update({ q: event.target.value })}
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

          <Flex align="center" gap={8}>
            <Switch
              checked={withoutCompany}
              onChange={(checked) => {
                setWithoutCompany(checked);
                setPage(1);
              }}
            />
            <Text type="secondary">только без компании</Text>
          </Flex>

          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              setFilters(FILTERS_EMPTY);
              setWithoutCompany(false);
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
        <Table<ContactRow>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={data?.items ?? []}
          onChange={onTableChange}
          scroll={{ x: 1180 }}
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
            onClick: () => navigate(`/contacts/${row.id}`),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>
    </Flex>
  );
}
