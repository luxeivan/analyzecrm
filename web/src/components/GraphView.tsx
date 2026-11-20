import { useEffect, useRef, useState } from 'react';
import { theme as antdTheme } from 'antd';
import ForceGraph2D from 'react-force-graph-2d';
import type { GraphData } from '../types';

export const GRAPH_COLORS: Record<string, string> = {
  company: '#1677ff',
  contact: '#722ed1',
  deal: '#faad14',
  lead: '#52c41a',
};

const RADIUS: Record<string, number> = {
  company: 7,
  contact: 4,
  deal: 5,
  lead: 5,
};

export default function GraphView({ data, height = '72vh' }: { data: GraphData; height?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const { token } = antdTheme.useToken();

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver(() => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        height,
        overflow: 'hidden',
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      <ForceGraph2D
        graphData={data as never}
        width={size.width}
        height={size.height}
        backgroundColor={token.colorBgContainer}
        nodeRelSize={6}
        nodeLabel={(node: { label?: string; type?: string }) =>
          `${node.label ?? ''} · ${node.type ?? ''}`
        }
        linkLabel={(link: { label?: string }) => link.label ?? ''}
        linkColor={() => token.colorTextQuaternary}
        linkWidth={1}
        linkDirectionalArrowLength={3.5}
        linkDirectionalArrowRelPos={1}
        cooldownTicks={120}
        nodeCanvasObject={(
          node: Record<string, unknown>,
          ctx: CanvasRenderingContext2D,
          scale: number,
        ) => {
          const type = String(node.type ?? 'contact');
          const radius = (RADIUS[type] ?? 4) * (type === 'company' && node.size ? 1.4 : 1);
          const x = Number(node.x ?? 0);
          const y = Number(node.y ?? 0);

          ctx.beginPath();
          ctx.arc(x, y, radius, 0, 2 * Math.PI);
          ctx.fillStyle = GRAPH_COLORS[type] ?? token.colorTextSecondary;
          ctx.fill();

          if (scale > 1.1) {
            const label = String(node.label ?? '');
            ctx.font = `${11 / scale}px system-ui, sans-serif`;
            ctx.fillStyle = token.colorTextSecondary;
            ctx.fillText(label.length > 34 ? `${label.slice(0, 33)}…` : label, x + radius + 2, y + 3);
          }
        }}
      />
    </div>
  );
}
