export function Logo() {
  return (
    <div className="flex items-center gap-[9px]">
      <div className="grid grid-cols-2 gap-[3px]">
        <span className="h-[11px] w-[11px] rounded-full bg-[#f4b8c2]" />
        <span className="h-[11px] w-[11px] rounded-[3px] bg-[#6ee0c8]" />
        <span className="h-[11px] w-[11px] rounded-[3px] bg-[#7c87ff]" />
        <span className="h-[11px] w-[11px] rounded-full bg-[#ffd166]" />
      </div>
      <div className="text-[20px] font-extrabold leading-none tracking-[-.4px] text-white">
        notreclaim<span className="text-[#8b8fff]">.app</span>
      </div>
    </div>
  );
}
