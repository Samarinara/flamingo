import { CheckIcon, CopyIcon } from "lucide-react"
import { useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { Problems } from "@/lib/isa"

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`

async function copyText(text: string, fallback: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* fall through to execCommand */
  }
  if (!fallback) return false
  fallback.value = text
  fallback.select()
  try {
    return document.execCommand("copy")
  } catch {
    return false
  }
}

export function TomlPanel({ text, problems }: { text: string; problems: Problems }) {
  const [label, setLabel] = useState<"idle" | "ok" | "fail">("idle")
  const clip = useRef<HTMLTextAreaElement>(null)
  const timer = useRef<number>(undefined)
  const { errors, warnings } = problems

  const copy = async () => {
    const ok = await copyText(text, clip.current)
    setLabel(ok ? "ok" : "fail")
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setLabel("idle"), 1600)
  }

  return (
    <Card size="sm" className="gap-0 pb-0">
      <CardHeader className="border-b pb-3">
        <CardTitle className="font-mono">isa.toml</CardTitle>
        <CardAction className="flex items-center gap-2">
          <Badge key={`e${errors.length}`} variant="outline" className={cn("animate-in zoom-in-75 duration-300 ease-spring", errors.length ? "border-destructive/50 text-destructive" : "border-ok/50 text-ok")}>
            {plural(errors.length, "error")}
          </Badge>
          {warnings.length > 0 && (
            <Badge key={`w${warnings.length}`} variant="outline" className="animate-in border-warn/50 text-warn zoom-in-75 duration-300 ease-spring">
              {plural(warnings.length, "warning")}
            </Badge>
          )}
          <Button size="sm" onClick={copy}>
            {label === "ok" ? (
              <CheckIcon key="ok" className="animate-in zoom-in-50 -spin-in-45 duration-300 ease-spring" />
            ) : (
              <CopyIcon key="copy" className="animate-in zoom-in-75 fade-in-0 duration-300 ease-spring" />
            )}
            {label === "ok" ? "Copied" : label === "fail" ? "Select the text and copy" : "Copy TOML"}
          </Button>
        </CardAction>
      </CardHeader>
      <pre tabIndex={0} className="code-block max-h-[52vh] overflow-auto px-5 pt-4 pb-6 font-mono text-[12.5px] leading-relaxed [tab-size:2]">
        {text}
      </pre>
      <textarea ref={clip} aria-hidden="true" tabIndex={-1} className="sr-only" readOnly />
    </Card>
  )
}

export function ChecksPanel({ problems }: { problems: Problems }) {
  const { errors, warnings } = problems
  const items = [...errors.map((m) => ({ m, kind: "error" as const })), ...warnings.map((m) => ({ m, kind: "warn" as const }))]
  return (
    <Card size="sm">
      <CardHeader className="border-b pb-3">
        <CardTitle>Checks</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex max-h-[26vh] flex-col gap-1.5 overflow-auto text-sm">
          {items.length ? (
            items.map(({ m, kind }, i) => (
              <li
                key={i}
                className={cn(
                  "animate-in rounded-2xl px-3 py-1 fade-in-0 slide-in-from-left-2 duration-300 ease-fluid", kind === "error" ? "bg-destructive/10 text-destructive" : "bg-warn/12 text-foreground",
                )}
              >
                {m}
              </li>
            ))
          ) : (
            <li className="animate-in rounded-2xl bg-ok/12 px-3 py-1 text-muted-foreground fade-in-0 zoom-in-95 duration-500 ease-spring">Formats cover every bit and no two encodings overlap.</li>
          )}
        </ul>
      </CardContent>
    </Card>
  )
}
