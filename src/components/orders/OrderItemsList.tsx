'use client';

import { useState, type CSSProperties } from 'react';
import { formatOrderItems, type OrderItemsInput } from '@/lib/orders/order-items';

const CHARS_PER_ROW = 38;

/**
 * One line per item ("2× Parche Sleeping Melatonina 30u"). Names wrap; each line
 * is clamped to `lineClamp` rows and only the first `maxItems` items show until
 * "+N más" is pressed. The full text is always in the tooltip. Colors and font
 * size inherit from the parent so it fits any card or table.
 *
 * Inside a clickable parent (e.g. a card that is itself a <button>) pass `open`
 * to control expansion from the parent: it then renders spans only and no
 * button of its own.
 */
export default function OrderItemsList({
  order,
  maxItems = 3,
  lineClamp = 2,
  emptyLabel = null,
  open,
  style,
  itemStyle,
  moreColor,
}: {
  order: OrderItemsInput;
  maxItems?: number;
  lineClamp?: number;
  emptyLabel?: string | null;
  /** Controlled expansion; when set the list has no toggle of its own. */
  open?: boolean;
  style?: CSSProperties;
  itemStyle?: CSSProperties;
  moreColor?: string;
}) {
  const [ownExpanded, setOwnExpanded] = useState(false);
  const controlled = open !== undefined;
  const expanded = controlled ? open : ownExpanded;
  const lines = formatOrderItems(order);
  if (lines.length === 0) {
    return emptyLabel ? <span style={style}>{emptyLabel}</span> : null;
  }

  // Several items whose own counts are unknown: still say the order total.
  const unknownCounts = !order.itemLines?.length && lines.length > 1 && lines.every((line) => line.qty === null);
  const totalUnits = unknownCounts && Number(order.quantity) > 0 ? Math.trunc(Number(order.quantity)) : null;
  const totalLabel = totalUnits ? `${totalUnits} u. en total` : null;
  const fullText = [...lines.map((line) => line.label), totalLabel].filter(Boolean).join('\n');
  const visible = expanded ? lines : lines.slice(0, maxItems);
  const hidden = lines.length - visible.length;
  // Phones have no tooltip: offer an expand whenever a name may be clamped.
  const mayClamp = lines.some((line) => line.label.length > CHARS_PER_ROW * lineClamp);
  const canToggle = expanded ? lines.length > maxItems || mayClamp : hidden > 0 || mayClamp;
  const lineStyle: CSSProperties = {
    margin: 0,
    lineHeight: 1.35,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    ...(expanded
      ? { display: 'block' }
      : { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lineClamp, overflow: 'hidden' }),
    ...itemStyle,
  };
  const moreStyle: CSSProperties = { fontWeight: 600, color: moreColor ?? 'inherit' };

  if (controlled) {
    return (
      <span title={fullText} data-order-items={lines.length} style={{ display: 'block', minWidth: 0, ...style }}>
        {visible.map((line, index) => (
          <span key={`${index}-${line.label}`} style={lineStyle}>{line.label}</span>
        ))}
        {hidden > 0 && <span style={{ display: 'block', ...moreStyle }}>+{hidden} más</span>}
        {totalLabel && <span style={{ display: 'block', opacity: 0.75 }}>{totalLabel}</span>}
      </span>
    );
  }

  return (
    <ul
      title={fullText}
      data-order-items={lines.length}
      style={{ listStyle: 'none', margin: 0, padding: 0, minWidth: 0, ...style }}
    >
      {visible.map((line, index) => (
        <li key={`${index}-${line.label}`} style={lineStyle}>{line.label}</li>
      ))}
      {totalLabel && <li style={{ margin: 0, opacity: 0.75 }}>{totalLabel}</li>}
      {canToggle && (
        <li style={{ margin: 0 }}>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setOwnExpanded((prev) => !prev); }}
            aria-expanded={expanded}
            style={{
              ...moreStyle,
              background: 'none',
              border: 'none',
              padding: 0,
              font: 'inherit',
              fontWeight: 600,
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            {expanded ? 'Ver menos' : hidden > 0 ? `+${hidden} más` : 'Ver completo'}
          </button>
        </li>
      )}
    </ul>
  );
}
