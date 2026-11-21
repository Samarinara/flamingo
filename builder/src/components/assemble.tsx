import { DownloadIcon, FileUpIcon, RotateCcwIcon } from "lucide-react"
import { useDeferredValue, useMemo, useRef, type ChangeEvent } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Field, TextInput } from "@/components/form"
import { AsmError, assemble, hex, listingRows, loadIsa, type AsmResult, type Isa } from "@/lib/asm"
import type { Problems } from "@/lib/isa"
import { exampleFor, type AsmSettings } from "@/lib/program"
import { cn } from "@/lib/utils"

type Outcome = { ok: true; isa: Isa; r: AsmResult } | { ok: false; fatal: string; where: "isa" | "base" }

function parseBase(s: string): bigint | undefined {
  const t = s.trim().replace(/_/g, "")
  if (!t) return undefined
  if (!/^(0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d+)$/i.test(t)) throw new AsmError("Base address must be a number such as 0x8000 or 4096.")
  return BigInt(t)
}

function run(isaText: string, source: string, base: string): Outcome {
  let isa: Isa
  try {
    isa = loadIsa(isaText)
  } catch (e) {
    return { ok: false, fatal: e instanceof Error ? e.message : String(e), where: "isa" }
  }
  let b: bigint | undefined
  try {
    b = parseBase(base)
  } catch (e) {
    return { ok: false, fatal: (e as Error).message, where: "base" }
  }
  return { ok: true, isa, r: assemble(isa, source, b) }
}

function download(data: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/octet-stream" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Hidden file input behind an outline button. */
function OpenFile({ accept, label, onText }: { accept: string; label: string; onText: (text: string, name: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (f) onText(await f.text(), f.name)
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
        <FileUpIcon /> {label}
      </Button>
      <input ref={input} type="file" accept={accept} className="hidden" onChange={pick} />
    </>
  )
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`

export function AssembleTab({
  builderToml,
  isaName,
  problems,
  settings,
  onChange,
}: {
  builderToml: string
  isaName: string
  problems: Problems
  settings: AsmSettings
  onChange: (patch: Partial<AsmSettings>) => void
}) {
  const isaText = settings.mode === "builder" ? builderToml : settings.toml
  const source = useDeferredValue(settings.source)
  const out = useMemo(() => run(isaText, source, settings.base), [isaText, source, settings.base])
  const r = out.ok ? out.r : null
  const errorLines = useMemo(() => new Set(r?.errors.map((e) => e.line)), [r])
  const rows = useMemo(() => (out.ok ? listingRows(out.r.items) : []), [out])
  const insns = r ? r.items.filter((it) => it.kind === "insn").length : 0
  const binName = (settings.fileName.replace(/\.[^.]*$/, "") || "program") + ".bin"
  const canDownload = !!r && !r.errors.length && r.image.length > 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Assemble for" className="basis-56">
          {(id) => (
            <Select value={settings.mode} onValueChange={(v) => onChange({ mode: v as AsmSettings["mode"] })}>
              <SelectTrigger id={id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="builder">The ISA in this builder</SelectItem>
                <SelectItem value="toml">A TOML file</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Base address" className="basis-36">
          {(id) => <TextInput id={id} className="font-mono" placeholder="reset_pc" value={settings.base} onValue={(v) => onChange({ base: v })} />}
        </Field>
      </div>

      {settings.mode === "builder" && problems.errors.length > 0 && (
        <p className="border-l-3 border-warn pl-2.5 text-sm">
          The ISA has {plural(problems.errors.length, "error")} (see Checks). The assembler uses it anyway, but results may be wrong until
          they are fixed.
        </p>
      )}

      {settings.mode === "toml" && (
        <Field label="ISA description (TOML, schema 0.1)">
          {(id) => (
            <div className="flex flex-col gap-2">
              <Textarea
                id={id}
                rows={8}
                spellCheck={false}
                className="max-h-72 overflow-auto font-mono text-[12.5px]"
                placeholder="Paste an ISA file such as isa-template.toml, or open one."
                value={settings.toml}
                onChange={(e) => onChange({ toml: e.target.value })}
              />
              <div className="flex flex-wrap gap-2">
                <OpenFile accept=".toml,text/plain" label="Open .toml" onText={(t) => onChange({ toml: t })} />
                <Button variant="outline" size="sm" onClick={() => onChange({ toml: builderToml })}>
                  Copy from builder
                </Button>
              </div>
            </div>
          )}
        </Field>
      )}

      <Field label="Assembly source">
        {(id) => (
          <div className="flex flex-col gap-2">
            <Textarea
              id={id}
              rows={16}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="max-h-[60vh] min-h-64 overflow-auto font-mono text-[12.5px] leading-relaxed [tab-size:8]"
              value={settings.source}
              onChange={(e) => onChange({ source: e.target.value })}
            />
            <div className="flex flex-wrap gap-2">
              <OpenFile accept=".s,.S,.asm,text/plain" label="Open .s" onText={(t, name) => onChange({ source: t, fileName: name })} />
              <Button variant="outline" size="sm" onClick={() => onChange({ source: exampleFor(isaName), fileName: "" })}>
                <RotateCcwIcon /> Example program
              </Button>
              <Button size="sm" className="ml-auto" disabled={!canDownload} onClick={() => r && download(r.image, binName)}>
                <DownloadIcon /> Download {binName}
              </Button>
            </div>
          </div>
        )}
      </Field>

      <section aria-label="Assembler output" aria-live="polite" className="flex flex-col gap-3">
        {!out.ok ? (
          <p className="border-l-3 border-destructive pl-2.5 text-sm">
            {out.where === "isa" ? "Cannot use this ISA: " : ""}
            {out.fatal}
          </p>
        ) : r!.errors.length ? (
          <>
            <p className="text-sm font-medium text-destructive">{plural(r!.errors.length, "error")}</p>
            <ul className="flex max-h-64 flex-col gap-1.5 overflow-auto text-sm">
              {r!.errors.map((e, i) => (
                <li key={i} className="border-l-3 border-destructive pl-2.5">
                  <span className="font-mono text-muted-foreground">line {e.line}:</span> {e.message}
                  <div className="truncate font-mono text-xs text-muted-foreground">{e.source}</div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-ok">Assembled.</span> {plural(r!.image.length, "byte")} starting at{" "}
            <span className="font-mono">{hex(r!.base)}</span>, {plural(insns, "instruction")}.
          </p>
        )}

        {rows.length > 0 && (
          <div tabIndex={0} aria-label="Listing" className="code-block max-h-[50vh] overflow-auto rounded-md border p-3 font-mono text-[12.5px] leading-relaxed">
            <table className="border-separate border-spacing-x-3">
              <thead className="sr-only">
                <tr>
                  <th>Address</th>
                  <th>Bytes</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className={cn(errorLines.has(row.line) && "text-destructive")}>
                    <td className="align-top text-muted-foreground">{row.addr.toString(16).padStart(8, "0")}</td>
                    <td className="align-top whitespace-pre">{row.bytes}</td>
                    <td className="align-top whitespace-pre">{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
