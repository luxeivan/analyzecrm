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
import { fmtDate, money } from '../format';
import type { LeadDetail, ProfileField } from '../types';

const { Title, Text } = Typography;

export default function LeadCard() {
  const { id } = useParams<{ id: string }>();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyCustom, setOnlyCustom] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLead(null);
    setError(null);
    api
      .lead(id)
      .then((data) => alive && setLead(data))
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) return <Card><Text type="danger">Не удалось открыть лид: {error}</Text></Card>;
  if (!lead) return <Card loading />;

  const fields = onlyCustom ? lead.fields.filter((field) => field.isCustom) : lead.fields;

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
        <Link to="/leads" style={{ fontSize: 12 }}>
          ← к списку лидов
        </Link>
        <Title level={3} style={{ margin: '4px 0 8px' }}>
          {lead.title}
        </Title>
        <Space wrap size={6}>
          <Tag>ID {lead.id}</Tag>
          {lead.status ? <Tag color="blue">{lead.status}</Tag> : null}
          {lead.source ? <Tag>{lead.source}</Tag> : null}
          <Tag>{money(lead.opportunity, lead.currency_id)}</Tag>
        </Space>
      </div>

      <Row gutter={[12, 12]} align="stretch">
        <Col xs={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic
              title="Сумма"
              value={lead.opportunity ?? 0}
              formatter={() => money(lead.opportunity, lead.currency_id)}
            />
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic title="Создан" value={fmtDate(lead.date_create)} />
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic title="Изменён" value={fmtDate(lead.date_modify)} />
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic
              title="Заполнено полей"
              value={lead.fields.length}
              suffix={
                <Text type="secondary">
                  UF: {lead.fields.filter((field) => field.isCustom).length}
                </Text>
              }
            />
          </Card>
        </Col>
      </Row>

      <Flex gap={8} wrap>
        {lead.company ? (
          <Link to={`/companies/${lead.company.id}`}>
            <Button icon={<ApartmentOutlined />}>{lead.company.title}</Button>
          </Link>
        ) : lead.company_id ? (
          <Tag>компания #{lead.company_id} не выгружена</Tag>
        ) : null}
        {lead.contact ? (
          <Link to={`/contacts/${lead.contact.id}`}>
            <Button icon={<TeamOutlined />}>{lead.contact.title}</Button>
          </Link>
        ) : lead.contact_id ? (
          <Tag>контакт #{lead.contact_id} не выгружен</Tag>
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
            { key: 'id', label: 'ID', children: lead.id },
            { key: 'status_id', label: 'STATUS_ID', children: lead.status_id ?? '—' },
            { key: 'source_id', label: 'SOURCE_ID', children: lead.source_id ?? '—' },
            { key: 'currency', label: 'Валюта', children: lead.currency_id ?? '—' },
          ]}
        />
      </Card>

      <SimilarBlock entity="lead" id={id} label="Похожие лиды" />
    </Flex>
  );
}
