import { cn } from "@/lib/utils"
import { num, type Format } from "@/lib/isa"

interface Seg {
  w: number
  kind: "field" | "gap" | "over"
  name: string
  range: string
  hue?: number
}

function segments(fm: Format, W: number): Seg[] {
  const fs = fm.fields
    .map((f) => ({ name: f.name, hi: num(f.hi), lo: num(f.lo) }))
    .filter((f) => f.hi >= f.lo && f.lo >= 0 && f.hi < W)
    .sort((a, b) => b.hi - a.hi)
  const out: Seg[] = []
  let cur = W - 1
  fs.forEach((f, idx) => {
    if (f.hi < cur) out.push({ w: cur - f.hi, kind: "gap", name: "unused", range: `[${cur}:${f.hi + 1}]` })
    out.push({
      w: f.hi - f.lo + 1,
      kind: f.hi > cur ? "over" : "field",
      name: f.name,
      range: `[${f.hi}:${f.lo}]`,
      hue: (idx * 47 + 210) % 360,
    })
    cur = Math.min(cur, f.lo - 1)
  })
  if (cur >= 0) out.push({ w: cur + 1, kind: "gap", name: "unused", range: `[${cur}:0]` })
  return out.length ? out : [{ w: W, kind: "gap", name: "no fields", range: `[${W - 1}:0]` }]
}

/** Horizontal map of a format's fields across the instruction word, MSB on the left. */
export function BitBar({ format, width }: { format: Format; width: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-11 overflow-hidden rounded-md border bg-muted">
        {segments(format, width).map((s, i) => (
          <div
            key={i}
            title={`${s.name} ${s.range}`}
            style={{ flex: `${s.w} 1 0`, background: s.hue != null ? `hsl(${s.hue} 55% var(--seg-l))` : undefined }}
            className={cn(
              "flex min-w-0 flex-col justify-center overflow-hidden border-r border-card px-1 py-0.5 font-mono text-[11px] leading-tight text-foreground",
              s.kind === "gap" && "bit-gap text-destructive",
              s.kind === "over" && "outline-2 -outline-offset-2 outline-destructive",
            )}
          >
            <b className="truncate font-medium">{s.name}</b>
            <i className="whitespace-nowrap not-italic opacity-70">{s.range}</i>
          </div>
        ))}
      </div>
      <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
        <span>{width - 1}</span>
        <span>0</span>
      </div>
    </div>
  )
}
