import { Icons } from '../shell/icons';
import { Dropdown, MenuRow } from './Dropdown';
import { type BucketKey, BUCKETS, BUCKET_META } from './priorityBucket';

export interface ToolbarProps {
  query: string;
  setQuery: (s: string) => void;
  hideCompleted: boolean;
  setHideCompleted: (b: boolean) => void;
  colsVisible: Record<BucketKey, boolean>;
  setColsVisible: (r: Record<BucketKey, boolean>) => void;
}

export function Toolbar({ query, setQuery, hideCompleted, setHideCompleted, colsVisible, setColsVisible }: ToolbarProps) {
  return (
    <div className="flex items-center gap-3 pb-[18px] pl-[30px] pr-[26px] pt-1.5">
      <div className="flex h-12 w-[430px] items-center gap-2.5 rounded-[30px] border border-line bg-card px-5 shadow-card">
        <Icons.search size={20} className="text-inkSoft" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search for something…" aria-label="Search tasks" className="flex-1 bg-transparent text-[16px] text-ink outline-none" />
      </div>
      <div className="flex-1" />
      <Dropdown icon={<Icons.filter size={18} />} label="Filter">
        <div className="px-3.5 pb-1 pt-2 text-[12.5px] font-extrabold uppercase tracking-wide text-inkSoft">Task status</div>
        <MenuRow label="Hide completed" checked={hideCompleted} onClick={() => setHideCompleted(!hideCompleted)} />
      </Dropdown>
      <Dropdown icon={<Icons.columns size={18} />} label="Columns">
        <div className="px-3.5 pb-1 pt-2 text-[12.5px] font-extrabold uppercase tracking-wide text-inkSoft">Show columns</div>
        {BUCKETS.map((b) => (
          <MenuRow key={b} label={BUCKET_META[b].label} dotClass={BUCKET_META[b].dot} checked={colsVisible[b]} onClick={() => setColsVisible({ ...colsVisible, [b]: !colsVisible[b] })} />
        ))}
      </Dropdown>
      <Dropdown icon={<Icons.help size={18} />} label="Help" width={220}>
        <MenuRow label="Keyboard shortcuts (Soon)" />
        <MenuRow label="Watch a tutorial (Soon)" />
        <MenuRow label="Contact support (Soon)" />
      </Dropdown>
    </div>
  );
}
