import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, List, Progress, Space, Tag, Typography } from 'antd';
import { api } from '../api';
import type { SearchEntity, SemanticItem } from '../types';

const { Text } = Typography;

const PATHS: Record<SearchEntity, string> = {
  company: '/companies',
  contact: '/contacts',
  deal: '/deals',
  lead: '/leads',
};

interface Props {
  entity: SearchEntity;
  id?: string | number;
  label?: string;
  limit?: number;
}

/** Ближайшие соседи записи по эмбеддингу (pgvector). Молча скрывается, если вектора нет. */
export default function SimilarBlock({ entity, id, label = 'Похожие', limit = 6 }: Props) {
  const [items, setItems] = useState<SemanticItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setItems(null);
    setFailed(false);

    api
      .similar(entity, id, limit)
      .then((result) => {
        if (alive) setItems(result.items);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });

    return () => {
      alive = false;
    };
  }, [entity, id, limit]);

  if (failed || items === null || items.length === 0) return null;

  return (
    <Card size="small" title={label}>
      <List
        size="small"
        dataSource={items}
        renderItem={(item) => (
          <List.Item
            extra={
              <Tag color={item.score > 0.9 ? 'success' : item.score > 0.85 ? 'blue' : 'default'}>
                {(item.score * 100).toFixed(0)}%
              </Tag>
            }
          >
            <Space direction="vertical" size={0} style={{ width: '100%' }}>
              <Link to={`${PATHS[entity]}/${item.id}`}>
                <Text ellipsis style={{ maxWidth: 420 }}>
                  {item.title || `#${item.id}`}
                </Text>
              </Link>
              <Progress
                percent={Math.round(item.score * 100)}
                showInfo={false}
                size="small"
                style={{ maxWidth: 220 }}
              />
            </Space>
          </List.Item>
        )}
      />
    </Card>
  );
}
