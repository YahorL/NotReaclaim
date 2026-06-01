import { Icons } from '../shell/icons';

export function StatsPlaceholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3.5 text-[#aeb2c0]">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-card">
        <Icons.stats size={30} className="text-[#cfd2dd]" />
      </div>
      <div className="text-[19px] font-bold text-inkSoft">Stats</div>
      <div className="text-[15px]">Coming soon.</div>
    </div>
  );
}
