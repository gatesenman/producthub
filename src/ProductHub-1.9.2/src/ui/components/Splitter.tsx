import React from 'react';
type RS = { onMouseDown: (e: React.MouseEvent) => void; reset?: () => void; onKeyDown?: (e: React.KeyboardEvent) => void; width?: number; min?: number; max?: number };
/** 可拖拽分隔条：悬停显示抓手，双击复位，可 Tab 聚焦后用 ←/→ 调整（role=separator） */
export function Splitter({ onMouseDown, testId, rs }: { onMouseDown?: (e: React.MouseEvent) => void; testId?: string; rs?: RS }) {
  const md = rs?.onMouseDown || onMouseDown!;
  return <div data-testid={testId} onMouseDown={md} onDoubleClick={rs?.reset} onKeyDown={rs?.onKeyDown} tabIndex={rs ? 0 : undefined} role="separator" aria-orientation="vertical" aria-label="调整面板宽度"
    aria-valuenow={rs?.width} aria-valuemin={rs?.min} aria-valuemax={rs?.max} title="拖动调整宽度 · 双击复位"
    className="group relative z-20 w-px shrink-0 cursor-col-resize bg-border outline-none focus-visible:bg-ring">
    <div className="absolute inset-y-0 -left-[3px] -right-[3px] transition-colors duration-fast group-hover:bg-brand/30 group-active:bg-brand/50 group-focus-visible:bg-brand/40" />
    <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-8 w-1.5 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-full border bg-background opacity-0 shadow-sm transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden>
      {[0, 1, 2].map(i => <span key={i} className="h-0.5 w-0.5 rounded-full bg-muted-foreground" />)}</div></div>;
}
