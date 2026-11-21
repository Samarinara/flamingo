/* The builder's TOML must be accepted by tools/validate_isa.py and by both assemblers. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { empty, example, example8, syncAll, toml, validate, type IsaState } from "../src/lib/isa.ts"
import { EXAMPLE_SOURCE, EXAMPLE8_SOURCE } from "../src/lib/program.ts"
import { assemble, loadIsa } from "../src/lib/asm.ts"
import { readFileSync } from "node:fs"
import { ROOT, same } from "./parity.ts"

const dir = mkdtempSync(join(tmpdir(), "builder-"))

function pyValidate(text: string): string {
  const p = join(dir, "isa.toml")
  writeFileSync(p, text)
  try {
    return execFileSync("python3", ["-I", join(ROOT, "tools/validate_isa.py"), p], { encoding: "utf8" }).trim()
  } catch (e) {
    return String((e as { stdout: string }).stdout).trim()
  }
}

test("example ISA has no problems and passes validate_isa.py", () => {
  const S = example()
  assert.deepEqual(validate(S), { errors: [], warnings: [] })
  assert.match(pyValidate(toml(S)), /^OK: 7 instructions, 5 formats, 4 immediates/)
})

test("example program assembles the same in Python and the browser", () => {
  const r = same(toml(example()), EXAMPLE_SOURCE)
  assert.equal(r.errors.length, 0)
  assert.equal(r.image.length, 11 * 4 + 5 * 4)
  // beq t1, zero, done (+8) and j loop (-20), standard RV32I encodings
  const word = (i: number) => Buffer.from(r.image.slice(i * 4, i * 4 + 4)).readUInt32LE()
  assert.equal(word(7), 0x00030463)
  assert.equal(word(8), 0xfedff06f)
})

test("default register names and multiple register files", () => {
  const S = example()
  S.regfiles[0].abi = ""
  S.regfiles.push({ name: "F", count: 4, width: 32, zero: "", names: "", abi: "" })
  S.instructions.push({ name: "fmv", format: "R", assembly: "fmv {rd}, {rs1}, {rs2}", semantics: "", f: {} })
  syncAll(S)
  const f = S.instructions.at(-1)!.f
  f.opcode = { m: "fixed", v: "1010011" }
  f.funct3 = { m: "fixed", v: "000" }
  f.funct7 = { m: "fixed", v: "0000000" }
  f.rd.file = "F"
  f.rs1.file = "F"
  assert.deepEqual(validate(S).errors, [])
  const text = toml(S)
  assert.match(text, /names = \["f0", "f1", "f2", "f3"\]/)
  assert.match(pyValidate(text), /^OK/)
  same(text, "add x10, x11, x12\nfmv f1, f2, x3\nfmv x1, f2, x3")
})

test("immediate mistakes are reported", () => {
  const S = example()
  S.immediates[1].parts.pop() // imm_b loses bit 12
  S.immediates[0].parts.push({ field: "imm_lo", lsb: 3 }) // overlaps
  const errs = validate(S).errors.join("\n")
  assert.match(errs, /Field imm_lo of format S is in both|bit 3 comes from both/)
  const S2 = example()
  S2.immediates[1].zeros = 0
  assert.match(validate(S2).errors.join("\n"), /no field supplies bit 0/)
  const S3 = example()
  S3.instructions.find((i) => i.name === "beq")!.f.imm_b11 = { m: "fixed", v: "0" }
  assert.match(validate(S3).errors.join("\n"), /some fields fixed and some as operands/)
})

test("pseudo-instruction checks", () => {
  const S = example()
  S.pseudos.push({ assembly: "li {rd}, {v}", expands: "addi {rd}, x0, {imm}\nfrob {rd}" })
  const errs = validate(S).errors.join("\n")
  assert.match(errs, /expansion uses \{imm\}/)
  assert.match(errs, /unknown instruction "frob"/)
})

test("old drafts without the new fields still load", () => {
  const old = JSON.parse(JSON.stringify(example())) as Partial<IsaState>
  delete old.immediates
  delete old.pseudos
  old.regfiles!.forEach((r) => delete (r as Partial<typeof r>).names)
  const S = syncAll(old as IsaState)
  assert.deepEqual(S.immediates, [])
  assert.equal(S.regfiles[0].names, "")
  assert.ok(toml(S).includes("[[register_file]]"))
  assert.ok(toml(empty()).includes("[semantics]"))
})

test("8-bit tiny8 example: valid, and matches examples/tiny8.toml byte for byte", () => {
  const S = example8()
  assert.deepEqual(validate(S), { errors: [], warnings: [] })
  const text = toml(S)
  assert.match(text, /xlen = 8\nendianness = "little"\ninstruction_width = "variable"/)
  assert.match(pyValidate(text), /^OK: 15 instructions, 5 formats, 4 immediates/)
  const fromBuilder = same(text, EXAMPLE8_SOURCE)
  assert.deepEqual(fromBuilder.errors, [])
  assert.equal(fromBuilder.base, 0x200n)
  const handWritten = assemble(loadIsa(readFileSync(join(ROOT, "examples/tiny8.toml"), "utf8")), readFileSync(join(ROOT, "examples/count8.s"), "utf8"))
  assert.equal(Buffer.from(fromBuilder.image).toString("hex"), Buffer.from(handWritten.image).toString("hex"))
})

test("8-bit fixed-width ISA from the builder", () => {
  const S = empty()
  S.width = 8
  S.formats.push({ name: "M", fields: [{ name: "op", hi: 7, lo: 4 }, { name: "addr", hi: 3, lo: 0 }] })
  S.immediates.push({ name: "addr", format: "M", signed: false, zeros: 0, pcrel: false, parts: [{ field: "addr", lsb: 0 }] })
  S.instructions.push({ name: "lda", format: "M", assembly: "lda {addr}", semantics: "", f: { op: { m: "fixed", v: "0001" } } })
  S.instructions.push({ name: "ldi", format: "M", assembly: "ldi #{addr}", semantics: "", f: { op: { m: "fixed", v: "0101" } } })
  syncAll(S)
  assert.deepEqual(validate(S).errors, [])
  const text = toml(S)
  assert.match(text, /xlen = 8\n[\s\S]*instruction_bits = 8/)
  assert.match(pyValidate(text), /^OK/)
  const r = same(text, "lda 14\nldi #3\nlda x\nx: .byte 7\nlda 16")
  assert.equal(r.errors[0]?.message, "addr = 16 is out of range [0, 15]")
})

test("variable-length overlap: a short opcode must not prefix a longer one", () => {
  const S = example8()
  S.instructions.find((i) => i.name === "lda_imm")!.f.opcode.v = "00000001" // same first byte as hlt
  assert.match(validate(S).errors.join("\n"), /Encodings of hlt and lda_imm overlap: the start of the longer one/)
  // Big-endian puts the low byte last in memory, so an opcode there cannot tell the decoder the length...
  const B = example8()
  B.endianness = "big"
  assert.match(validate(B).errors.join("\n"), /the start of the longer one can be read as the shorter one/)
  // ...but with the opcode in each format's top byte (first in memory) every instruction is distinct.
  B.formats.forEach((fm) => {
    const w = fm.width as number
    fm.fields.forEach((f) => Object.assign(f, f.name === "opcode" ? { hi: w - 1, lo: w - 8 } : { hi: w - 9, lo: 0 }))
  })
  assert.deepEqual(validate(B).errors, [])
  assert.match(pyValidate(toml(B)), /^OK/)
  same(toml(B), "lda #5\nlda 0x1234\nbne .")
})

test("widths: per-format in variable mode, whole bytes only", () => {
  const S = example8()
  S.formats[0].width = 12
  assert.match(validate(S).errors.join("\n"), /Format N: width must be 8 to 64 bits, in whole bytes/)
  const F = example8()
  F.variable = false
  F.width = 16
  assert.match(validate(F).errors.join("\n"), /Format N: bits 15:8 belong to no field/)
})
