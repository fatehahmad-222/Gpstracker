import { cn } from "@/lib/utils";
import { colorForName, initialsFor } from "@/lib/utils";
import { MARKER_COLORS } from "@/lib/constants";

export function Avatar({ name, size = 36, online, className }) {
  const bg = colorForName(name, MARKER_COLORS);
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <div
        className="flex h-full w-full items-center justify-center rounded-full font-semibold text-bg"
        style={{ background: bg, fontSize: size * 0.36 }}
      >
        {initialsFor(name)}
      </div>
      {online !== undefined && (
        <span
          className={cn(
            "absolute bottom-0 right-0 rounded-full border-2 border-surface",
            online ? "bg-accent" : "bg-ink-dim"
          )}
          style={{ width: size * 0.3, height: size * 0.3 }}
        />
      )}
    </div>
  );
}
