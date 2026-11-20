import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApartmentOutlined, TeamOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Row,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import { api } from '../api';
import SimilarBlock from '../components/SimilarBlock';
import { fmtDate, isLostStage, isWonStage, money } from '../format';
import type { DealDetail, DealProductRow, ProfileField } from '../types';

const { Title, Text } = Typography;

export default function DealCard() {
  const { id } = useParams<{ id: string }>();
  const [deal, setDeal] = useState<DealDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyCustom, setOnlyCustom] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setDeal(null);
    setError(null);
    api
      .deal(id)
      .then((data) => alive && setDeal(data))
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) return <Card><Text type="danger">Не удалось открыть сделку: {error}</Text></Card>;
  if (!deal) return <Card loading />;

  const fields = onlyCustom ? deal.fields.filter((field) => field.isCustom) : deal.fields;

  const fieldColumns: NonNullable<TableProps<ProfileField>['columns']> = [
    {
      title: 'Поле',
      dataIndex: 'label',
      key: 'label',
      width: '40%',
      render: (_value, field) => (
        <Space direction="vertical" size={0}>
          <Text>{field.label}</Text>
          <Text type="secondary" className="mono">
            {field.code}
          </Text>
        </Space>
      ),
    },
    { title: 'Значение', dataIndex: 'value', key: 'value' },
    {
      title: '',
      dataIndex: 'isCustom',
      key: 'isCustom',
      width: 60,
      render: (value: boolean) => (value ? <Tag color="geekblue">UF</Tag> : null),
    },
  ];

  return (
    <Flex vertical gap={16}>
      <div>
        <Link to="/deals" style={{ fontSize: 12 }}>
          ← к списку сделок
        </Link>
        <Title level={3} style={{ margin: '4px 0 8px' }}>
          {deal.title}
        </Title>
        <Space wrap size={6}>
          <Tag>ID {deal.id}</Tag>
          {deal.stage ? (
            <Tag color={isWonStage(deal.stage) ? 'success' : isLostStage(deal.stage) ? 'error' : 'processing'}>
              {deal.stage}
            </Tag>
          ) : null}
          <Tag>{money(deal.opportunity, deal.currency_id)}</Tag>
        </Space>
      </div>

      <Row gutter={[12, 12]} align="stretch">
        <Col xs={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic
              title="Сумма"
              value={deal.opportunity ?? 0}
              formatter={() => money(deal.opportunity, deal.currency_id)}
            />
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic title="Создана" value={fmtDate(deal.date_create)} />
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic title="Изменена" value={fmtDate(deal.date_modify)} />
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic
              title="Заполнено полей"
              value={deal.fields.length}
              suffix={
                <Text type="secondary">
                  UF: {deal.fields.filter((field) => field.isCustom).length}
                </Text>
              }
            />
          </Card>
        </Col>
      </Row>

      {deal.products?.length ? (
        <Card
          size="small"
          title={`Товары в сделке (${deal.products_total.lines})`}
          extra={
            <Space size={12} wrap>
              <Text type="secondary">
                Количество: {Number(deal.products_total.qty ?? 0).toLocaleString('ru-RU')}
              </Text>
              {deal.products_total.discount ? (
                <Text type="secondary">Скидки: {money(deal.products_total.discount, deal.currency_id)}</Text>
              ) : null}
              <Text strong>Итого: {money(deal.products_total.sum, deal.currency_id)}</Text>
            </Space>
          }
        >
          <Table<DealProductRow>
            rowKey={(row, index) => `${row.id ?? 'x'}-${index}`}
            size="small"
            pagination={false}
            scroll={{ y: 360 }}
            dataSource={deal.products}
            columns={[
              {
                title: 'Товар',
                dataIndex: 'name',
                render: (value: string | null, row) =>
                  row.in_catalog && row.id ? (
                    <Link to={`/products/${row.id}`}>{value}</Link>
                  ) : (
                    <Space size={4}>
                      <Text>{value}</Text>
                      <Tag>нет в каталоге</Tag>
                    </Space>
                  ),
              },
              {
                title: 'Раздел',
                dataIndex: 'section_name',
                width: 200,
                render: (value: string | null) => value || '—',
              },
              {
                title: 'Кол-во',
                dataIndex: 'quantity',
                align: 'right',
                width: 100,
                render: (value: number, row) =>
                  `${Number(value).toLocaleString('ru-RU')}${row.measure_name ? ` ${row.measure_name}` : ''}`,
              },
              {
                title: 'Цена',
                dataIndex: 'price',
                align: 'right',
                width: 120,
                render: (value: number) => money(value, deal.currency_id),
              },
              {
                title: 'Сумма',
                dataIndex: 'revenue',
                align: 'right',
                width: 140,
                render: (value: number) => <Text strong>{money(value, deal.currency_id)}</Text>,
              },
            ]}
          />
        </Card>
      ) : null}

      <Flex gap={8} wrap>
        {deal.company_id ? (
          <Link to={`/companies/${deal.company_id}`}>
            <Button icon={<ApartmentOutlined />}>
              {deal.company_id ? `Компания #${deal.company_id}` : 'Компания'}
            </Button>
          </Link>
        ) : null}
        {deal.contact_id ? (
          <Link to={`/contacts/${deal.contact_id}`}>
            <Button icon={<TeamOutlined />}>Контакт #{deal.contact_id}</Button>
          </Link>
        ) : null}
      </Flex>

      <Card
        size="small"
        title={`Поля карточки (${fields.length})`}
        extra={
          <Space>
            <Text type="secondary">только UF_*</Text>
            <Switch size="small" checked={onlyCustom} onChange={setOnlyCustom} />
          </Space>
        }
      >
        <Table<ProfileField>
          rowKey="code"
          size="small"
          columns={fieldColumns}
          dataSource={fields}
          pagination={false}
          scroll={{ y: 420 }}
          locale={{ emptyText: 'Нет заполненных полей' }}
        />
      </Card>

      <Card size="small" title="Технические данные">
        <Descriptions
          column={{ xs: 1, md: 2 }}
          size="small"
          items={[
            { key: 'id', label: 'ID', children: deal.id },
            { key: 'category', label: 'Воронка (CATEGORY_ID)', children: deal.category_id ?? '—' },
            { key: 'stage_id', label: 'STAGE_ID', children: deal.stage_id ?? '—' },
            { key: 'currency', label: 'Валюта', children: deal.currency_id ?? '—' },
          ]}
        />
      </Card>

      <SimilarBlock entity="deal" id={id} label="Похожие сделки" />
    </Flex>
  );
}
