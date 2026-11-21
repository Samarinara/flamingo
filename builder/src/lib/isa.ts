/* ISA builder model: state shape, validation and TOML output. */

/** Numeric form inputs hold "" while the box is empty. */
export type Num = number | ""

export interface RegFile {
  name: string
  count: Num
  width: Num
  zero: Num
}

export interface FormatField {
  name: string
  hi: Num
  lo: Num
}

export interface Format {
  name: string
  fields: FormatField[]
}

export type FieldRole = "fixed" | "op"

export interface FieldChoice {
  m: FieldRole
  v: string
}

export interface Instruction {
  name: string
  format: string
  assembly: string
  semantics: string
  f: Record<string, FieldChoice>
}

export interface IsaState {
  name: string
  version: string
  description: string
  width: number
  endianness: string
  regfiles: RegFile[]
  formats: Format[]
  instructions: Instruction[]
}

export const WIDTHS = [16, 32, 48, 64]
export const ENDIANNESS = ["little", "big", "bi"]

export const num = (x: Num | undefined | null): number => (x === "" || x == null ? 0 : x)
export const hasValue = (x: Num | undefined | null): x is number => x !== "" && x != null

function ins(name: string, format: string, fixed: Record<string, string>, assembly: string, semantics: string): Instruction {
  const f: Record<string, FieldChoice> = {}
  Object.keys(fixed).forEach((k) => (f[k] = { m: "fixed", v: fixed[k] }))
  return { name, format, assembly, semantics, f }
}

export const example = (): IsaState =>
  syncAll({
    name: "tiny32",
    version: "0.1.0",
    description: "Small 32-bit load/store ISA.",
    width: 32,
    endianness: "little",
    regfiles: [{ name: "X", count: 32, width: 32, zero: 0 }],
    formats: [
      {
        name: "R",
        fields: [
          { name: "funct7", hi: 31, lo: 25 },
          { name: "rs2", hi: 24, lo: 20 },
          { name: "rs1", hi: 19, lo: 15 },
          { name: "funct3", hi: 14, lo: 12 },
          { name: "rd", hi: 11, lo: 7 },
          { name: "opcode", hi: 6, lo: 0 },
        ],
      },
      {
        name: "I",
        fields: [
          { name: "imm12", hi: 31, lo: 20 },
          { name: "rs1", hi: 19, lo: 15 },
          { name: "funct3", hi: 14, lo: 12 },
          { name: "rd", hi: 11, lo: 7 },
          { name: "opcode", hi: 6, lo: 0 },
        ],
      },
    ],
    instructions: [
      ins("add", "R", { opcode: "0110011", funct3: "000", funct7: "0000000" }, "add {rd}, {rs1}, {rs2}", "X[rd] = X[rs1] + X[rs2]"),
      ins("sub", "R", { opcode: "0110011", funct3: "000", funct7: "0100000" }, "sub {rd}, {rs1}, {rs2}", "X[rd] = X[rs1] - X[rs2]"),
      ins("addi", "I", { opcode: "0010011", funct3: "000" }, "addi {rd}, {rs1}, {imm12}", "X[rd] = X[rs1] + sext(imm12, 12)"),
      ins("lw", "I", { opcode: "0000011", funct3: "010" }, "lw {rd}, {imm12}({rs1})", "X[rd] = mem_read(X[rs1] + sext(imm12, 12), 4)"),
    ],
  })

export const empty = (): IsaState => ({
  name: "my_isa",
  version: "0.1.0",
  description: "",
  width: 32,
  endianness: "little",
  regfiles: [],
  formats: [],
  instructions: [],
})

export const isState = (s: unknown): s is IsaState =>
  !!s &&
  typeof s === "object" &&
  Array.isArray((s as IsaState).formats) &&
  Array.isArray((s as IsaState).regfiles) &&
  Array.isArray((s as IsaState).instructions)

/* ---------- helpers ---------- */

export const fmtOf = (S: IsaState, name: string) => S.formats.find((f) => f.name === name)

export const sortedFields = (fm: Format) => [...fm.fields].sort((a, b) => num(b.hi) - num(a.hi))

/**
 * Make an instruction's field choices match its format: add missing fields as
 * operands and drop fields the format no longer has. Mutates `it`.
 * Returns the format's fields, most significant first.
 */
export function ensureFields(S: IsaState, it: Instruction): FormatField[] {
  const fm = fmtOf(S, it.format)
  it.f = it.f || {}
  if (!fm) return []
  const names = fm.fields.map((x) => x.name)
  names.forEach((n) => {
    if (!it.f[n]) it.f[n] = { m: "op", v: "" }
  })
  Object.keys(it.f).forEach((k) => {
    if (!names.includes(k)) delete it.f[k]
  })
  return sortedFields(fm)
}

/** Run ensureFields over every instruction. Mutates and returns `S`. */
export function syncAll(S: IsaState): IsaState {
  S.instructions.forEach((it) => ensureFields(S, it))
  return S
}

export const lg2 = (n: number) => Math.max(1, Math.ceil(Math.log2(Math.max(2, n))))

export function rangeText(a: number[]): string {
  const out: string[] = []
  let s = a[0],
    p = a[0]
  for (let i = 1; i <= a.length; i++) {
    if (a[i] !== p + 1) {
      out.push(s === p ? `${s}` : `${p}:${s}`)
      s = a[i]
    }
    p = a[i]
  }
  return out.join(", ")
}

/* ---------- validation ---------- */

export interface Problems {
  errors: string[]
  warnings: string[]
}

export function validate(S: IsaState): Problems {
  const E: string[] = [],
    Wn: string[] = [],
    W = S.width
  if (!/^[a-z][a-z0-9_]*$/.test(S.name)) E.push("ISA name must be lowercase letters, digits and underscores, starting with a letter.")
  const dup = (arr: string[], what: string) => {
    const s = new Set<string>()
    arr.forEach((n) => {
      if (!n) E.push(`A ${what} has no name.`)
      else if (s.has(n)) E.push(`Duplicate ${what} name "${n}".`)
      s.add(n)
    })
  }
  dup(S.regfiles.map((r) => r.name), "register file")
  dup(S.formats.map((f) => f.name), "format")
  dup(S.instructions.map((i) => i.name), "instruction")
  S.regfiles.forEach((r) => {
    const count = num(r.count)
    if (count < 1 || count > 4096) E.push(`Register file ${r.name}: count must be 1 to 4096.`)
    if (hasValue(r.zero) && (r.zero < 0 || r.zero >= count)) E.push(`Register file ${r.name}: zero register index is out of range.`)
  })
  S.formats.forEach((fm) => {
    dup(fm.fields.map((f) => f.name), `field in format ${fm.name}`)
    const cover: (string | null)[] = Array(W).fill(null)
    let bad = false
    fm.fields.forEach((f) => {
      const hi = num(f.hi),
        lo = num(f.lo)
      if (!(hi >= lo && lo >= 0 && hi < W)) {
        E.push(`Format ${fm.name}, field ${f.name}: bits [${hi}:${lo}] are outside 0..${W - 1}.`)
        bad = true
        return
      }
      for (let b = lo; b <= hi; b++) {
        if (cover[b]) {
          E.push(`Format ${fm.name}: bit ${b} belongs to both ${cover[b]} and ${f.name}.`)
          bad = true
        }
        cover[b] = f.name
      }
    })
    if (!bad) {
      const gaps = cover.map((c, i) => (c ? null : i)).filter((x): x is number => x !== null)
      if (gaps.length) E.push(`Format ${fm.name}: bits ${rangeText(gaps)} belong to no field.`)
    }
    if (!fm.fields.length) E.push(`Format ${fm.name} has no fields.`)
  })
  const enc: [string, bigint, bigint][] = []
  S.instructions.forEach((it) => {
    const fm = fmtOf(S, it.format)
    if (!fm) {
      E.push(`Instruction ${it.name}: choose a format.`)
      return
    }
    let match = 0n,
      mask = 0n,
      ok = true,
      fixedCount = 0
    const ops: string[] = []
    fm.fields.forEach((f) => {
      const hi = num(f.hi),
        lo = num(f.lo)
      const c = it.f[f.name] ?? { m: "op", v: "" },
        w = hi - lo + 1
      if (c.m === "op") {
        ops.push(f.name)
        return
      }
      fixedCount++
      if (!/^[01]+$/.test(c.v) || c.v.length !== w) {
        E.push(`Instruction ${it.name}: fixed value for ${f.name} needs exactly ${w} binary digit${w > 1 ? "s" : ""}.`)
        ok = false
        return
      }
      if (hi < lo || hi >= 64) {
        ok = false
        return
      }
      mask |= ((1n << BigInt(w)) - 1n) << BigInt(lo)
      match |= BigInt("0b" + c.v) << BigInt(lo)
    })
    if (!fixedCount) Wn.push(`Instruction ${it.name} has no fixed fields, so it matches every word.`)
    const used = [...(it.assembly || "").matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    used.forEach((u) => {
      if (!ops.includes(u)) E.push(`Instruction ${it.name}: assembly uses {${u}}, which is not an operand field.`)
    })
    ops.forEach((o) => {
      if (!used.includes(o)) Wn.push(`Instruction ${it.name}: operand ${o} does not appear in the assembly template.`)
    })
    if (!(it.assembly || "").trim()) Wn.push(`Instruction ${it.name} has no assembly template.`)
    if (ok) enc.push([it.name, match, mask])
  })
  for (let i = 0; i < enc.length; i++)
    for (let j = i + 1; j < enc.length; j++) {
      const [a, ma, ka] = enc[i],
        [b, mb, kb] = enc[j]
      if (((ma ^ mb) & ka & kb) === 0n) E.push(`Encodings of ${a} and ${b} overlap: some words match both.`)
    }
  if (!S.instructions.length) Wn.push("No instructions yet.")
  return { errors: E, warnings: Wn }
}

/* ---------- TOML ---------- */

const q = (s: unknown) => JSON.stringify(String(s ?? ""))
const key = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : q(k))
const ml = (s: string) => `"""\n${String(s).replace(/\\/g, "\\\\").replace(/"""/g, '\\"""')}\n"""`

export function toml(S: IsaState): string {
  const L: string[] = []
  L.push("[meta]", `schema_version = "0.1"`, `name = ${q(S.name)}`, `version = ${q(S.version)}`, `description = ${q(S.description)}`, "")
  L.push(
    "[isa]",
    `xlen = ${S.regfiles[0] ? num(S.regfiles[0].width) : S.width}`,
    `endianness = ${q(S.endianness)}`,
    `instruction_width = "fixed"`,
    `instruction_bits = ${S.width}`,
    "",
  )
  S.regfiles.forEach((r) => {
    L.push("[[register_file]]", `name = ${q(r.name)}`, `count = ${num(r.count)}`, `width = ${num(r.width)}`, `index_bits = ${lg2(num(r.count))}`)
    if (hasValue(r.zero)) L.push(`zero_register = ${r.zero}`)
    L.push("")
  })
  S.formats.forEach((fm) => {
    L.push("[[format]]", `name = ${q(fm.name)}`, `width = ${S.width}`)
    sortedFields(fm).forEach((f) => L.push("  [[format.field]]", `  name = ${q(f.name)}`, `  bits = [${num(f.hi)}, ${num(f.lo)}]`))
    L.push("")
  })
  const file = S.regfiles[0] ? S.regfiles[0].name : "X"
  S.instructions.forEach((it) => {
    const fm = fmtOf(S, it.format)
    if (!fm) return
    const fields = sortedFields(fm)
    const role = (n: string) => it.f[n] ?? { m: "op", v: "" }
    const fixed = fields.filter((f) => role(f.name).m === "fixed").map((f) => `${key(f.name)} = ${q(role(f.name).v)}`)
    const ops = fields
      .filter((f) => role(f.name).m === "op")
      .map((f) =>
        /^imm/.test(f.name) ? `  { name = ${q(f.name)}, kind = "imm" },` : `  { name = ${q(f.name)}, kind = "reg", file = ${q(file)} },`,
      )
    L.push("[[instruction]]", `name = ${q(it.name)}`, `format = ${q(it.format)}`, `encoding.fixed = { ${fixed.join(", ")} }`)
    if (ops.length) L.push("operands = [", ...ops, "]")
    L.push(`assembly = ${q(it.assembly)}`)
    if ((it.semantics || "").trim()) L.push(`semantics = ${/\n/.test(it.semantics) ? ml(it.semantics.trim()) : q(it.semantics)}`)
    L.push("")
  })
  return L.join("\n").replace(/\n+$/, "\n")
}
