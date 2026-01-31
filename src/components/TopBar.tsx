type Props = {
  status: "READY" | "PROCESSING" | "DONE" | string;
  tagline: string;
};

export default function TopBar({ status, tagline }: Props) {
  const badge =
    status === "PROCESSING"
      ? "bg-rose-500/15 text-rose-200 border-rose-500/25"
      : "bg-emerald-400/10 text-emerald-200 border-emerald-400/20";

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-black/60 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-rose-500/90 to-rose-400/70 text-white shadow-[0_10px_30px_rgba(244,63,94,0.18)]">
            🎧
          </div>
          <div className="leading-tight">
            <div className="text-sm font-extrabold tracking-tight text-zinc-100">ToneShift</div>
            <div className="text-[11px] text-zinc-400">Agent Console</div>
          </div>
        </div>

        <div className="hidden text-center text-sm font-semibold text-zinc-200 md:block">
          {tagline}
        </div>

        <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${badge}`}>
          {status}
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 pb-3 md:hidden">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-xs font-semibold text-zinc-200 backdrop-blur">
          {tagline}
        </div>
      </div>
    </header>
  );
}
