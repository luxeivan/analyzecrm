import { useId } from 'react';

interface LogoProps {
  /** Сторона квадрата в пикселях. */
  size?: number;
  /** Скругление углов плитки (по умолчанию пропорционально размеру). */
  radius?: number;
  style?: React.CSSProperties;
}

/**
 * Логотип «CRM Analyzer»: плитка с растущими столбцами данных и точкой роста.
 * Рисуется инлайновым SVG, поэтому одинаково чёткий в шапке, на логине и в favicon.
 */
export default function Logo({ size = 30, radius, style }: LogoProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const bgId = `logo-bg-${uid}`;
  const glowId = `logo-glow-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="CRM Analyzer"
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4096ff" />
          <stop offset="55%" stopColor="#1677ff" />
          <stop offset="100%" stopColor="#0b4bc4" />
        </linearGradient>
        <radialGradient id={glowId} cx="0.25" cy="0.15" r="0.9">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="32" height="32" rx={radius ?? 8.5} fill={`url(#${bgId})`} />
      <rect width="32" height="32" rx={radius ?? 8.5} fill={`url(#${glowId})`} />

      {/* столбцы данных */}
      <rect x="7" y="19.2" width="4.2" height="6.2" rx="1.6" fill="#ffffff" fillOpacity="0.8" />
      <rect x="13.9" y="14.6" width="4.2" height="10.8" rx="1.6" fill="#ffffff" fillOpacity="0.92" />
      <rect x="20.8" y="9.6" width="4.2" height="15.8" rx="1.6" fill="#ffffff" />

      {/* точка роста */}
      <circle cx="22.9" cy="6.4" r="2.2" fill="#95de64" />
    </svg>
  );
}
