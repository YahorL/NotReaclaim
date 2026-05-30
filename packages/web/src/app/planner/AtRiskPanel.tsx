import type { UnscheduledItem } from '../../api/types';
import { humanizeMs } from './weekModel';

export function AtRiskPanel({ items }: { items: UnscheduledItem[] }) {
  return (
    <aside className="w-44 shrink-0 rounded-lg border border-gray-200 p-3 text-xs">
      <h3 className="mb-2 font-semibold">⚠ At-risk ({items.length})</h3>
      {items.length === 0 ? (
        <p className="text-gray-500">Nothing at risk.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={`${it.sourceType}:${it.sourceId}`}
              data-testid="at-risk-item"
              className="rounded border-l-2 border-red-500 bg-red-50 px-2 py-1"
            >
              <div className="font-medium">{it.title}</div>
              <div className="text-[11px] text-red-700">{it.reason}</div>
              <div className="text-[11px] text-gray-500">{humanizeMs(it.remainingMs)} unplaced</div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
