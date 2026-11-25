import { Icons } from '../shell/icons';
import { Dropdown, MenuGroup, MenuRow } from './Dropdown';
import { type BoardColumnKey, BOARD_COLUMNS, columnMeta } from './priorityBucket';

// The glass search pill. Full width on a phone (its own row), 460px at md+ (prototype
// `flex: 0 1 460px`); `min-w-0`/`max-w-full` let it shrink inside the wrapping row.
const SEARCH_BOX = 'flex h-[46px] w-full min-w-0 max-w-full items-center gap-2.5 rounded-pill border border-fg/10 [background:var(--x-btn-bg)] px-[18px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] transition-colors [[data-theme=light]_&]:shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] focus-within:border-focus md:w-[460px]';

export interface ToolbarProps {
  query: string;
  setQuery: (s: string) => void;
  hideCompleted: boolean;
  setHideCompleted: (b: boolean) => void;
  colsVisible: Record<BoardColumnKey, boolean>;
  setColsVisible: (r: Record<BoardColumnKey, boolean>) => void;
}

export function Toolbar({ query, setQuery, hideCompleted, setHideCompleted, colsVisible, setColsVisible }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 pb-4 pt-3 md:flex-nowrap md:px-1 md:pb-5 md:pt-0">
      <div className={SEARCH_BOX}>
        <Icons.search size={18} className="shrink-0 text-fg-2" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-2 [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      <div className="flex-1" />
      <div className="flex gap-2">
        <Dropdown icon={<Icons.filter size={16} />} label="Filter">
          <MenuGroup heading="Task status">
            <MenuRow label="Hide completed" checked={hideCompleted} onClick={() => setHideCompleted(!hideCompleted)} />
          </MenuGroup>
        </Dropdown>
        <Dropdown icon={<Icons.columns size={16} />} label="Columns">
          <MenuGroup heading="Show columns">
            {BOARD_COLUMNS.map((k) => {
              const meta = columnMeta(k);
              return (
                <MenuRow
                  key={k}
                  label={meta.label}
                  dotClass={meta.dot}
                  checked={colsVisible[k]}
                  onClick={() => setColsVisible({ ...colsVisible, [k]: !colsVisible[k] })}
                />
              );
            })}
          </MenuGroup>
        </Dropdown>
      </div>
    </div>
  );
}
