import { useId, type ComponentProps, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Num } from "@/lib/isa"

/** Label above a control. `children` receives the id to put on the control. */
export function Field({ label, className, children }: { label: string; className?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children(id)}
    </div>
  )
}

type TextInputProps = Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string
  onValue: (v: string) => void
  clean?: (v: string) => string
}

/** Text input that can rewrite what is typed (keeping the caret in place). */
export function TextInput({ value, onValue, clean, className, ...props }: TextInputProps) {
  return (
    <Input
      {...props}
      className={className}
      value={value}
      onChange={(e) => {
        const t = e.target
        let v = t.value
        if (clean) {
          const s = clean(v)
          if (s !== v) {
            const pos = t.selectionStart
            t.value = s
            try {
              t.setSelectionRange(pos, pos)
            } catch {
              /* input types without selection */
            }
          }
          v = s
        }
        onValue(v)
      }}
    />
  )
}

type NumInputProps = Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: Num
  onValue: (v: Num) => void
}

export function NumInput({ value, onValue, ...props }: NumInputProps) {
  return <Input {...props} type="number" value={value} onChange={(e) => onValue(e.target.value === "" ? "" : Number(e.target.value))} />
}
