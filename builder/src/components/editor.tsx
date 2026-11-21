import { PlusIcon, Trash2Icon, XIcon } from "lucide-react"
import { useRef, useState, type ComponentProps, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { BitBar } from "@/components/bit-bar"
import { Field, NumInput, TextInput } from "@/components/form"
import { sanitize } from "@/lib/sanitize"
import { cn } from "@/lib/utils"
import {
  ENDIANNESS,
  WIDTHS,
  allImmediates,
  fieldWidth,
  fmtOf,
  fmtWidth,
  hasValue,
  immBits,
  immByField,
  mnemonicOf,
  num,
  operandsOf,
  regNames,
  sortedFields,
  xlenOf,
  type Format,
  type IsaState,
} from "@/lib/isa"

export type Update = (fn: (draft: IsaState) => void) => void
interface TabProps {
  S: IsaState
  update: Update
}

const Hint = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>
const Row = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap gap-3 *:flex-1 *:basis-36">{children}</div>

const COLLAPSE_MS = 200 // keep in step with duration-200 below

/** Removing collapses the card first, so the list closes the gap instead of jumping. */
function ItemCard({ title, onRemove, children }: { title: string; onRemove: () => void; children: ReactNode }) {
  const [removing, setRemoving] = useState(false)
  const remove = () => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return onRemove()
    setRemoving(true)
    window.setTimeout(() => {
      // Lists are keyed by index, so this card is reused for the next item: reset it in the same render.
      setRemoving(false)
      onRemove()
    }, COLLAPSE_MS)
  }
  return (
    <div
      className={cn(
        "grid",
        removing
          ? "pointer-events-none -mb-4 grid-rows-[0fr] opacity-0 transition-[grid-template-rows,margin,opacity] duration-200 ease-out"
          : "grid-rows-[1fr]",
      )}
    >
      <div className={cn("min-h-0", removing && "overflow-hidden")}>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="font-mono">{title}</CardTitle>
            <CardAction>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={remove}
              >
                <Trash2Icon /> Remove
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">{children}</CardContent>
        </Card>
      </div>
    </div>
  )
}

/** Adds an item, then scrolls just enough to keep the new card and this button on screen. */
function AddButton({ children, onClick, ...props }: ComponentProps<typeof Button>) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref}>
      <Button
        variant="outline"
        {...props}
        onClick={(e) => {
          onClick?.(e)
          requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }))
        }}
      >
        <PlusIcon /> {children}
      </Button>
    </div>
  )
}

/* ---------- Architecture ---------- */

export function ArchTab({ S, update }: TabProps) {
  return (
    <div className="flex flex-col gap-4">
      <Row>
        <Field label="ISA name">
          {(id) => <TextInput id={id} className="font-mono" value={S.name} clean={sanitize.id} onValue={(v) => update((d) => void (d.name = v))} />}
        </Field>
        <Field label="Version">
          {(id) => <TextInput id={id} className="font-mono" value={S.version} onValue={(v) => update((d) => void (d.version = v))} />}
        </Field>
      </Row>
      <Field label="Description">
        {(id) => <TextInput id={id} value={S.description} onValue={(v) => update((d) => void (d.description = v))} />}
      </Field>
      <Row>
        <Field label="Instruction width (bits)">
          {(id) => (
            <Select
              value={S.variable ? "variable" : String(S.width)}
              onValueChange={(v) =>
                update((d) => {
                  if (v === "variable") {
                    d.formats.forEach((fm) => (fm.width = hasValue(fm.width) && d.variable ? fm.width : d.width))
                    d.variable = true
                    return
                  }
                  const w = Number(v)
                  d.variable = false
                  d.width = w
                  d.formats.forEach((fm) =>
                    fm.fields.forEach((f) => {
                      f.hi = Math.min(num(f.hi), w - 1)
                      f.lo = Math.min(num(f.lo), w - 1)
                    }),
                  )
                })
              }
            >
              <SelectTrigger id={id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WIDTHS.map((w) => (
                  <SelectItem key={w} value={String(w)}>
                    {w}
                  </SelectItem>
                ))}
                <SelectItem value="variable">variable (set per format)</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Data width (bits)">
          {(id) => (
            <NumInput
              id={id}
              min={1}
              max={1024}
              placeholder={`${xlenOf({ ...S, xlen: "" })} (from ${S.regfiles[0] ? `register file ${S.regfiles[0].name}` : "instruction width"})`}
              value={S.xlen}
              onValue={(v) => update((d) => void (d.xlen = v))}
            />
          )}
        </Field>
        <Field label="Byte order">
          {(id) => (
            <Select value={S.endianness} onValueChange={(v) => update((d) => void (d.endianness = v))}>
              <SelectTrigger id={id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENDIANNESS.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      </Row>
      <Hint>
        With a fixed width, every format has that width. Choose variable when instructions take different numbers of bytes, as on most 8-bit
        CPUs (an opcode byte, then operand bytes); each format then sets its own width. The data width is the size of a machine word, such
        as 8 for an 8-bit CPU. A full-width unsigned immediate also accepts negative values, so 8-bit values may be written as -1 or 255.
      </Hint>
    </div>
  )
}

/* ---------- Registers ---------- */

export function RegsTab({ S, update }: TabProps) {
  return (
    <div className="flex flex-col gap-4">
      {S.regfiles.map((r, i) => (
        <ItemCard key={i} title={r.name || "register file"} onRemove={() => update((d) => void d.regfiles.splice(i, 1))}>
          <Row>
            <Field label="Name">
              {(id) => (
                <TextInput id={id} className="font-mono" value={r.name} clean={sanitize.id} onValue={(v) => update((d) => void (d.regfiles[i].name = v))} />
              )}
            </Field>
            <Field label="Count">
              {(id) => <NumInput id={id} min={1} max={4096} value={r.count} onValue={(v) => update((d) => void (d.regfiles[i].count = v))} />}
            </Field>
            <Field label="Width (bits)">
              {(id) => <NumInput id={id} min={1} max={1024} value={r.width} onValue={(v) => update((d) => void (d.regfiles[i].width = v))} />}
            </Field>
            <Field label="Zero register index">
              {(id) => (
                <NumInput id={id} min={0} placeholder="none" value={r.zero ?? ""} onValue={(v) => update((d) => void (d.regfiles[i].zero = v))} />
              )}
            </Field>
          </Row>
          <Field label="Register names, in index order (spaces or commas)">
            {(id) => (
              <TextInput
                id={id}
                className="font-mono"
                placeholder={regNames({ ...r, names: "" }).slice(0, 4).join(" ") + " …"}
                value={r.names}
                onValue={(v) => update((d) => void (d.regfiles[i].names = v))}
              />
            )}
          </Field>
          <Field label="ABI names (optional, also accepted by the assembler)">
            {(id) => (
              <TextInput id={id} className="font-mono" placeholder="zero ra sp …" value={r.abi} onValue={(v) => update((d) => void (d.regfiles[i].abi = v))} />
            )}
          </Field>
        </ItemCard>
      ))}
      <Hint>Leave the names empty to use the file name and index, such as x0, x1, x2. These are the names you type in assembly source.</Hint>
      <AddButton
        onClick={() => update((d) => void d.regfiles.push({ name: d.regfiles.length ? "F" : "X", count: 32, width: 32, zero: "", names: "", abi: "" }))}
      >
        Add register file
      </AddButton>
    </div>
  )
}

/* ---------- Formats ---------- */

export function FormatsTab({ S, update }: TabProps) {
  return (
    <div className="flex flex-col gap-4">
      {!S.formats.length && (
        <Hint>
          A format splits {S.variable ? "an instruction" : `the ${S.width}-bit instruction word`} into named fields. Add one to begin.
        </Hint>
      )}
      {S.variable && S.endianness !== "big" && S.formats.length > 0 && (
        <Hint>Byte order is little-endian, so bits [7:0] of each format are the first byte in memory. Put the opcode there.</Hint>
      )}
      {S.formats.map((fm, i) => {
        const W = fmtWidth(S, fm)
        return (
          <ItemCard
            key={i}
            title={`Format ${fm.name}`}
            onRemove={() =>
              update((d) => {
                const n = d.formats[i].name
                d.formats.splice(i, 1)
                d.immediates = d.immediates.filter((im) => im.format !== n)
                d.instructions.forEach((x) => {
                  if (x.format === n) {
                    x.format = ""
                    x.f = {}
                  }
                })
              })
            }
          >
            <div className="flex flex-wrap gap-3">
              <Field label="Name" className="w-52">
                {(id) => (
                  <TextInput
                    id={id}
                    className="font-mono"
                    value={fm.name}
                    clean={sanitize.id}
                    onValue={(v) =>
                      update((d) => {
                        const old = d.formats[i].name
                        d.instructions.forEach((it) => {
                          if (it.format === old) it.format = v
                        })
                        d.immediates.forEach((im) => {
                          if (im.format === old) im.format = v
                        })
                        d.formats[i].name = v
                      })
                    }
                  />
                )}
              </Field>
              {S.variable && (
                <Field label="Width (bits)" className="w-32">
                  {(id) => (
                    <Select
                      value={String(W)}
                      onValueChange={(v) =>
                        update((d) => {
                          const w = Number(v)
                          d.formats[i].width = w
                          d.formats[i].fields.forEach((f) => {
                            f.hi = Math.min(num(f.hi), w - 1)
                            f.lo = Math.min(num(f.lo), w - 1)
                          })
                        })
                      }
                    >
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WIDTHS.map((w) => (
                          <SelectItem key={w} value={String(w)}>
                            {w}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
              )}
            </div>
            <BitBar format={fm} width={W} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>High bit</TableHead>
                  <TableHead>Low bit</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fm.fields.map((f, j) => (
                  <TableRow key={j}>
                    <TableCell>
                      <TextInput
                        aria-label="Field name"
                        className="min-w-28 font-mono"
                        value={f.name}
                        clean={sanitize.id}
                        onValue={(v) => update((d) => void (d.formats[i].fields[j].name = v))}
                      />
                    </TableCell>
                    <TableCell>
                      <NumInput
                        aria-label={`High bit of ${f.name}`}
                        className="w-20"
                        min={0}
                        max={W - 1}
                        value={f.hi}
                        onValue={(v) => update((d) => void (d.formats[i].fields[j].hi = v))}
                      />
                    </TableCell>
                    <TableCell>
                      <NumInput
                        aria-label={`Low bit of ${f.name}`}
                        className="w-20"
                        min={0}
                        max={W - 1}
                        value={f.lo}
                        onValue={(v) => update((d) => void (d.formats[i].fields[j].lo = v))}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove field ${f.name}`}
                        onClick={() => update((d) => void d.formats[i].fields.splice(j, 1))}
                      >
                        <XIcon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => update((d) => void d.formats[i].fields.push({ name: "field" + (d.formats[i].fields.length + 1), hi: 0, lo: 0 }))}
              >
                <PlusIcon /> Add field
              </Button>
            </div>
            <ImmediatesEditor S={S} fm={fm} update={update} />
          </ItemCard>
        )
      })}
      <AddButton
        onClick={() =>
          update(
            (d) =>
              void d.formats.push(newFormat(d)),
          )
        }
      >
        Add format
      </AddButton>
    </div>
  )
}

/* ---------- Instructions ---------- */

export function InstructionsTab({ S, update }: TabProps) {
  return (
    <div className="flex flex-col gap-4">
      {!S.formats.length && <Hint>Define a format first, then instructions can use it.</Hint>}
      {S.instructions.map((it, i) => {
        const fm = fmtOf(S, it.format)
        const fields = fm ? sortedFields(fm) : []
        const byField = immByField(S, it.format)
        const ops = operandsOf(S, it)
        return (
          <ItemCard key={i} title={it.name || "instruction"} onRemove={() => update((d) => void d.instructions.splice(i, 1))}>
            <Row>
              <Field label="Mnemonic">
                {(id) => (
                  <TextInput
                    id={id}
                    className="font-mono"
                    value={it.name}
                    clean={sanitize.id}
                    onValue={(v) => update((d) => void (d.instructions[i].name = v))}
                  />
                )}
              </Field>
              <Field label="Format">
                {(id) => (
                  <Select
                    value={fm ? it.format : ""}
                    onValueChange={(v) =>
                      update((d) => {
                        d.instructions[i].format = v
                        d.instructions[i].f = {}
                      })
                    }
                  >
                    <SelectTrigger id={id} className="w-full font-mono">
                      <SelectValue placeholder="choose…" />
                    </SelectTrigger>
                    <SelectContent>
                      {S.formats
                        .filter((f) => f.name)
                        .map((f, k) => (
                          <SelectItem key={k} value={f.name} className="font-mono">
                            {f.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            </Row>
            {fields.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>Bits</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fields.map((f) => {
                    const c = it.f[f.name] ?? { m: "op", v: "" }
                    const w = num(f.hi) - num(f.lo) + 1
                    const cw = Math.min(Math.max(w, 1), 32)
                    return (
                      <TableRow key={f.name}>
                        <TableCell className="font-mono">{f.name}</TableCell>
                        <TableCell className="font-mono text-muted-foreground">
                          [{num(f.hi)}:{num(f.lo)}]
                        </TableCell>
                        <TableCell>
                          <Select value={c.m} onValueChange={(v) => update((d) => void (d.instructions[i].f[f.name].m = v as "fixed" | "op"))}>
                            <SelectTrigger size="sm" aria-label={`Role of ${f.name}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="fixed">fixed</SelectItem>
                              <SelectItem value="op">operand</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {c.m === "fixed" ? (
                            <TextInput
                              aria-label={`Fixed value of ${f.name}`}
                              className="font-mono"
                              style={{ minWidth: `${cw + 4}ch` }}
                              maxLength={Math.max(w, 1)}
                              placeholder={"0".repeat(cw)}
                              value={c.v}
                              clean={sanitize.bin}
                              onValue={(v) => update((d) => void (d.instructions[i].f[f.name].v = v))}
                            />
                          ) : (
                            <OperandInfo S={S} field={f.name} imm={byField.get(f.name)?.name} file={c.file} onFile={(v) => update((d) => void (d.instructions[i].f[f.name].file = v))} />
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
            <Field label={`Assembly template (operands: ${ops.map((o) => `{${o.name}}`).join(" ") || "none"})`}>
              {(id) => (
                <TextInput
                  id={id}
                  className="font-mono"
                  placeholder={[it.name, ops.map((o) => `{${o.name}}`).join(", ")].join(" ")}
                  value={it.assembly}
                  onValue={(v) => update((d) => void (d.instructions[i].assembly = v))}
                />
              )}
            </Field>
            <Field label="Semantics (pseudocode)">
              {(id) => (
                <Textarea
                  id={id}
                  rows={3}
                  className="font-mono"
                  value={it.semantics}
                  onChange={(e) => {
                    const v = e.target.value
                    update((d) => void (d.instructions[i].semantics = v))
                  }}
                />
              )}
            </Field>
          </ItemCard>
        )
      })}
      <AddButton
        disabled={!S.formats.length}
        onClick={() =>
          update((d) => void d.instructions.push({ name: "op" + (d.instructions.length + 1), format: d.formats[0].name, assembly: "", semantics: "", f: {} }))
        }
      >
        Add instruction
      </AddButton>
    </div>
  )
}

/* ---------- Operand details (instruction field table) ---------- */

function OperandInfo({ S, field, imm, file, onFile }: { S: IsaState; field: string; imm?: string; file?: string; onFile: (v: string) => void }) {
  if (imm || /^imm/.test(field)) {
    const name = imm ?? field
    return (
      <span className="font-mono text-sm text-muted-foreground">
        {`{${name}}`} <span className="font-sans">immediate{imm ? "" : ", signed"}</span>
      </span>
    )
  }
  if (S.regfiles.length <= 1)
    return (
      <span className="font-mono text-sm text-muted-foreground">
        {`{${field}}`} <span className="font-sans">register{S.regfiles[0] ? ` in ${S.regfiles[0].name}` : ""}</span>
      </span>
    )
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-sm text-muted-foreground">{`{${field}}`}</span>
      <Select value={file || S.regfiles[0].name} onValueChange={onFile}>
        <SelectTrigger size="sm" aria-label={`Register file of ${field}`} className="font-mono">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {S.regfiles.map((r) => (
            <SelectItem key={r.name} value={r.name} className="font-mono">
              {r.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/* ---------- Immediates (inside a format card) ---------- */

function ImmediatesEditor({ S, fm, update }: { S: IsaState; fm: Format; update: Update }) {
  const list = S.immediates.map((im, idx) => ({ im, idx })).filter(({ im }) => im.format === fm.name)
  const free = sortedFields(fm).filter((f) => /^imm/.test(f.name) && !S.immediates.some((im) => im.format === fm.name && im.parts.some((p) => p.field === f.name)))
  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div className="text-sm font-medium">Immediates</div>
      <Hint>
        An immediate joins one or more fields into a single value you write in assembly. Fields named imm… that no immediate uses are each
        a signed value on their own{free.length ? ` (here: ${free.map((f) => f.name).join(", ")})` : ""}.
      </Hint>
      {list.map(({ im, idx }) => {
        const bits = immBits(S, im)
        const set = (fn: (x: (typeof S.immediates)[number]) => void) => update((d) => fn(d.immediates[idx]))
        return (
          <div key={idx} className="flex flex-col gap-3 rounded-md border p-3">
            <div className="flex flex-wrap items-end gap-3 *:basis-32">
              <Field label="Name" className="flex-1">
                {(id) => (
                  <TextInput
                    id={id}
                    className="font-mono"
                    value={im.name}
                    clean={sanitize.id}
                    onValue={(v) =>
                      update((d) => {
                        const old = d.immediates[idx].name
                        d.immediates[idx].name = v
                        d.instructions.forEach((it) => {
                          if (it.format === fm.name) it.assembly = it.assembly.replaceAll(`{${old}}`, `{${v}}`)
                        })
                      })
                    }
                  />
                )}
              </Field>
              <Field label="Sign" className="flex-1">
                {(id) => (
                  <Select value={im.signed ? "s" : "u"} onValueChange={(v) => set((x) => void (x.signed = v === "s"))}>
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="s">signed</SelectItem>
                      <SelectItem value="u">unsigned</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field label="Always-zero low bits" className="flex-1">
                {(id) => <NumInput id={id} min={0} max={63} value={im.zeros} onValue={(v) => set((x) => void (x.zeros = v))} />}
              </Field>
              <Field label="Value is" className="flex-1">
                {(id) => (
                  <Select value={im.pcrel ? "pc" : "abs"} onValueChange={(v) => set((x) => void (x.pcrel = v === "pc"))}>
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="abs">absolute</SelectItem>
                      <SelectItem value="pc">pc-relative</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Button
                variant="ghost"
                size="sm"
                className="flex-none basis-auto text-muted-foreground hover:text-destructive"
                onClick={() => update((d) => void d.immediates.splice(idx, 1))}
              >
                <Trash2Icon /> Remove
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Goes to value bits</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {im.parts.map((p, j) => {
                  const f = fm.fields.find((x) => x.name === p.field)
                  const w = f ? fieldWidth(f) : 0
                  return (
                    <TableRow key={j}>
                      <TableCell>
                        <Select value={f ? p.field : ""} onValueChange={(v) => set((x) => void (x.parts[j].field = v))}>
                          <SelectTrigger size="sm" aria-label="Field" className="min-w-28 font-mono">
                            <SelectValue placeholder="choose…" />
                          </SelectTrigger>
                          <SelectContent>
                            {sortedFields(fm)
                              .filter((x) => x.name)
                              .map((x) => (
                                <SelectItem key={x.name} value={x.name} className="font-mono">
                                  {x.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <NumInput
                            aria-label={`Lowest value bit of ${p.field}`}
                            className="w-20"
                            min={0}
                            value={p.lsb}
                            onValue={(v) => set((x) => void (x.parts[j].lsb = v))}
                          />
                          <span className="font-mono text-sm whitespace-nowrap text-muted-foreground">
                            {f ? (w > 1 ? `[${num(p.lsb) + w - 1}:${num(p.lsb)}]` : `[${num(p.lsb)}]`) : ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${p.field} from ${im.name}`}
                          onClick={() => set((x) => void x.parts.splice(j, 1))}
                        >
                          <XIcon />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  set((x) => {
                    const used = new Set(x.parts.map((p) => p.field))
                    const next = sortedFields(fm)
                      .reverse()
                      .find((f) => !used.has(f.name) && /^imm/.test(f.name))
                    x.parts.push({ field: next?.name ?? "", lsb: immBits(S, x) })
                  })
                }
              >
                <PlusIcon /> Add field
              </Button>
              <span className="text-sm text-muted-foreground">
                {bits}-bit {im.signed ? "signed" : "unsigned"} value
                {num(im.zeros) ? `, low ${num(im.zeros)} bit${num(im.zeros) > 1 ? "s" : ""} always 0` : ""}
              </span>
            </div>
          </div>
        )
      })}
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            update((d) => {
              const taken = new Set(allImmediates(d).map((x) => x.name))
              let name = `imm_${fm.name.toLowerCase()}`
              for (let k = 2; taken.has(name); k++) name = `imm_${fm.name.toLowerCase()}${k}`
              d.immediates.push({ name, format: fm.name, signed: true, zeros: 0, pcrel: false, parts: [] })
            })
          }
        >
          <PlusIcon /> Add immediate
        </Button>
      </div>
    </div>
  )
}

/* ---------- Pseudo-instructions ---------- */

export function PseudoTab({ S, update }: TabProps) {
  return (
    <div className="flex flex-col gap-4">
      <Hint>
        A pseudo-instruction is an alias the assembler rewrites into real instructions. Its {"{operands}"} are copied as text into each
        expansion line.
      </Hint>
      {S.pseudos.map((p, i) => (
        <ItemCard key={i} title={mnemonicOf(p.assembly) || "pseudo-instruction"} onRemove={() => update((d) => void d.pseudos.splice(i, 1))}>
          <Field label="Assembly template">
            {(id) => (
              <TextInput
                id={id}
                className="font-mono"
                placeholder="mv {rd}, {rs}"
                value={p.assembly}
                onValue={(v) => update((d) => void (d.pseudos[i].assembly = v))}
              />
            )}
          </Field>
          <Field label="Expands to (one instruction per line)">
            {(id) => (
              <Textarea
                id={id}
                rows={Math.max(2, p.expands.split("\n").length)}
                className="font-mono"
                placeholder="addi {rd}, {rs}, 0"
                value={p.expands}
                onChange={(e) => {
                  const v = e.target.value
                  update((d) => void (d.pseudos[i].expands = v))
                }}
              />
            )}
          </Field>
        </ItemCard>
      ))}
      <AddButton onClick={() => update((d) => void d.pseudos.push({ assembly: "", expands: "" }))}>Add pseudo-instruction</AddButton>
    </div>
  )
}

/** A new format: an opcode byte first for byte-oriented ISAs, else a 7-bit opcode at the bottom. */
function newFormat(d: IsaState): Format {
  const name = "F" + (d.formats.length + 1)
  const w = d.variable ? 16 : d.width
  if (w === 8) return { name, width: w, fields: [{ name: "opcode", hi: 7, lo: 0 }] }
  if (d.variable || w <= 16)
    return {
      name,
      width: w,
      fields: [
        { name: "operand", hi: w - 1, lo: 8 },
        { name: "opcode", hi: 7, lo: 0 },
      ],
    }
  return {
    name,
    fields: [
      { name: "payload", hi: w - 1, lo: 7 },
      { name: "opcode", hi: 6, lo: 0 },
    ],
  }
}
