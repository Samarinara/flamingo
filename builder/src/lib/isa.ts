/* ISA builder model: state shape, validation and TOML output. */

/** Numeric form inputs hold "" while the box is empty. */
export type Num = number | ""

export interface RegFile {
  name: string
  count: Num
  width: Num
  zero: Num
  /** Assembler names, index-ordered, separated by spaces or commas. Empty means <file>0, <file>1, ... */
  names: string
  /** Optional second set of names (ABI names), same format. */
  abi: string
}

export interface FormatField {
  name: string
  hi: Num
  lo: Num
}

export interface Format {
  name: string
  fields: FormatField[]
  /** Width in bits when the ISA is variable-length; ignored for fixed-width ISAs. */
  width?: Num
}

/** Places one format field at bit `lsb` of an immediate value. */
export interface ImmPart {
  field: string
  lsb: Num
}

/** How scattered encoding fields assemble into one immediate value. */
export interface Immediate {
  name: string
  format: string
  signed: boolean
  /** Low bits that are always zero and not encoded. */
  zeros: Num
  /** Written as a target address; the encoding holds target - pc. */
  pcrel: boolean
  parts: ImmPart[]
}

export interface Pseudo {
  /** Template, e.g. "mv {rd}, {rs}" */
  assembly: string
  /** One real instruction per line, using the template's {operands}. */
  expands: string
}

export type FieldRole = "fixed" | "op"

export interface FieldChoice {
  m: FieldRole
  v: string
  /** Register file for a register operand; defaults to the first file. */
  file?: string
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
  /** Instruction width for fixed-width ISAs (and the default for new formats otherwise). */
  width: number
  /** Each format has its own width (opcode byte + operand bytes, as on most 8-bit CPUs). */
  variable: boolean
  /** Data width in bits; empty means the first register file's width, or else the instruction width. */
  xlen: Num
  endianness: string
  regfiles: RegFile[]
  formats: Format[]
  immediates: Immediate[]
  instructions: Instruction[]
  pseudos: Pseudo[]
}

export const WIDTHS = [8, 16, 24, 32, 48, 64]
export const ENDIANNESS = ["little", "big", "bi"]

export const num = (x: Num | undefined | null): number => (x === "" || x == null ? 0 : x)
export const hasValue = (x: Num | undefined | null): x is number => x !== "" && x != null

function ins(name: string, format: string, fixed: Record<string, string>, assembly: string, semantics: string): Instruction {
  const f: Record<string, FieldChoice> = {}
  Object.keys(fixed).forEach((k) => (f[k] = { m: "fixed", v: fixed[k] }))
  return { name, format, assembly, semantics, f }
}

const fields = (...spec: [string, number, number][]): FormatField[] => spec.map(([name, hi, lo]) => ({ name, hi, lo }))

const ABI =
  "zero ra sp gp tp t0 t1 t2 s0 s1 a0 a1 a2 a3 a4 a5 a6 a7 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 t3 t4 t5 t6"

export const example = (): IsaState =>
  syncAll({
    name: "tiny32",
    version: "0.1.0",
    description: "Small 32-bit load/store ISA.",
    width: 32,
    variable: false,
    xlen: "",
    endianness: "little",
    regfiles: [{ name: "X", count: 32, width: 32, zero: 0, names: "", abi: ABI }],
    formats: [
      { name: "R", fields: fields(["funct7", 31, 25], ["rs2", 24, 20], ["rs1", 19, 15], ["funct3", 14, 12], ["rd", 11, 7], ["opcode", 6, 0]) },
      { name: "I", fields: fields(["imm12", 31, 20], ["rs1", 19, 15], ["funct3", 14, 12], ["rd", 11, 7], ["opcode", 6, 0]) },
      { name: "S", fields: fields(["imm_hi", 31, 25], ["rs2", 24, 20], ["rs1", 19, 15], ["funct3", 14, 12], ["imm_lo", 11, 7], ["opcode", 6, 0]) },
      {
        name: "B",
        fields: fields(
          ["imm_b12", 31, 31],
          ["imm_b10_5", 30, 25],
          ["rs2", 24, 20],
          ["rs1", 19, 15],
          ["funct3", 14, 12],
          ["imm_b4_1", 11, 8],
          ["imm_b11", 7, 7],
          ["opcode", 6, 0],
        ),
      },
      { name: "J", fields: fields(["imm_j20", 31, 31], ["imm_j10_1", 30, 21], ["imm_j11", 20, 20], ["imm_j19_12", 19, 12], ["rd", 11, 7], ["opcode", 6, 0]) },
    ],
    immediates: [
      { name: "imm_s", format: "S", signed: true, zeros: 0, pcrel: false, parts: [{ field: "imm_lo", lsb: 0 }, { field: "imm_hi", lsb: 5 }] },
      {
        name: "imm_b",
        format: "B",
        signed: true,
        zeros: 1,
        pcrel: true,
        parts: [
          { field: "imm_b4_1", lsb: 1 },
          { field: "imm_b10_5", lsb: 5 },
          { field: "imm_b11", lsb: 11 },
          { field: "imm_b12", lsb: 12 },
        ],
      },
      {
        name: "imm_j",
        format: "J",
        signed: true,
        zeros: 1,
        pcrel: true,
        parts: [
          { field: "imm_j10_1", lsb: 1 },
          { field: "imm_j11", lsb: 11 },
          { field: "imm_j19_12", lsb: 12 },
          { field: "imm_j20", lsb: 20 },
        ],
      },
    ],
    instructions: [
      ins("add", "R", { opcode: "0110011", funct3: "000", funct7: "0000000" }, "add {rd}, {rs1}, {rs2}", "X[rd] = X[rs1] + X[rs2]"),
      ins("sub", "R", { opcode: "0110011", funct3: "000", funct7: "0100000" }, "sub {rd}, {rs1}, {rs2}", "X[rd] = X[rs1] - X[rs2]"),
      ins("addi", "I", { opcode: "0010011", funct3: "000" }, "addi {rd}, {rs1}, {imm12}", "X[rd] = X[rs1] + sext(imm12, 12)"),
      ins("lw", "I", { opcode: "0000011", funct3: "010" }, "lw {rd}, {imm12}({rs1})", "X[rd] = mem_read(X[rs1] + sext(imm12, 12), 4)"),
      ins("sw", "S", { opcode: "0100011", funct3: "010" }, "sw {rs2}, {imm_s}({rs1})", "mem_write(X[rs1] + sext(imm_s, 12), 4, X[rs2])"),
      ins("beq", "B", { opcode: "1100011", funct3: "000" }, "beq {rs1}, {rs2}, {imm_b}", "if X[rs1] == X[rs2]: pc = pc + sext(imm_b, 13)"),
      ins("jal", "J", { opcode: "1101111" }, "jal {rd}, {imm_j}", "X[rd] = pc + 4\npc = pc + sext(imm_j, 21)"),
    ],
    pseudos: [
      { assembly: "nop", expands: "addi x0, x0, 0" },
      { assembly: "mv {rd}, {rs}", expands: "addi {rd}, {rs}, 0" },
      { assembly: "j {target}", expands: "jal x0, {target}" },
    ],
  })

/** One instruction of the tiny8 example: opcode byte, optional operand immediate. */
function op8(name: string, format: string, opcode: number, assembly: string, semantics: string): Instruction {
  return ins(name, format, { opcode: opcode.toString(2).padStart(8, "0") }, assembly, semantics)
}

const imm8 = (name: string, format: string, signed: boolean, pcrel: boolean): Immediate => ({
  name,
  format,
  signed,
  zeros: 0,
  pcrel,
  parts: [{ field: name, lsb: 0 }],
})

/**
 * An 8-bit accumulator ISA with variable-length instructions: an opcode byte
 * then 0-2 operand bytes. Same as examples/tiny8.toml.
 */
export const example8 = (): IsaState =>
  syncAll({
    name: "tiny8",
    version: "0.1.0",
    description: "Example 8-bit accumulator ISA: opcode byte plus 0-2 operand bytes.",
    width: 16,
    variable: true,
    xlen: 8,
    endianness: "little",
    regfiles: [],
    formats: [
      { name: "N", width: 8, fields: fields(["opcode", 7, 0]) },
      { name: "I", width: 16, fields: fields(["imm8", 15, 8], ["opcode", 7, 0]) },
      { name: "Z", width: 16, fields: fields(["zp", 15, 8], ["opcode", 7, 0]) },
      { name: "A", width: 24, fields: fields(["addr", 23, 8], ["opcode", 7, 0]) },
      { name: "B", width: 16, fields: fields(["rel", 15, 8], ["opcode", 7, 0]) },
    ],
    immediates: [imm8("imm8", "I", false, false), imm8("zp", "Z", false, false), imm8("addr", "A", false, false), imm8("rel", "B", true, true)],
    instructions: [
      op8("nop", "N", 0x00, "nop", ""),
      op8("hlt", "N", 0x01, "hlt", "halt()"),
      op8("ret", "N", 0x02, "ret", "pc = pop16()"),
      op8("lda_imm", "I", 0x10, "lda #{imm8}", "A = imm8; Z = (A == 0)"),
      op8("add_imm", "I", 0x11, "add #{imm8}", "A = (A + imm8)[7:0]; Z = (A == 0)"),
      op8("sub_imm", "I", 0x12, "sub #{imm8}", "A = (A - imm8)[7:0]; Z = (A == 0)"),
      op8("cmp_imm", "I", 0x13, "cmp #{imm8}", "Z = (A == imm8)"),
      op8("lda_zp", "Z", 0x20, "lda {zp}", "A = mem_read(zp, 1); Z = (A == 0)"),
      op8("sta_zp", "Z", 0x21, "sta {zp}", "mem_write(zp, 1, A)"),
      op8("lda_abs", "A", 0x30, "lda {addr}", "A = mem_read(addr, 1); Z = (A == 0)"),
      op8("sta_abs", "A", 0x31, "sta {addr}", "mem_write(addr, 1, A)"),
      op8("jmp", "A", 0x40, "jmp {addr}", "pc = addr"),
      op8("jsr", "A", 0x41, "jsr {addr}", "push16(pc + 3); pc = addr"),
      op8("beq", "B", 0x50, "beq {rel}", "if Z: pc = pc + sext(rel, 8)"),
      op8("bne", "B", 0x51, "bne {rel}", "if !Z: pc = pc + sext(rel, 8)"),
    ],
    pseudos: [
      { assembly: "clr", expands: "lda #0" },
      { assembly: "dec", expands: "sub #1" },
    ],
  })

export const empty = (): IsaState => ({
  name: "my_isa",
  version: "0.1.0",
  description: "",
  width: 32,
  variable: false,
  xlen: "",
  endianness: "little",
  regfiles: [],
  formats: [],
  immediates: [],
  instructions: [],
  pseudos: [],
})

export const isState = (s: unknown): s is IsaState =>
  !!s &&
  typeof s === "object" &&
  Array.isArray((s as IsaState).formats) &&
  Array.isArray((s as IsaState).regfiles) &&
  Array.isArray((s as IsaState).instructions)

/** Fill in parts of the state that older saved drafts do not have. Mutates and returns `S`. */
export function normalize(S: IsaState): IsaState {
  S.variable ??= false
  S.xlen ??= ""
  S.immediates ??= []
  S.pseudos ??= []
  S.regfiles.forEach((r) => {
    r.names ??= ""
    r.abi ??= ""
  })
  return S
}

/* ---------- helpers ---------- */

export const fmtOf = (S: IsaState, name: string) => S.formats.find((f) => f.name === name)

export const sortedFields = (fm: Format) => [...fm.fields].sort((a, b) => num(b.hi) - num(a.hi))

export const fieldWidth = (f: FormatField) => num(f.hi) - num(f.lo) + 1

/** A format's width in bits: its own when the ISA is variable-length, else the ISA's. */
export const fmtWidth = (S: IsaState, fm: Format) => (S.variable ? (hasValue(fm.width) ? fm.width : S.width) : S.width)

/** Data width: as set, else the first register file's width, else the instruction width. */
export const xlenOf = (S: IsaState) => (hasValue(S.xlen) ? S.xlen : S.regfiles[0] ? num(S.regfiles[0].width) : S.width)

export const splitNames = (s: string) => (s || "").split(/[\s,]+/).filter(Boolean)

/** Assembler names for a register file: the ones given, or <file>0, <file>1, ... */
export function regNames(r: RegFile): string[] {
  const given = splitNames(r.names)
  if (given.length) return given
  return Array.from({ length: Math.max(0, Math.min(num(r.count), 4096)) }, (_, i) => `${r.name.toLowerCase()}${i}`)
}

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

/** Fill in defaults, then run ensureFields over every instruction. Mutates and returns `S`. */
export function syncAll(S: IsaState): IsaState {
  normalize(S)
  S.instructions.forEach((it) => ensureFields(S, it))
  return S
}

/** A field whose name starts with "imm" and that no immediate claims is a signed immediate on its own. */
const isImplicitImm = (field: string) => /^imm/.test(field)

/** Field name -> explicit immediate of format `format`. */
export function immByField(S: IsaState, format: string): Map<string, Immediate> {
  const m = new Map<string, Immediate>()
  S.immediates.filter((im) => im.format === format).forEach((im) => im.parts.forEach((p) => m.has(p.field) || m.set(p.field, im)))
  return m
}

/** Width in bits of an immediate's value: highest placed bit + 1. */
export function immBits(S: IsaState, im: Immediate): number {
  const fm = fmtOf(S, im.format)
  let bits = 0
  im.parts.forEach((p) => {
    const f = fm?.fields.find((x) => x.name === p.field)
    if (f) bits = Math.max(bits, num(p.lsb) + fieldWidth(f))
  })
  return bits
}

export type Operand = { name: string; kind: "reg"; file: string; field: string } | { name: string; kind: "imm"; imm: Immediate }

/** An instruction's operands in field order (most significant first); each immediate appears once. */
export function operandsOf(S: IsaState, it: Instruction): Operand[] {
  const fm = fmtOf(S, it.format)
  if (!fm) return []
  const byField = immByField(S, it.format)
  const out: Operand[] = []
  const seen = new Set<string>()
  sortedFields(fm).forEach((f) => {
    const c = it.f[f.name] ?? { m: "op", v: "" }
    if (c.m !== "op") return
    const im = byField.get(f.name)
    if (im) {
      if (!seen.has(im.name)) out.push({ name: im.name, kind: "imm", imm: im })
      seen.add(im.name)
    } else if (isImplicitImm(f.name)) {
      out.push({ name: f.name, kind: "imm", imm: implicitImm(it.format, f.name) })
    } else {
      out.push({ name: f.name, kind: "reg", file: c.file || S.regfiles[0]?.name || "", field: f.name })
    }
  })
  return out
}

const implicitImm = (format: string, field: string): Immediate => ({
  name: field,
  format,
  signed: true,
  zeros: 0,
  pcrel: false,
  parts: [{ field, lsb: 0 }],
})

/** Explicit immediates plus the implicit ones instructions actually use, unique by name. */
export function allImmediates(S: IsaState): Immediate[] {
  const out = [...S.immediates]
  S.instructions.forEach((it) =>
    operandsOf(S, it).forEach((o) => {
      if (o.kind === "imm" && !out.some((x) => x.name === o.imm.name && x.format === o.imm.format)) out.push(o.imm)
    }),
  )
  return out
}

/** Mnemonic of an assembly template: its first word, lowercased. */
export const mnemonicOf = (template: string) => (template.trim().split(/\s+/)[0] || "").toLowerCase()

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

const placeholders = (s: string) => [...(s || "").matchAll(/\{(\w+)\}/g)].map((m) => m[1])

export function validate(S: IsaState): Problems {
  const E: string[] = [],
    Wn: string[] = []
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
  dup(S.immediates.map((i) => i.name), "immediate")
  S.regfiles.forEach((r) => {
    const count = num(r.count)
    if (count < 1 || count > 4096) E.push(`Register file ${r.name}: count must be 1 to 4096.`)
    if (hasValue(r.zero) && (r.zero < 0 || r.zero >= count)) E.push(`Register file ${r.name}: zero register index is out of range.`)
    const seen = new Map<string, string>()
    ;(
      [
        ["names", splitNames(r.names)],
        ["ABI names", splitNames(r.abi)],
      ] as const
    ).forEach(([what, list]) => {
      if (list.length && list.length !== count) E.push(`Register file ${r.name}: ${list.length} ${what} given, but count is ${count}.`)
      list.forEach((n, i) => {
        const prev = seen.get(n.toLowerCase())
        if (prev !== undefined && prev !== String(i)) E.push(`Register file ${r.name}: name "${n}" is used for two registers.`)
        seen.set(n.toLowerCase(), String(i))
      })
    })
  })
  if (hasValue(S.xlen) && (S.xlen < 1 || S.xlen > 1024)) E.push("Data width must be 1 to 1024 bits.")
  S.formats.forEach((fm) => {
    dup(fm.fields.map((f) => f.name), `field in format ${fm.name}`)
    const W = fmtWidth(S, fm)
    if (S.variable && (W < 8 || W > 64 || W % 8)) E.push(`Format ${fm.name}: width must be 8 to 64 bits, in whole bytes.`)
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

  // immediates: parts exist, cover zeros..bits exactly once, one immediate per field
  const claimed = new Map<string, string>()
  S.immediates.forEach((im) => {
    const fm = fmtOf(S, im.format)
    const where = `Immediate ${im.name || "(unnamed)"}`
    if (!fm) {
      E.push(`${where}: choose a format.`)
      return
    }
    if (!im.parts.length) E.push(`${where}: add at least one field.`)
    if (fm.fields.some((f) => f.name === im.name) && !im.parts.some((p) => p.field === im.name))
      E.push(`${where}: its name is also a field of format ${fm.name}. Pick a different name.`)
    const bits = new Map<number, string>()
    im.parts.forEach((p) => {
      const f = fm.fields.find((x) => x.name === p.field)
      if (!f) {
        E.push(`${where}: format ${fm.name} has no field "${p.field}".`)
        return
      }
      const key = `${im.format}.${p.field}`
      const other = claimed.get(key)
      if (other && other !== im.name) E.push(`Field ${p.field} of format ${fm.name} is in both immediates ${other} and ${im.name}.`)
      claimed.set(key, im.name)
      if (!hasValue(p.lsb) || p.lsb < 0) {
        E.push(`${where}: give field ${p.field} a bit position.`)
        return
      }
      for (let b = p.lsb; b < p.lsb + fieldWidth(f); b++) {
        if (bits.has(b)) E.push(`${where}: bit ${b} comes from both ${bits.get(b)} and ${p.field}.`)
        bits.set(b, p.field)
      }
    })
    const total = immBits(S, im),
      zeros = num(im.zeros)
    if (zeros < 0) E.push(`${where}: low zero bits cannot be negative.`)
    const missing: number[] = []
    for (let b = zeros; b < total; b++) if (!bits.has(b)) missing.push(b)
    if (missing.length) E.push(`${where}: no field supplies bit${missing.length > 1 ? "s" : ""} ${rangeText(missing)}.`)
    const low = [...bits.keys()].filter((b) => b < zeros)
    if (low.length) E.push(`${where}: bits ${rangeText(low.sort((a, b) => a - b))} are encoded but marked as always zero.`)
  })

  const enc: [string, bigint, bigint, number][] = []
  const immNames = new Map<string, string>()
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
    const byField = immByField(S, it.format)
    fm.fields.forEach((f) => {
      const hi = num(f.hi),
        lo = num(f.lo)
      const c = it.f[f.name] ?? { m: "op", v: "" },
        w = hi - lo + 1
      if (c.m === "op") {
        const im = byField.get(f.name)
        if (im && im.parts.some((p) => (it.f[p.field] ?? { m: "op" }).m === "fixed"))
          E.push(`Instruction ${it.name}: immediate ${im.name} has some fields fixed and some as operands. Make them all one or the other.`)
        else if (!im && !isImplicitImm(f.name)) {
          if (!S.regfiles.length) E.push(`Instruction ${it.name}: ${f.name} is a register operand, but there are no register files.`)
          else if (c.file && !S.regfiles.some((r) => r.name === c.file)) E.push(`Instruction ${it.name}: ${f.name} uses unknown register file ${c.file}.`)
        }
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
    const ops = operandsOf(S, it)
    ops.forEach((o) => {
      if (o.kind !== "imm") return
      const prev = immNames.get(o.name)
      if (prev && prev !== o.imm.format)
        E.push(`Immediate field ${o.name} appears in formats ${prev} and ${o.imm.format}. Immediate names must be unique; define an immediate for one of them.`)
      immNames.set(o.name, o.imm.format)
    })
    if (!fixedCount) Wn.push(`Instruction ${it.name} has no fixed fields, so it matches every word.`)
    const used = placeholders(it.assembly)
    const names = ops.map((o) => o.name)
    used.forEach((u) => {
      if (!names.includes(u)) E.push(`Instruction ${it.name}: assembly uses {${u}}, which is not one of its operands (${names.join(", ") || "none"}).`)
    })
    if (new Set(used).size !== used.length) E.push(`Instruction ${it.name}: the assembly template uses an operand twice.`)
    names.forEach((o) => {
      if (!used.includes(o)) E.push(`Instruction ${it.name}: operand ${o} does not appear in the assembly template.`)
    })
    if (!(it.assembly || "").trim()) Wn.push(`Instruction ${it.name} has no assembly template.`)
    else if (mnemonicOf(it.assembly) !== it.name && !it.name.startsWith(mnemonicOf(it.assembly) + "_")) Wn.push(`Instruction ${it.name}: its assembly template starts with "${mnemonicOf(it.assembly)}", so that is what you type in source.`)
    if (ok) enc.push([it.name, match, mask, fmtWidth(S, fm)])
  })
  // Compare encodings from their first byte in memory, so that with variable-length
  // instructions a short one must differ from the start of every longer one.
  const widest = Math.max(0, ...enc.map((e) => e[3]))
  const shift = (w: number) => BigInt(S.endianness === "big" ? widest - w : 0)
  for (let i = 0; i < enc.length; i++)
    for (let j = i + 1; j < enc.length; j++) {
      const [a, ma, ka, wa] = enc[i],
        [b, mb, kb, wb] = enc[j]
      const [sa, sb] = [shift(wa), shift(wb)]
      if ((((ma << sa) ^ (mb << sb)) & (ka << sa) & (kb << sb)) === 0n)
        E.push(
          wa === wb
            ? `Encodings of ${a} and ${b} overlap: some words match both.`
            : `Encodings of ${a} and ${b} overlap: the start of the longer one can be read as the shorter one.`,
        )
    }

  const mnemonics = new Set([...S.instructions.map((i) => mnemonicOf(i.assembly)), ...S.pseudos.map((p) => mnemonicOf(p.assembly))])
  S.pseudos.forEach((p, i) => {
    const where = `Pseudo-instruction ${mnemonicOf(p.assembly) || `#${i + 1}`}`
    if (!p.assembly.trim()) {
      E.push(`${where}: give it an assembly template.`)
      return
    }
    const lines = p.expands.split("\n").filter((l) => l.trim())
    if (!lines.length) E.push(`${where}: give it at least one expansion line.`)
    const own = placeholders(p.assembly)
    lines.forEach((l) => {
      const mn = mnemonicOf(l)
      if (!mnemonics.has(mn)) E.push(`${where}: expands to unknown instruction "${mn}".`)
      placeholders(l).forEach((u) => {
        if (!own.includes(u)) E.push(`${where}: expansion uses {${u}}, which is not in its template.`)
      })
    })
  })
  if (!S.instructions.length) Wn.push("No instructions yet.")
  return { errors: E, warnings: Wn }
}

/* ---------- TOML ---------- */

const q = (s: unknown) => JSON.stringify(String(s ?? ""))
const key = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : q(k))
const ml = (s: string) => `"""\n${String(s).replace(/\\/g, "\\\\").replace(/"""/g, '\\"""')}\n"""`
const arr = (xs: string[]) => `[${xs.map(q).join(", ")}]`

export function toml(S: IsaState): string {
  const L: string[] = []
  L.push("[meta]", `schema_version = "0.1"`, `name = ${q(S.name)}`, `version = ${q(S.version)}`, `description = ${q(S.description)}`, "")
  L.push(
    "[isa]",
    `xlen = ${xlenOf(S)}`,
    `endianness = ${q(S.endianness)}`,
    ...(S.variable ? [`instruction_width = "variable"`, `fetch_alignment = 1`] : [`instruction_width = "fixed"`, `instruction_bits = ${S.width}`]),
    "",
  )
  L.push("[semantics]", `language = "isa-pseudo-v0"`, "")
  L.push("[[extension]]", `name = "base"`, `mandatory = true`, `depends_on = []`, "")
  S.regfiles.forEach((r) => {
    L.push("[[register_file]]", `name = ${q(r.name)}`, `count = ${num(r.count)}`, `width = ${num(r.width)}`, `index_bits = ${lg2(num(r.count))}`)
    if (hasValue(r.zero)) L.push(`zero_register = ${r.zero}`)
    L.push(`names = ${arr(regNames(r))}`)
    if (splitNames(r.abi).length) L.push(`abi_names = ${arr(splitNames(r.abi))}`)
    L.push("")
  })
  S.formats.forEach((fm) => {
    L.push("[[format]]", `name = ${q(fm.name)}`, `width = ${fmtWidth(S, fm)}`)
    sortedFields(fm).forEach((f) => L.push("  [[format.field]]", `  name = ${q(f.name)}`, `  bits = [${num(f.hi)}, ${num(f.lo)}]`))
    L.push("")
  })
  allImmediates(S).forEach((im) => {
    L.push("[[immediate]]", `name = ${q(im.name)}`, `format = ${q(im.format)}`, `bits = ${immBits(S, im)}`, `signed = ${im.signed}`)
    if (num(im.zeros)) L.push(`implicit_zero_bits = ${num(im.zeros)}`)
    const parts = [...im.parts].sort((a, b) => num(a.lsb) - num(b.lsb)).map((p) => `{ field = ${q(p.field)}, dst_lsb = ${num(p.lsb)} }`)
    L.push(`parts = [ ${parts.join(", ")} ]`, "")
  })
  S.instructions.forEach((it) => {
    const fm = fmtOf(S, it.format)
    if (!fm) return
    const role = (n: string) => it.f[n] ?? { m: "op", v: "" }
    const fixed = sortedFields(fm)
      .filter((f) => role(f.name).m === "fixed")
      .map((f) => `${key(f.name)} = ${q(role(f.name).v)}`)
    const ops = operandsOf(S, it).map((o) =>
      o.kind === "imm"
        ? `  { name = ${q(o.name)}, kind = "imm"${o.imm.pcrel ? ", pc_relative = true" : ""} },`
        : `  { name = ${q(o.name)}, kind = "reg", file = ${q(o.file)} },`,
    )
    L.push("[[instruction]]", `name = ${q(it.name)}`, `extension = "base"`, `format = ${q(it.format)}`, `encoding.fixed = { ${fixed.join(", ")} }`)
    if (ops.length) L.push("operands = [", ...ops, "]")
    L.push(`assembly = ${q(it.assembly)}`)
    if ((it.semantics || "").trim()) L.push(`semantics = ${/\n/.test(it.semantics) ? ml(it.semantics.trim()) : q(it.semantics)}`)
    L.push("")
  })
  S.pseudos.forEach((p) => {
    const lines = p.expands.split("\n").map((l) => l.trim()).filter(Boolean)
    L.push("[[pseudo_instruction]]", `name = ${q(mnemonicOf(p.assembly))}`, `assembly = ${q(p.assembly.trim())}`, `expands_to = ${arr(lines)}`, "")
  })
  return L.join("\n").replace(/\n+$/, "\n")
}
