import { useState } from 'react';

export function QuickAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => void }) {
  const [value, setValue] = useState('');
  const submit = () => {
    const title = value.trim();
    if (!title) return;
    onAdd(title);
    setValue('');
  };
  return (
    <div className="mb-2 flex gap-2">
      <input
        className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
      <button onClick={submit} className="rounded bg-blue-600 px-3 py-1 text-sm text-white">Add</button>
    </div>
  );
}
