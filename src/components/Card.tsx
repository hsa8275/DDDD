type Props = {
  step: string;
  title: string;
  subtitle: string;
  accent: "rose";
  children: React.ReactNode;
};

export default function Card({ step, title, subtitle, children }: Props) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(800px_260px_at_20%_0%,rgba(244,63,94,0.10),transparent_65%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.06),transparent_35%)]" />

      <div className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center rounded-xl border border-rose-500/25 bg-rose-500/10 px-2.5 py-1 text-xs font-bold text-rose-200">
              {step}
            </div>
            <h2 className="mt-3 text-lg font-extrabold tracking-tight text-zinc-100">{title}</h2>
            <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
          </div>
        </div>

        <div className="mt-5">{children}</div>
      </div>
    </section>
  );
}
