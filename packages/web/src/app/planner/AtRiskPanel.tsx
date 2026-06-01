import type { UnscheduledItem } from '../../api/types';
import { humanizeMs } from './weekModel';

export function AtRiskPanel({ items }: { items: UnscheduledItem[] }) {
  return (
    <aside className="w-44 shrink-0 rounded-xl border border-line bg-card p-3 text-xs shadow-card">
      <h3 className="mb-2 font-semibold text-ink">⚠ At-risk ({items.length})</h3>
      {items.length === 0 ? (
        <p className="text-inkSoft">Nothing at risk.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={`${it.sourceType}:${it.sourceId}`}
              data-testid="at-risk-item"
              className="rounded border-l-2 border-crit bg-crit/10 px-2 py-1"
            >
              <div className="font-medium text-ink">{it.title}</div>
              <div className="text-[11px] text-crit">{it.reason}</div>
              <div className="text-[11px] text-inkSoft">{humanizeMs(it.remainingMs)} unplaced</div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
