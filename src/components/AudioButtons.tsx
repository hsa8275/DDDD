type Props = {
  leftLabel: string;
  leftHint?: string;
  leftDisabled?: boolean;
  onLeftPlay: () => void;
  onLeftStop: () => void;

  rightLabel: string;
  rightHint?: string;
  rightDisabled?: boolean;
  onRightPlay: () => void;
  onRightStop: () => void;
  isRightPlaying?: boolean;
};

export default function AudioButtons({
  leftLabel,
  leftHint,
  leftDisabled,
  onLeftPlay,
  onLeftStop,
  rightLabel,
  rightHint,
  rightDisabled,
  onRightPlay,
  onRightStop,
  isRightPlaying,
}: Props) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-zinc-100">{leftLabel}</div>
          {leftHint && <div className="text-[11px] text-zinc-500">{leftHint}</div>}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onLeftPlay}
            disabled={!!leftDisabled}
            className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-semibold text-zinc-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ▶ 재생
          </button>
          <button
            type="button"
            onClick={onLeftStop}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-semibold text-zinc-100 hover:bg-white/10"
          >
            ■
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-rose-500/20 bg-[linear-gradient(135deg,rgba(244,63,94,0.18),rgba(0,0,0,0.35))] p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-zinc-100">{rightLabel}</div>
          {rightHint && <div className="text-[11px] text-zinc-300/80">{rightHint}</div>}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onRightPlay}
            disabled={!!rightDisabled}
            className="flex-1 rounded-xl bg-rose-500/90 px-3 py-2 text-sm font-extrabold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRightPlaying ? "⏸ 말하는 중..." : "▶ 재생"}
          </button>
          <button
            type="button"
            onClick={onRightStop}
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-semibold text-zinc-100 hover:bg-white/10"
          >
            ■
          </button>
        </div>
      </div>
    </div>
  );
}
