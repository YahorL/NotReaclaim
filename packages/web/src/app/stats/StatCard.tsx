export function StatCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div data-testid="stat-card" className="flex-1 rounded-[14px] border border-line bg-card p-5 shadow-card">
      <div className="text-[14.5px] font-bold text-inkSoft">{label}</div>
      <div className={`mt-1.5 text-[36px] font-extrabold leading-none ${accent}`}>{value}</div>
      <div className="mt-1 text-[14px] text-inkSoft">{sub}</div>
    </div>
  );
}
