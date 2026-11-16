import type { ReactNode } from 'react';

/** Text menu item with a thin red rule that draws in on hover. */
export function MenuButton({ children, onClick, disabled, delay = 0, hint }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; delay?: number; hint?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{ animationDelay: `${delay}ms` }}
      className="group animate-rise-in flex items-center gap-4 py-2.5 [@media(max-height:500px)]:py-1 text-left font-sans text-[13px] font-normal uppercase tracking-[0.34em] text-bone/80 transition-colors duration-300 hover:text-bone focus-visible:text-bone focus-visible:outline-none disabled:cursor-default disabled:text-bone/25"
    >
      <span className="h-px w-0 bg-ember transition-all duration-500 ease-out group-hover:w-8 group-focus-visible:w-8 group-disabled:w-0" />
      <span className="transition-transform duration-500 ease-out group-hover:translate-x-1 group-disabled:translate-x-0">{children}</span>
      {hint && <span className="text-[10px] tracking-[0.2em] text-ash/60 normal-case">{hint}</span>}
    </button>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="font-sans text-[10px] font-medium uppercase tracking-[0.32em] text-ash">{children}</div>;
}

export function Rule({ className = '' }: { className?: string }) {
  return <div className={`h-px bg-bone/12 ${className}`} />;
}

export function KeyCap({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <span className={`inline-flex h-6 items-center justify-center rounded-[3px] border border-bone/30 px-1.5 font-sans text-[10px] font-medium tracking-[0.12em] text-bone/90 ${wide ? 'min-w-12' : 'min-w-6'}`}>
      {children}
    </span>
  );
}

export function Slider({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2">
      <span className="font-sans text-[12px] tracking-[0.18em] text-bone/85 uppercase">{label}</span>
      <span className="font-sans text-[11px] tabular-nums tracking-[0.1em] text-ash">{format ? format(value) : value.toFixed(2)}</span>
      <input
        className="nf-range col-span-2 w-full"
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

export function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between py-1 text-left disabled:opacity-40"
    >
      <span className="font-sans text-[12px] uppercase tracking-[0.18em] text-bone/85">{label}</span>
      <span className={`relative h-[14px] w-[30px] rounded-full border transition-colors duration-300 ${value ? 'border-ember bg-blood/60' : 'border-bone/30 bg-transparent'}`}>
        <span className={`absolute top-[2px] h-[8px] w-[8px] rounded-full bg-bone transition-all duration-300 ${value ? 'left-[18px]' : 'left-[3px] opacity-60'}`} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="font-sans text-[12px] uppercase tracking-[0.18em] text-bone/85">{label}</span>
      <div className="flex">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`border-b px-3 py-1 font-sans text-[11px] uppercase tracking-[0.2em] transition-colors duration-300 ${o.value === value ? 'border-ember text-bone' : 'border-bone/10 text-ash hover:text-bone/80'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Blurred dark backdrop for overlays. */
export function Backdrop({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <div className={`absolute inset-0 animate-fade-in ${strong ? 'bg-char/85' : 'bg-char/60'} backdrop-blur-[3px]`}>
      {children}
    </div>
  );
}

export function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}
