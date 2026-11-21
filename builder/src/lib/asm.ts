/*
 * Two-pass assembler driven by an ISA TOML document (schema 0.1).
 *
 * This is a port of tools/asm.py and must stay in step with it: the same
 * source syntax, the same encoding rules and the same error messages.
 * tests/asm.test.ts checks that both produce identical bytes and listings.
 * Values are bigints so 64-bit ISAs and .dword data work exactly.
 */
import { parse, TomlError } from "smol-toml"

export class AsmError extends Error {}
class Undefined extends AsmError {}

/* ---------- expressions ---------- */

const TOKEN = /\s*(?:(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*)|('(?:\\.|[^'\\])+')|([A-Za-z_.$][\w.$]*)|(<<|>>|[-+*/%&|^~()]))/y
const BINARY = [["|"], ["^"], ["&"], ["<<", ">>"], ["+", "-"], ["*", "/", "%"]]

type Token = ["num", bigint] | ["sym" | "op", string]

/** Decode a Python-style quoted literal ("..." or '...') the way ast.literal_eval does for the escapes people use. */
function unquote(lit: string): string {
  const body = lit.slice(1, -1)
  let out = ""
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === lit[0]) throw new AsmError(`bad string literal ${lit}`)
    if (c !== "\\") {
      out += c
      continue
    }
    const n = body[++i]
    const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', a: "\x07", b: "\b", f: "\f", v: "\v" }
    if (n in simple) out += simple[n]
    else if (n === "\n") continue
    else if (/[0-7]/.test(n)) {
      const m = /^[0-7]{1,3}/.exec(body.slice(i))![0]
      out += String.fromCodePoint(parseInt(m, 8))
      i += m.length - 1
    } else if (n === "x" || n === "u" || n === "U") {
      const len = { x: 2, u: 4, U: 8 }[n]
      const hex = body.slice(i + 1, i + 1 + len)
      if (!new RegExp(`^[0-9a-fA-F]{${len}}$`).test(hex)) throw new AsmError(`bad \\${n} escape in ${lit}`)
      out += String.fromCodePoint(parseInt(hex, 16))
      i += len
    } else if (n === undefined) throw new AsmError(`bad string literal ${lit}`)
    else out += "\\" + n
  }
  return out
}

function tokenize(text: string): Token[] {
  const toks: Token[] = []
  text = text.trimEnd()
  let pos = 0
  while (pos < text.length) {
    TOKEN.lastIndex = pos
    const m = TOKEN.exec(text)
    if (!m || TOKEN.lastIndex === pos) throw new AsmError(`bad expression near '${text.slice(pos).trim()}'`)
    pos = TOKEN.lastIndex
    if (m[1] !== undefined) {
      const s = m[1].replace(/_/g, "")
      toks.push(["num", BigInt(s)])
    } else if (m[2] !== undefined) {
      const v = [...unquote(m[2])]
      if (v.length !== 1) throw new AsmError(`character literal ${m[2]} must be one character`)
      toks.push(["num", BigInt(v[0].codePointAt(0)!)])
    } else if (m[3] !== undefined) toks.push(["sym", m[3]])
    else toks.push(["op", m[4]])
  }
  if (!toks.length) throw new AsmError("empty expression")
  return toks
}

/** Evaluate an integer expression. Throws Undefined for unknown symbols. */
export function evaluate(text: string, syms: Map<string, bigint>, here: bigint): bigint {
  const toks = tokenize(text)
  let pos = 0
  const isOp = (t: Token | undefined, ops: string[]) => !!t && t[0] === "op" && ops.includes(t[1] as string)

  const unary = (): bigint => {
    const t = toks[pos++]
    if (!t) throw new AsmError(`expression '${text}' ends early`)
    if (t[0] === "num") return t[1]
    const v = t[1]
    if (t[0] === "sym") {
      if (v === ".") return here
      const s = syms.get(v)
      if (s === undefined) throw new Undefined(`undefined symbol '${v}'`)
      return s
    }
    if (v === "(") {
      const r = binary(0)
      if (!isOp(toks[pos], [")"])) throw new AsmError(`missing ')' in '${text}'`)
      pos++
      return r
    }
    if (v === "-") return -unary()
    if (v === "+") return unary()
    if (v === "~") return ~unary()
    throw new AsmError(`unexpected '${v}' in '${text}'`)
  }

  const binary = (level: number): bigint => {
    if (level === BINARY.length) return unary()
    let left = binary(level + 1)
    while (isOp(toks[pos], BINARY[level])) {
      const op = toks[pos++][1] as string
      const right = binary(level + 1)
      if ((op === "/" || op === "%") && right === 0n) throw new AsmError(`division by zero in '${text}'`)
      if ((op === "<<" || op === ">>") && right < 0n) throw new AsmError(`negative shift in '${text}'`)
      // bigint / and % truncate toward zero, matching asm.py
      if (op === "/") left /= right
      else if (op === "%") left %= right
      else if (op === "|") left |= right
      else if (op === "^") left ^= right
      else if (op === "&") left &= right
      else if (op === "<<") left <<= right
      else if (op === ">>") left >>= right
      else if (op === "+") left += right
      else if (op === "-") left -= right
      else left *= right
    }
    return left
  }

  const result = binary(0)
  if (pos !== toks.length) throw new AsmError(`unexpected '${toks[pos][1]}' in '${text}'`)
  return result
}

/* ---------- ISA tables ---------- */

const reEscape = (c: string) => c.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&")

/** Split at the first space, like Python's str.partition(" "). */
function partition(s: string): [string, string] {
  const i = s.indexOf(" ")
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)]
}

interface Template {
  mnemonic: string
  rx: RegExp
  names: Set<string>
}

/** 'lw {rd}, {imm_i}({rs1})' -> mnemonic 'lw' and a regex matching the operand text. */
function compileTemplate(template: string): Template {
  const [mn, rest] = partition(template.trim())
  let rx = ""
  const names = new Set<string>()
  for (const piece of rest.trim().split(/(\{\w+\})/)) {
    const m = /^\{(\w+)\}$/.exec(piece)
    if (m) {
      if (names.has(m[1])) throw new AsmError(`assembly template '${template}' uses {${m[1]}} twice`)
      names.add(m[1])
      rx += `(?<${m[1]}>.+?)`
    } else for (const c of piece) if (!/\s/.test(c)) rx += "\\s*" + reEscape(c) + "\\s*"
  }
  try {
    return { mnemonic: mn.toLowerCase(), rx: new RegExp(`^(?:${rx})$`), names }
  } catch {
    throw new AsmError(`assembly template '${template}' has an operand name that is not a valid identifier`)
  }
}

type Table = Record<string, unknown>
interface Operand {
  name: string
  kind: string
  file?: string
  pc_relative?: boolean
}
interface InsnRec {
  name: string
  format: string
  assembly: string
  fixed: [string, string][]
  operands: Operand[]
}
interface Imm {
  bits: bigint
  signed: boolean
  zeros: bigint
  parts: { field: string; dst_lsb: bigint }[]
}
interface Pseudo {
  assembly: string
  expands_to: string[]
}

export interface Isa {
  variable: boolean
  /** Instruction size for fixed-width ISAs; null when each format has its own width. */
  ibytes: number | null
  fmtBytes: Map<string, number>
  /** Comment markers in effect: '#', ';' and '//' minus any used in an assembly template. */
  comments: string[]
  endian: "little" | "big"
  xlen: bigint
  align: bigint
  resetPc: bigint
  formats: Map<string, Map<string, [number, number]>>
  imms: Map<string, Imm>
  regs: Map<string, Map<string, number>>
  insns: Map<string, [InsnRec, Template][]>
  pseudos: Map<string, [Pseudo, Template][]>
}

const big = (v: unknown, what: string): bigint => {
  if (typeof v === "bigint") return v
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v)
  throw new AsmError(`${what} must be an integer`)
}
const list = (v: unknown, what: string): Table[] => {
  if (v === undefined) return []
  if (!Array.isArray(v)) throw new AsmError(`${what} must be an array of tables`)
  return v as Table[]
}
const str = (v: unknown, what: string): string => {
  if (typeof v !== "string") throw new AsmError(`${what} must be a string`)
  return v
}

/** Build assembler tables from a parsed ISA document (the object a TOML parser returns). */
export function buildIsa(d: Table, endian?: "little" | "big"): Isa {
  const isa = d.isa as Table | undefined
  if (!isa || typeof isa !== "object") throw new AsmError("missing [isa] section")
  const mode = isa.instruction_width ?? "fixed"
  if (mode !== "fixed" && mode !== "variable") throw new AsmError(`instruction_width must be "fixed" or "variable", not '${mode}'`)
  const variable = mode === "variable"
  let ibytes: number | null = null
  if (!variable) {
    const ibits = big(isa.instruction_bits, "isa.instruction_bits")
    if (ibits % 8n) throw new AsmError("instruction_bits must be a whole number of bytes")
    ibytes = Number(ibits / 8n)
  }

  const formats = new Map<string, Map<string, [number, number]>>()
  const fmtBytes = new Map<string, number>()
  for (const f of list(d.format, "[[format]]")) {
    const w = variable ? (f.width ?? isa.instruction_bits) : isa.instruction_bits
    if ((typeof w !== "bigint" && !(typeof w === "number" && Number.isInteger(w))) || BigInt(w) <= 0n || BigInt(w) % 8n)
      throw new AsmError(`format ${f.name}: width must be a whole number of bytes`)
    fmtBytes.set(str(f.name, "format name"), Number(BigInt(w) / 8n))
    const fields = new Map<string, [number, number]>()
    for (const fl of list(f.field, `format ${f.name}.field`)) {
      const b = fl.bits as unknown[]
      if (!Array.isArray(b) || b.length !== 2) throw new AsmError(`format ${f.name}.${fl.name}: bits must be [msb, lsb]`)
      fields.set(str(fl.name, "field name"), [Number(big(b[0], "bit")), Number(big(b[1], "bit"))])
    }
    formats.set(str(f.name, "format name"), fields)
  }

  const imms = new Map<string, Imm>()
  for (const i of list(d.immediate, "[[immediate]]")) {
    imms.set(str(i.name, "immediate name"), {
      bits: big(i.bits, `immediate ${i.name}.bits`),
      signed: !!i.signed,
      zeros: i.implicit_zero_bits === undefined ? 0n : big(i.implicit_zero_bits, `immediate ${i.name}.implicit_zero_bits`),
      parts: list(i.parts, `immediate ${i.name}.parts`).map((p) => ({
        field: str(p.field, "part field"),
        dst_lsb: big(p.dst_lsb, `immediate ${i.name}.dst_lsb`),
      })),
    })
  }

  const regs = new Map<string, Map<string, number>>()
  for (const rf of list(d.register_file, "[[register_file]]")) {
    const names = new Map<string, number>()
    for (const key of ["names", "abi_names"]) {
      const arr = (rf[key] ?? []) as unknown[]
      if (!Array.isArray(arr)) throw new AsmError(`register_file ${rf.name}.${key} must be an array`)
      arr.forEach((n, i) => names.set(str(n, "register name").toLowerCase(), i))
    }
    regs.set(str(rf.name, "register file name"), names)
  }

  const insns = new Map<string, [InsnRec, Template][]>()
  for (const ins of list(d.instruction, "[[instruction]]")) {
    const enc = (ins.encoding ?? {}) as Table
    const rec: InsnRec = {
      name: str(ins.name, "instruction name"),
      format: str(ins.format, `instruction ${ins.name}.format`),
      assembly: str(ins.assembly, `instruction ${ins.name}.assembly`),
      fixed: Object.entries((enc.fixed ?? {}) as Record<string, unknown>).map(([k, v]) => [k, str(v, `${ins.name}.encoding.fixed.${k}`)]),
      operands: list(ins.operands, `instruction ${ins.name}.operands`) as unknown as Operand[],
    }
    const t = compileTemplate(rec.assembly)
    if (!insns.has(t.mnemonic)) insns.set(t.mnemonic, [])
    insns.get(t.mnemonic)!.push([rec, t])
  }

  const templates = [...insns.values()].flat().map(([r]) => r.assembly)
  const pseudos = new Map<string, [Pseudo, Template][]>()
  for (const p of list(d.pseudo_instruction, "[[pseudo_instruction]]")) {
    const rec: Pseudo = {
      assembly: str(p.assembly, `pseudo_instruction ${p.name}.assembly`),
      expands_to: ((p.expands_to ?? []) as unknown[]).map((x) => str(x, `pseudo_instruction ${p.name}.expands_to`)),
    }
    const t = compileTemplate(rec.assembly)
    if (!pseudos.has(t.mnemonic)) pseudos.set(t.mnemonic, [])
    pseudos.get(t.mnemonic)!.push([rec, t])
  }

  templates.push(...[...pseudos.values()].flat().map(([p]) => p.assembly))
  return {
    variable,
    ibytes,
    fmtBytes,
    comments: ["#", ";", "//"].filter((c) => !templates.some((t) => t.includes(c))),
    endian: endian ?? (isa.endianness === "big" ? "big" : "little"),
    xlen: isa.xlen === undefined ? 32n : big(isa.xlen, "isa.xlen"),
    align: isa.fetch_alignment === undefined ? BigInt(ibytes ?? 1) : big(isa.fetch_alignment, "isa.fetch_alignment"),
    resetPc: isa.reset_pc === undefined ? 0n : big(isa.reset_pc, "isa.reset_pc"),
    formats,
    imms,
    regs,
    insns,
    pseudos,
  }
}

/** Parse ISA TOML text and build assembler tables. Throws AsmError with a readable message. */
export function loadIsa(toml: string, endian?: "little" | "big"): Isa {
  let doc: Table
  try {
    doc = parse(toml, { integersAsBigInt: true }) as Table
  } catch (e) {
    throw new AsmError(e instanceof TomlError ? `TOML: ${e.message}` : String(e))
  }
  return buildIsa(doc, endian)
}

/** Resolve pseudo-instructions textually. Returns [mnemonic, operandText] pairs. */
function expand(isa: Isa, mnemonic: string, ops: string, depth = 0): [string, string][] {
  if (depth > 8) throw new AsmError(`pseudo-instruction '${mnemonic}' expands too deeply`)
  if ((isa.insns.get(mnemonic) ?? []).some(([, t]) => t.rx.test(ops))) return [[mnemonic, ops]]
  for (const [p, t] of isa.pseudos.get(mnemonic) ?? []) {
    const m = t.rx.exec(ops)
    if (!m) continue
    const out: [string, string][] = []
    for (const line of p.expands_to) {
      const text = line.replace(/\{(\w+)\}/g, (_, k: string) => {
        const v = m.groups?.[k]
        if (v === undefined) throw new AsmError(`pseudo-instruction '${p.assembly}': {${k}} in its expansion is not in its template`)
        return v.trim()
      })
      const [mn, rest] = partition(text.trim())
      out.push(...expand(isa, mn.toLowerCase(), rest.trim(), depth + 1))
    }
    return out
  }
  const forms = [...(isa.insns.get(mnemonic) ?? []), ...(isa.pseudos.get(mnemonic) ?? [])].map(([r]) => `'${r.assembly}'`)
  if (forms.length) throw new AsmError(`operands '${ops}' don't fit ${forms.join(" or ")}`)
  throw new AsmError(`unknown instruction '${mnemonic}'`)
}

function toBytes(v: bigint, n: number, endian: "little" | "big"): Uint8Array {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    out[endian === "little" ? i : n - 1 - i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}

const mask = (w: bigint | number) => (1n << BigInt(w)) - 1n

function encodeOne(isa: Isa, ins: InsnRec, t: Template, m: RegExpExecArray, pc: bigint, syms: Map<string, bigint>): Uint8Array {
  const fields = isa.formats.get(ins.format)
  if (!fields) throw new AsmError(`${ins.name}: unknown format ${ins.format}`)
  let word = 0n
  const put = (field: string, value: bigint) => {
    const f = fields.get(field)
    if (!f) throw new AsmError(`${ins.name}: field ${field} is not in format ${ins.format}`)
    const [hi, lo] = f
    word |= (value & mask(hi - lo + 1)) << BigInt(lo)
  }

  for (const [field, bits] of ins.fixed) put(field, BigInt("0b" + (bits || "0")))
  for (const op of ins.operands) {
    const name = op.name
    if (!t.names.has(name)) throw new AsmError(`${ins.name}: operand ${name} does not appear in its assembly template`)
    const text = m.groups![name].trim()
    if (op.kind === "reg") {
      const idx = isa.regs.get(op.file ?? "")?.get(text.toLowerCase())
      if (idx === undefined) throw new AsmError(`'${text}' is not a register in file ${op.file}`)
      put(name, BigInt(idx))
      continue
    }
    const im = isa.imms.get(name)
    if (!im) throw new AsmError(`${ins.name}: no [[immediate]] named ${name}`)
    let value = evaluate(text, syms, pc)
    let what = name
    if (op.pc_relative) {
      value -= pc
      what = `${name} (offset to target)`
    }
    const { bits, zeros } = im
    let lo: bigint, hi: bigint
    if (im.signed) {
      lo = -(1n << (bits - 1n))
      hi = (1n << (bits - 1n)) - 1n
    } else {
      // a full-width unsigned immediate may also be written as a negative number
      lo = bits >= isa.xlen ? -(1n << (bits - 1n)) : 0n
      hi = (1n << bits) - 1n
    }
    if (value < lo || value > hi) throw new AsmError(`${what} = ${value} is out of range [${lo}, ${hi}]`)
    if (value & mask(zeros)) throw new AsmError(`${what} = ${value} must be a multiple of ${1n << zeros}`)
    value &= mask(bits)
    for (const part of im.parts) put(part.field, value >> part.dst_lsb)
  }
  return toBytes(word, sizeOf(isa, ins), isa.endian)
}

const sizeOf = (isa: Isa, ins: InsnRec) => {
  const n = isa.fmtBytes.get(ins.format)
  if (n === undefined) throw new AsmError(`${ins.name}: unknown format ${ins.format}`)
  return n
}

/** Byte size for this instruction, decided in pass 1 when only earlier symbols are known. */
function chooseSize(isa: Isa, mnemonic: string, ops: string, pc: bigint, syms: Map<string, bigint>): number {
  const cands: [InsnRec, Template, RegExpExecArray][] = []
  for (const [ins, t] of isa.insns.get(mnemonic) ?? []) {
    const m = t.rx.exec(ops)
    if (m) cands.push([ins, t, m])
  }
  const sizes = new Set(cands.map(([ins]) => sizeOf(isa, ins)))
  if (sizes.size === 1) return [...sizes][0]
  for (const [ins, t, m] of cands) {
    try {
      encodeOne(isa, ins, t, m, pc, syms)
      return sizeOf(isa, ins)
    } catch (e) {
      if (e instanceof Undefined) return Math.max(...sizes) // refers to a later symbol: leave room for the largest form
      if (!(e instanceof AsmError)) throw e
    }
  }
  return sizeOf(isa, cands[0][0]) // nothing fits; pass 2 reports why
}

function encode(isa: Isa, mnemonic: string, ops: string, pc: bigint, syms: Map<string, bigint>, size: number): Uint8Array {
  let first: AsmError | null = null
  for (const [ins, t] of isa.insns.get(mnemonic) ?? []) {
    const m = t.rx.exec(ops)
    if (!m || sizeOf(isa, ins) !== size) continue
    try {
      return encodeOne(isa, ins, t, m, pc, syms)
    } catch (e) {
      if (e instanceof Undefined || !(e instanceof AsmError)) throw e
      first ??= e
    }
  }
  throw first ?? new AsmError(`operands '${ops}' don't fit '${mnemonic}'`)
}

/* ---------- source parsing ---------- */

function stripComment(line: string, comments: string[]): string {
  let out = "",
    quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      out += c
      if (c === "\\" && i + 1 < line.length) out += line[++i]
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
      out += c
    } else if (comments.some((k) => line.startsWith(k, i))) break
    else out += c
  }
  return out.trim()
}

function splitArgs(text: string): string[] {
  const args: string[] = []
  let cur = "",
    quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      cur += c
      if (c === "\\" && i + 1 < text.length) cur += text[++i]
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
      cur += c
    } else if (c === ",") {
      args.push(cur.trim())
      cur = ""
    } else cur += c
  }
  if (cur.trim() || args.length) args.push(cur.trim())
  return args
}

const LABEL = /^([A-Za-z_.$][\w.$]*)\s*:(?!=)/
const SYMBOL = /^[A-Za-z_.$][\w.$]*$/
const DATA: Record<string, number> = { ".byte": 1, ".half": 2, ".short": 2, ".word": 4, ".long": 4, ".dword": 8, ".quad": 8 }
const IGNORED = new Set([".text", ".globl", ".global"])
const SECTIONS = new Set([".data", ".bss", ".section", ".rodata"])
/** The browser keeps the whole image in memory; refuse anything bigger than this. */
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024

export type ItemKind = "insn" | "fill" | "bytes" | "data"

/** One placed thing in the image: an instruction, data values, padding or raw bytes. */
export interface Item {
  line: number
  source: string
  addr: bigint
  kind: ItemKind
  size: number
  bytes: Uint8Array
  /** insn: [mnemonic, operands]; data: [size, args]; fill: byte; bytes: data */
  payload: unknown
}

export interface AsmProblem {
  line: number
  message: string
  source: string
}

export interface AsmResult {
  image: Uint8Array
  base: bigint
  items: Item[]
  errors: AsmProblem[]
  symbols: Map<string, bigint>
}

export const hex = (v: bigint) => (v < 0n ? "-0x" + (-v).toString(16) : "0x" + v.toString(16))

/**
 * Assemble `source` for `isa`. Never throws for problems in the source; they
 * come back in `errors`, sorted by line. `image` is only meaningful when
 * `errors` is empty.
 */
export function assemble(isa: Isa, source: string, base?: bigint): AsmResult {
  const errors: AsmProblem[] = [],
    items: Item[] = [],
    syms = new Map<string, bigint>(),
    startLabels: string[] = []
  let addr = base ?? isa.resetPc
  let imageBase = addr
  const baseFixed = base !== undefined

  const hereExpr = (text: string) => {
    try {
      return evaluate(text, syms, addr)
    } catch (e) {
      if (e instanceof Undefined) throw new AsmError(`${e.message} (must be defined before this line)`)
      throw e
    }
  }
  const place = (it: Omit<Item, "bytes">) => {
    if (addr + BigInt(it.size) - imageBase > BigInt(MAX_IMAGE_BYTES))
      throw new AsmError(`the image would be larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MiB`)
    items.push({ ...it, bytes: new Uint8Array() })
    addr += BigInt(it.size)
  }

  const lines = source.split(/\r\n|\r|\n/)
  if (lines.length && lines[lines.length - 1] === "") lines.pop()

  // Pass 1: lay out addresses, define labels, expand pseudo-instructions.
  lines.forEach((raw, idx) => {
    const lineno = idx + 1
    let line = stripComment(raw, isa.comments)
    try {
      let m: RegExpExecArray | null
      while ((m = LABEL.exec(line))) {
        const name = m[1]
        if (syms.has(name)) throw new AsmError(`symbol '${name}' defined twice`)
        syms.set(name, addr)
        if (!items.length) startLabels.push(name)
        line = line.slice(m[0].length).trim()
      }
      if (!line) return
      let [word, rest] = partition(line)
      const tab = word.indexOf("\t")
      if (tab >= 0) {
        rest = word.slice(tab + 1) + " " + rest
        word = word.slice(0, tab)
      }
      word = word.toLowerCase()
      rest = rest.trim()

      if (word.startsWith(".")) {
        const args = splitArgs(rest)
        if (IGNORED.has(word)) return
        if (word === ".equ" || word === ".set") {
          if (args.length !== 2 || !SYMBOL.test(args[0])) throw new AsmError(`usage: ${word} NAME, EXPR`)
          if (syms.has(args[0])) throw new AsmError(`symbol '${args[0]}' defined twice`)
          syms.set(args[0], hereExpr(args[1]))
        } else if (word === ".org") {
          const target = hereExpr(rest)
          if (!items.length && !baseFixed) {
            imageBase = addr = target
            for (const name of startLabels) syms.set(name, target) // labels above the first .org move with it
          } else if (target < addr) throw new AsmError(`.org ${hex(target)} is behind the current address ${hex(addr)}`)
          else place({ line: lineno, source: raw, addr, kind: "fill", payload: 0, size: Number(target - addr) })
        } else if (word === ".align") {
          const n = hereExpr(rest)
          if (n <= 0n) throw new AsmError(".align needs a positive byte count")
          const pad = (((-addr) % n) + n) % n
          if (pad) place({ line: lineno, source: raw, addr, kind: "fill", payload: 0, size: Number(pad) })
        } else if (word === ".space" || word === ".zero") {
          if (args.length !== 1 && args.length !== 2) throw new AsmError(`usage: ${word} N[, FILL]`)
          const n = hereExpr(args[0])
          const fill = args.length === 2 ? hereExpr(args[1]) : 0n
          if (n < 0n || fill < 0n || fill > 255n) throw new AsmError(`${word}: bad size or fill byte`)
          if (n > BigInt(MAX_IMAGE_BYTES)) throw new AsmError(`the image would be larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MiB`)
          place({ line: lineno, source: raw, addr, kind: "fill", payload: Number(fill), size: Number(n) })
        } else if (word in DATA) {
          if (!args.length || args.includes("")) throw new AsmError(`${word} needs one or more comma-separated values`)
          const size = DATA[word]
          place({ line: lineno, source: raw, addr, kind: "data", payload: [size, args], size: size * args.length })
        } else if (word === ".ascii" || word === ".asciz" || word === ".string") {
          const enc = new TextEncoder()
          const chunks: number[] = []
          for (const a of args) {
            if (!(a.length >= 2 && a[0] === '"' && a[a.length - 1] === '"')) throw new AsmError(`${word} expects double-quoted strings`)
            chunks.push(...enc.encode(unquote(a)))
            if (word !== ".ascii") chunks.push(0)
          }
          place({ line: lineno, source: raw, addr, kind: "bytes", payload: Uint8Array.from(chunks), size: chunks.length })
        } else if (SECTIONS.has(word)) throw new AsmError(`${word}: sections are not supported; the output is one flat image`)
        else throw new AsmError(`unknown directive '${word}'`)
        return
      }

      const expansion = expand(isa, word, rest)
      for (const [mn, ops] of expansion) {
        if (addr % isa.align) throw new AsmError(`instruction at ${hex(addr)} is not ${isa.align}-byte aligned (add .align ${isa.align})`)
        const shown = expansion.length === 1 && mn === word ? raw : `${mn} ${ops}`.trim() + `    ; ${line}`
        place({ line: lineno, source: shown, addr, kind: "insn", payload: [mn, ops], size: chooseSize(isa, mn, ops, addr, syms) })
      }
    } catch (e) {
      if (!(e instanceof AsmError)) throw e
      errors.push({ line: lineno, message: e.message, source: raw.trim() })
    }
  })

  // Pass 2: evaluate operands and encode.
  for (const it of items) {
    try {
      if (it.kind === "insn") {
        const [mn, ops] = it.payload as [string, string]
        it.bytes = encode(isa, mn, ops, it.addr, syms, it.size)
      } else if (it.kind === "fill") it.bytes = new Uint8Array(it.size).fill(it.payload as number)
      else if (it.kind === "bytes") it.bytes = it.payload as Uint8Array
      else {
        const [size, args] = it.payload as [number, string[]]
        const out = new Uint8Array(size * args.length)
        args.forEach((a, k) => {
          const v = evaluate(a, syms, it.addr + BigInt(k * size))
          const bits = BigInt(size * 8)
          if (v < -(1n << (bits - 1n)) || v >= 1n << bits) throw new AsmError(`value ${v} does not fit in ${size} byte(s)`)
          out.set(toBytes(v & mask(bits), size, isa.endian), k * size)
        })
        it.bytes = out
      }
    } catch (e) {
      if (!(e instanceof AsmError)) throw e
      it.bytes = new Uint8Array()
      errors.push({ line: it.line, message: e.message, source: it.source.trim() })
    }
  }

  errors.sort((a, b) => a.line - b.line)
  const image = new Uint8Array(items.reduce((n, it) => n + it.bytes.length, 0))
  let off = 0
  for (const it of items) {
    image.set(it.bytes, off)
    off += it.bytes.length
  }
  return { image, base: imageBase, items, errors, symbols: syms }
}

/* ---------- text output (same format as asm.py) ---------- */

const bytesHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ")
const addrHex = (v: bigint) => v.toString(16).padStart(8, "0")

export interface ListingRow {
  addr: bigint
  bytes: string
  source: string
  line: number
}

/** One row per instruction, per 8 data bytes, or per large fill. */
export function listingRows(items: Item[]): ListingRow[] {
  const rows: ListingRow[] = []
  for (const it of items) {
    if (it.kind === "fill" && it.size > 8) {
      rows.push({ addr: it.addr, bytes: `(${it.size} bytes of 0x${(it.payload as number).toString(16).padStart(2, "0")})`, source: "", line: it.line })
      continue
    }
    const chunk = it.kind === "insn" ? it.size : 8
    for (let o = 0; o < Math.max(it.bytes.length, 1); o += chunk)
      rows.push({ addr: it.addr + BigInt(o), bytes: bytesHex(it.bytes.slice(o, o + chunk)), source: o === 0 ? it.source.trim() : "", line: it.line })
  }
  return rows
}

export function listing(items: Item[]): string {
  return listingRows(items)
    .map((r) => (r.bytes.startsWith("(") ? `${addrHex(r.addr)}  ${r.bytes}` : `${addrHex(r.addr)}  ${r.bytes.padEnd(23)}  ${r.source}`.trimEnd()))
    .join("\n")
}

export const formatErrors = (errors: AsmProblem[]) => errors.map((e) => `line ${e.line}: ${e.message}\n    ${e.source}`).join("\n")
