import { Radar } from "lucide-react";

export default function AuthLayout({ children }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-bg px-4 py-10">
      <div className="pointer-events-none absolute -top-48 left-1/2 h-[520px] w-[760px] -translate-x-1/2 rounded-full bg-accent/10 blur-[130px]" />
      <div className="pointer-events-none absolute -bottom-48 right-[-120px] h-[420px] w-[420px] rounded-full bg-info/10 blur-[110px]" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-bg shadow-glow">
            <Radar size={20} />
          </div>
          <div>
            <div className="font-display text-lg font-semibold tracking-tight text-ink">
              Fleet Console
            </div>
            <div className="text-xs text-ink-dim">Employee tracking & tasks</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
