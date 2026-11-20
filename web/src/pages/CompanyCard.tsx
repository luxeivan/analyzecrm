import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CopyOutlined, ShareAltOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Collapse,
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
import type { CompanyDetail, ProfileField } from '../types';

const { Title, Text } = Typography;

export default function CompanyCard() {
  const { id } = useParams<{ id: string }>();
  const { message } = AntdApp.useApp();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyCustom, setOnlyCustom] = useState(false);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setCompany(null);
    setSummary(null);
    setError(null);
    api
      .company(id)
      .then((data) => alive && setCompany(data))
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) {
    return <Card><Text type="danger">Не удалось открыть карточку: {error}</Text></Card>;
  }

  if (!company) return <Card loading />;

  const fields = onlyCustom ? company.fields.filter((field) => field.isCustom) : company.fields;
  const totals = company.deals_total;
  const pipeline = Number(totals.open_sum ?? 0);
  const totalDeals = Number(totals.sum ?? 0);

  const loadSummary = async () => {
    setSummaryLoading(true);
    try {
      setSummary(await api.aiSummary(company.id));
    } catch (err) {
      message.error(`Не удалось собрать выжимку: ${(err as Error).message}`);
    } finally {
      setSummaryLoading(false);
    }
  };

  const copySummary = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
      message.success('JSON скопирован');
    } catch {
      message.error('Не удалось скопировать');
    }
  };

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
          <Link to="/companies" style={{ fontSize: 12 }}>
            ← к списку компаний
          </Link>
          <Title level={3} style={{ margin: '4px 0 8px' }}>
            {company.title}
          </Title>
          <Space wrap size={6}>
            <Tag>ID {company.id}</Tag>
            {company.industry ? <Tag color="purple">{company.industry}</Tag> : null}
            {company.source ? <Tag color="blue">{company.source}</Tag> : null}
            {company.city ? <Tag>{company.city}</Tag> : null}
            {company.region ? <Tag>{company.region}</Tag> : null}
          </Space>
        </div>

        <Space wrap>
          <Link to={`/graph/${company.id}`}>
            <Button icon={<ShareAltOutlined />}>Граф связей</Button>
          </Link>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={summaryLoading}
            onClick={loadSummary}
          >
            JSON для LLM
          </Button>
        </Space>
      </Flex>

      <Row gutter={[12, 12]} align="stretch">
        <Col xs={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic title="Контакты" value={company.contacts.length} />
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic
              title="Сделки"
              value={totals.count}
              suffix={<Text type="secondary">успешных: {totals.won}</Text>}
            />
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic
              title="Сумма всех сделок"
              value={totalDeals}
              formatter={() => money(totalDeals, company.deals[0]?.currency_id)}
            />
            <Text type="secondary">
              в работе: {money(pipeline, company.deals[0]?.currency_id)}
            </Text>
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic title="Последнее изменение" value={fmtDate(company.date_modify)} />
            <Text type="secondary">выгружено: {fmtDate(company.synced_at)}</Text>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card size="small" title="Реквизиты" style={{ height: '100%' }}>
            <Descriptions
              column={1}
              size="small"
              items={[
                {
                  key: 'phones',
                  label: 'Телефоны',
                  children: company.phones.map((phone) => phone.value).join(', ') || '—',
                },
                {
                  key: 'emails',
                  label: 'Email',
                  children: company.emails.map((email) => email.value).join(', ') || '—',
                },
                { key: 'created', label: 'Создана', children: fmtDate(company.date_create) },
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

      <Card size="small" title={`Контакты (${company.contacts.length})`} styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          scroll={{ x: 860, y: 360 }}
          dataSource={company.contacts}
          locale={{ emptyText: 'Контакты не привязаны' }}
          columns={[
            {
              title: 'Имя',
              dataIndex: 'title',
              key: 'title',
              render: (value: string, row) => <Link to={`/contacts/${row.id}`}>{value}</Link>,
            },
            { title: 'Должность', dataIndex: 'position', key: 'position', render: (v) => v ?? '—' },
            {
              title: 'Телефоны',
              dataIndex: 'phones',
              key: 'phones',
              render: (phones) => phones.map((phone: { value: string }) => phone.value).join(', ') || '—',
            },
            {
              title: 'Email',
              dataIndex: 'emails',
              key: 'emails',
              render: (emails) => emails.map((email: { value: string }) => email.value).join(', ') || '—',
            },
            { title: 'Источник', dataIndex: 'source', key: 'source', render: (v) => v ?? '—' },
            { title: 'Изменён', dataIndex: 'date_modify', key: 'date_modify', render: (v) => fmtDate(v) },
          ]}
        />
      </Card>

      <Card size="small" title={`Сделки (${company.deals.length})`} styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          scroll={{ x: 860, y: 320 }}
          dataSource={company.deals}
          locale={{ emptyText: 'Сделок нет' }}
          footer={() =>
            company.deals_total.count > company.deals.length
              ? `Показаны последние ${company.deals.length} из ${company.deals_total.count} сделок`
              : null
          }
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={2}>
                <Text strong>Итого по всем сделкам</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right">
                <Text strong>{money(totalDeals, company.deals[0]?.currency_id)}</Text>
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

      {summary ? (
        <Card
          size="small"
          title="JSON для локальной LLM"
          extra={
            <Button icon={<CopyOutlined />} onClick={copySummary}>
              Копировать
            </Button>
          }
        >
          <Collapse
            size="small"
            items={[
              {
                key: 'json',
                label: 'Показать / свернуть',
                children: <pre className="json-preview">{JSON.stringify(summary, null, 2)}</pre>,
              },
            ]}
          />
        </Card>
      ) : null}

      <SimilarBlock entity="company" id={id} label="Похожие компании" />
    </Flex>
  );
}
