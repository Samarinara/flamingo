import { PlusIcon, Trash2Icon, XIcon } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { BitBar } from "@/components/bit-bar"
import { Field, NumInput, TextInput } from "@/components/form"
import { sanitize } from "@/lib/sanitize"
import { ENDIANNESS, WIDTHS, num, sortedFields, fmtOf, type FieldRole, type IsaState } from "@/lib/isa"

export type Update = (fn: (draft: IsaState) => void) => void
interface TabProps {
  S: IsaState
  update: Update
}

const Hint = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>
const Row = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap gap-3 *:flex-1 *:basis-36">{children}</div>

function ItemCard({ title, onRemove, children }: { title: string; onRemove: () => void; children: ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="font-mono">{title}</CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={onRemove}>
            <Trash2Icon /> Remove
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  )
}

function AddButton({ children, ...props }: ComponentProps<typeof Button>) {
  return (
    <div>
      <Button variant="outline" {...props}>
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
              value={String(S.width)}
              onValueChange={(v) =>
                update((d) => {
                  const w = Number(v)
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
              </SelectContent>
            </Select>
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
      <Hint>Fixed-width encoding only. All formats share this width. Variable-length encodings need hand edits to the TOML.</Hint>
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
        </ItemCard>
      ))}
      <AddButton onClick={() => update((d) => void d.regfiles.push({ name: d.regfiles.length ? "F" : "X", count: 32, width: 32, zero: "" }))}>
        Add register file
      </AddButton>
    </div>
  )
}

/* ---------- Formats ---------- */

export function FormatsTab({ S, update }: TabProps) {
  const W = S.width
  return (
    <div className="flex flex-col gap-4">
      {!S.formats.length && <Hint>A format splits the {W}-bit instruction word into named fields. Add one to begin.</Hint>}
      {S.formats.map((fm, i) => (
        <ItemCard
          key={i}
          title={`Format ${fm.name}`}
          onRemove={() =>
            update((d) => {
              const n = d.formats[i].name
              d.formats.splice(i, 1)
              d.instructions.forEach((x) => {
                if (x.format === n) {
                  x.format = ""
                  x.f = {}
                }
              })
            })
          }
        >
          <Field label="Name" className="max-w-52">
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
                    d.formats[i].name = v
                  })
                }
              />
            )}
          </Field>
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
        </ItemCard>
      ))}
      <AddButton
        onClick={() =>
          update(
            (d) =>
              void d.formats.push({
                name: "F" + (d.formats.length + 1),
                fields: [
                  { name: "payload", hi: d.width - 1, lo: 7 },
                  { name: "opcode", hi: 6, lo: 0 },
                ],
              }),
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
                    <TableHead>Fixed value</TableHead>
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
                          <Select value={c.m} onValueChange={(v) => update((d) => void (d.instructions[i].f[f.name].m = v as FieldRole))}>
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
                            <span className="font-mono text-sm text-muted-foreground">{`{${f.name}}`}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
            <Field label="Assembly template (use {field} for operands)">
              {(id) => (
                <TextInput id={id} className="font-mono" value={it.assembly} onValue={(v) => update((d) => void (d.instructions[i].assembly = v))} />
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
