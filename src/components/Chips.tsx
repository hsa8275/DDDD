type Props = {
  items: string[];
  onPick: (text: string) => void;
};

export default function Chips({ items, onPick }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onPick(t)}
          className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-rose-400/40 hover:bg-rose-500/10"
        >
          + {t}
        </button>
      ))}
    </div>
  );
}
