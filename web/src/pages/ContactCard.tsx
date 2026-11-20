import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApartmentOutlined, ShareAltOutlined } from '@ant-design/icons';
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
import { fmtDate, fmtDay, isLostStage, isWonStage, money } from '../format';
import type { ContactDetail, ProfileField } from '../types';

const { Title, Text } = Typography;

export default function ContactCard() {
  const { id } = useParams<{ id: string }>();
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyCustom, setOnlyCustom] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setContact(null);
    setError(null);
    api
      .contact(id)
      .then((data) => alive && setContact(data))
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) {
    return <Card><Text type="danger">Не удалось открыть контакт: {error}</Text></Card>;
  }

  if (!contact) return <Card loading />;

  const fields = onlyCustom ? contact.fields.filter((field) => field.isCustom) : contact.fields;
  const totals = contact.deals_total;
  const pipeline = Number(totals.open_sum ?? 0);
  const totalDeals = Number(totals.sum ?? 0);

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
      <Flex justify="space-between" align="flex-start" gap={16} wrap>
        <div>
          <Link to="/contacts" style={{ fontSize: 12 }}>
            ← к списку контактов
          </Link>
          <Title level={3} style={{ margin: '4px 0 8px' }}>
            {contact.title}
          </Title>
          <Space wrap size={6}>
            <Tag>ID {contact.id}</Tag>
            {contact.source ? <Tag color="blue">{contact.source}</Tag> : null}
            {contact.company ? (
              <Tag color="cyan">
                <Link to={`/companies/${contact.company.id}`}>{contact.company.title}</Link>
              </Tag>
            ) : contact.company_id ? (
              <Tag>компания #{contact.company_id} не выгружена</Tag>
            ) : (
              <Tag color="orange">без компании</Tag>
            )}
          </Space>
        </div>

        <Space wrap>
          {contact.company ? (
            <Link to={`/companies/${contact.company.id}`}>
              <Button icon={<ApartmentOutlined />}>Карточка компании</Button>
            </Link>
          ) : null}
          <Link to="/graph">
            <Button icon={<ShareAltOutlined />}>Граф связей</Button>
          </Link>
        </Space>
      </Flex>

      <Row gutter={[12, 12]} align="stretch">
        <Col xs={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic
              title="Сделки"
              value={totals.count}
              suffix={
                <Text type="secondary">
                  открытых: {totals.open} · успешных: {totals.won}
                </Text>
              }
            />
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic
              title="Сумма всех сделок"
              value={totalDeals}
              formatter={() => money(totalDeals, contact.deals[0]?.currency_id)}
            />
            <Text type="secondary">
              в работе: {money(pipeline, contact.deals[0]?.currency_id)}
            </Text>
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic title="Создан" value={fmtDate(contact.date_create)} />
            <Text type="secondary">изменён: {fmtDate(contact.date_modify)}</Text>
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic
              title="Заполнено полей"
              value={contact.fields.length}
              suffix={
                <Text type="secondary">
                  UF: {contact.fields.filter((field) => field.isCustom).length}
                </Text>
              }
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card size="small" title="Контакты для связи" style={{ height: '100%' }}>
            <Descriptions
              column={1}
              size="small"
              items={[
                {
                  key: 'phones',
                  label: 'Телефоны',
                  children: contact.phones.map((phone) => phone.value).join(', ') || '—',
                },
                {
                  key: 'emails',
                  label: 'Email',
                  children: contact.emails.map((email) => email.value).join(', ') || '—',
                },
                {
                  key: 'company',
                  label: 'Компания',
                  children: contact.company ? (
                    <Link to={`/companies/${contact.company.id}`}>{contact.company.title}</Link>
                  ) : contact.company_id ? (
                    <Text type="secondary">#{contact.company_id} (не выгружена)</Text>
                  ) : (
                    '—'
                  ),
                },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} lg={16}>
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
              scroll={{ y: 320 }}
              locale={{ emptyText: 'Нет заполненных полей' }}
            />
          </Card>
        </Col>
      </Row>

      <Card size="small" title={`Сделки (${contact.deals.length})`} styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          scroll={{ x: 860, y: 320 }}
          dataSource={contact.deals}
          locale={{ emptyText: 'Сделок нет' }}
          footer={() =>
            contact.deals_total.count > contact.deals.length
              ? `Показаны последние ${contact.deals.length} из ${contact.deals_total.count} сделок`
              : null
          }
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={2}>
                <Text strong>Итого по всем сделкам</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right">
                <Text strong>{money(totalDeals, contact.deals[0]?.currency_id)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} />
              <Table.Summary.Cell index={4} />
            </Table.Summary.Row>
          )}
          columns={[
            { title: 'Название', dataIndex: 'title', key: 'title' },
            {
              title: 'Стадия',
              dataIndex: 'stage',
              key: 'stage',
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
              render: (value: number | null, row) => money(value, row.currency_id),
            },
            { title: 'Создана', dataIndex: 'date_create', key: 'date_create', width: 110, render: (v) => fmtDay(v) },
            { title: 'Изменена', dataIndex: 'date_modify', key: 'date_modify', width: 110, render: (v) => fmtDate(v) },
          ]}
        />
      </Card>

      <SimilarBlock entity="contact" id={id} label="Похожие контакты" />
    </Flex>
  );
}
