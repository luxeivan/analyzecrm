import { Fragment, type ReactNode } from 'react';
import { Typography } from 'antd';

const { Text } = Typography;

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;

function inline(source: string, keyPrefix: string): ReactNode[] {
  return source
    .split(INLINE)
    .filter((part) => part !== '')
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`;
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <Text code key={key}>
            {part.slice(1, -1)}
          </Text>
        );
      }
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        return <em key={key}>{part.slice(1, -1)}</em>;
      }
      return <Fragment key={key}>{part}</Fragment>;
    });
}

/**
 * Минимальный рендер markdown для ответов LLM: списки, жирный/курсив, `code`,
 * заголовки и абзацы. Без внешних зависимостей — модель отвечает простым списком.
 */
export default function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let ordered = false;

  const flush = () => {
    if (!list.length) return;
    const items = list;
    list = [];
    blocks.push(
      ordered ? (
        <ol key={`list-${blocks.length}`} style={{ margin: '0 0 10px', paddingLeft: 22 }}>
          {items.map((item, index) => (
            <li key={`${blocks.length}-${index}`} style={{ marginBottom: 4 }}>
              {inline(item, `li-${blocks.length}-${index}`)}
            </li>
          ))}
        </ol>
      ) : (
        <ul key={`list-${blocks.length}`} style={{ margin: '0 0 10px', paddingLeft: 22 }}>
          {items.map((item, index) => (
            <li key={`${blocks.length}-${index}`} style={{ marginBottom: 4 }}>
              {inline(item, `li-${blocks.length}-${index}`)}
            </li>
          ))}
        </ul>
      ),
    );
  };

  text
    .replace(/\r/g, '')
    .split('\n')
    .forEach((raw, index) => {
      const line = raw.trimEnd();
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);

      if (bullet) {
        if (ordered) flush();
        ordered = false;
        list.push(bullet[1]);
        return;
      }
      if (numbered) {
        if (!ordered) flush();
        ordered = true;
        list.push(numbered[1]);
        return;
      }

      flush();

      if (!line.trim()) return;
      if (/^```/.test(line.trim())) return;

      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        blocks.push(
          <div
            key={`h-${index}`}
            style={{ fontWeight: 600, fontSize: heading[1].length <= 2 ? 16 : 14.5, margin: '0 0 6px' }}
          >
            {inline(heading[2], `h-${index}`)}
          </div>,
        );
        return;
      }

      blocks.push(
        <p key={`p-${index}`} style={{ margin: '0 0 8px' }}>
          {inline(line, `p-${index}`)}
        </p>,
      );
    });

  flush();

  return <div style={{ fontSize: 14, lineHeight: 1.7 }}>{blocks}</div>;
}
