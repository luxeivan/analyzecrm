import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RobotOutlined, SendOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Flex, Input, List, Space, Tag, Typography } from 'antd';
import { api } from '../api';
import Markdown from '../components/Markdown';
import type { AiAskResult, AiAskSource } from '../types';

const { Text, Title } = Typography;

const PATHS: Record<AiAskSource['entity'], string> = {
  company: '/companies',
  deal: '/deals',
  lead: '/leads',
};

const LABELS: Record<AiAskSource['entity'], string> = {
  company: 'Компания',
  deal: 'Сделка',
  lead: 'Лид',
};

const EXAMPLES = [
  'Какие клиенты покупают верстаки и где они находятся?',
  'Что чаще всего заказывают компании из Москвы?',
  'Есть ли сделки на монтаж оборудования и на какие суммы?',
  'Какие лиды похожи на наших крупных клиентов?',
];

/** RAG-ассистент: вопрос → поиск по векторам → ответ LLM со ссылками на записи. */
export default function AssistantPage() {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AiAskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async (value = question) => {
    const text = value.trim();
    if (text.length < 3) return;
    setQuestion(text);
    setLoading(true);
    setError(null);
    try {
      const answer = await api.aiAsk(text);
      setResult(answer);
      if (!answer.configured && answer.hint) {
        setError(answer.hint);
      }
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const usage = result?.usage;

  return (
    <Flex vertical gap={16}>
      <div>
        <Title level={4} style={{ margin: 0 }}>
          <RobotOutlined /> Ассистент по CRM
        </Title>
        <Text type="secondary">
          Вопрос на русском → поиск релевантных карточек через pgvector → ответ LLM со ссылками на записи.
        </Text>
      </div>

      <Card size="small">
        <Flex vertical gap={12}>
          <Input.TextArea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onPressEnter={(event) => {
              if (!event.shiftKey) {
                event.preventDefault();
                ask();
              }
            }}
            autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder="Спросите что-нибудь про клиентов, сделки или лиды…"
          />
          <Flex justify="space-between" align="center" wrap gap={8}>
            <Space wrap size={[8, 8]}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Примеры:
              </Text>
              {EXAMPLES.map((example) => (
                <Tag key={example} style={{ cursor: 'pointer' }} onClick={() => ask(example)}>
                  {example}
                </Tag>
              ))}
            </Space>
            <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={() => ask()}>
              Спросить
            </Button>
          </Flex>
        </Flex>
      </Card>

      {error ? <Alert type="warning" showIcon message={error} /> : null}

      {result?.configured && result.answer ? (
        <Card
          size="small"
          title="Ответ"
          extra={
            <Text type="secondary" style={{ fontSize: 12 }}>
              {result.provider} · {result.model}
              {usage?.totalTokens ? ` · ${usage.totalTokens} ток.` : ''}
              {usage?.costRub ? ` · ${usage.costRub.toFixed(4)} ₽` : ''}
            </Text>
          }
        >
          <Markdown text={result.answer} />

          {result.sources?.length ? (
            <Card size="small" type="inner" title="На чём основан ответ" style={{ marginTop: 16 }}>
              <List
                size="small"
                dataSource={result.sources}
                renderItem={(source) => (
                  <List.Item
                    extra={<Tag>{(source.score * 100).toFixed(0)}%</Tag>}
                  >
                    <Space size={8}>
                      <Tag color={source.entity === 'company' ? 'blue' : source.entity === 'deal' ? 'gold' : 'green'}>
                        {LABELS[source.entity]}
                      </Tag>
                      <Link to={`${PATHS[source.entity]}/${source.id}`}>
                        {source.title || `#${source.id}`}
                      </Link>
                    </Space>
                  </List.Item>
                )}
              />
            </Card>
          ) : null}
        </Card>
      ) : null}
    </Flex>
  );
}
