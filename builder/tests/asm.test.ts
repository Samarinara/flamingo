/*
 * The browser assembler (src/lib/asm.ts) must match tools/asm.py exactly.
 * Each case runs both on the same ISA and source and compares bytes,
 * listing and error text. Run with: npm test (needs python3 >= 3.11).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ROOT, TEMPLATE, same } from "./parity.ts"

test("example program", () => {
  const r = same(TEMPLATE, readFileSync(join(ROOT, "examples/sum.s"), "utf8"))
  assert.equal(r.image.length, 73)
})

test("every instruction format and pseudo-instruction", () => {
  same(
    TEMPLATE,
    `back: add a0, a1, a2
      sub t0, t1, t2 ; c
      and x5, x6, x7 // c
      mul a0, a0, a1
      addi a0, sp, 16
      addi a0, a0, -2048
      lw a0, -4(sp)
      lw a0, (4+4)(sp)
      sw ra, -20(s0)
      lui a0, 0x12345000
      lui a0, -4096
      beq a0, a1, back
      beq a0, a1, fwd
      jal ra, fwd
      nop
      mv a0, a1
fwd:  j .
      j back`,
  )
})

test("directives, expressions and symbols", () => {
  same(
    TEMPLATE,
    `top: .org 0x100
      .equ K, (3 << 4) | 1
      .set NEG, -7 / 2
x:    .word x, 0xdead_beef, K, NEG, NEG % 3, ~0, 'A', '\\n', . - top
      .byte 1, -1, 255, 0b1010, 0o17
      .half 0xffff, -32768
      .dword 0x0123456789abcdef, -1
      .ascii "a\\tb", "\\x41\\101"
      .asciz "done", ""
      .string "é"
      .align 8
      .space 3, 0xaa
      .zero 20
      .align 4
      .text
      .globl main
main: addi a0, a0, K
      .org 0x200
end:`,
  )
  same(TEMPLATE, ".org 0x40\nnop", "0x10")
  same(TEMPLATE, "nop\n.word 1, 2\n", "0x80000000")
})

test("errors match, with line numbers", () => {
  same(TEMPLATE, "addi a0, a0, 2048\nbeq a0, a1, 3\nadd a0, a1, q9\nfrob a0\nadd a0, a1\nj nowhere\nx: nop\nx: nop")
  same(TEMPLATE, ".byte 1\nnop\n.word 1\n.org 0\n.equ A\n.space -1\n.align 0\n.data\n.bogus\n.word\n.ascii 'x'\n.byte 256\n.equ B, later\nlater:")
  same(TEMPLATE, "addi a0, a0, 1/0\naddi a0, a0, (1\naddi a0, a0, 1 2\naddi a0, a0, 1 << -1\naddi a0, a0, 'ab'\naddi a0, a0, @")
})

test("big-endian and 64-bit values", () => {
  const big = TEMPLATE.replace('endianness        = "little"', 'endianness        = "big"')
  same(big, "add a0, a1, a2\n.half 0x1234\n.dword 0x0102030405060708")
})

const TINY8 = readFileSync(join(ROOT, "examples/tiny8.toml"), "utf8")

test("8-bit: variable-length tiny8 example", () => {
  const r = same(TINY8, readFileSync(join(ROOT, "examples/count8.s"), "utf8"))
  assert.equal(r.image.length, 22)
  assert.equal(r.base, 0x200n)
})

test("8-bit: zero-page vs absolute form choice, # immediates, comments", () => {
  const r = same(TINY8, "lda #5 ; c\nlda 0x10\nlda 0x1234\nlda later // c\nsta .\nadd #0xff\nsub #-1\nclr\nhlt\nlater: .byte 9")
  assert.deepEqual(r.items.map((it) => it.size), [2, 2, 3, 3, 3, 2, 2, 2, 1, 1])
  same(TINY8, "top: .space 200\nbne top\nlda #256\nlda #-129\nbeq 0x10000\nfrob #1\nlda (1")
  same(TINY8, "nop", "0x00")
})

test("8-bit: fixed 8-bit instruction words", () => {
  const sap = TINY8.replace('instruction_width = "variable"', 'instruction_width = "fixed"\ninstruction_bits  = 8')
    .replace(/\[\[format\]\]\nname  = "[IZAB]"[\s\S]*?(?=\n\[\[format\]\]|\n# 8-bit values)/g, "")
    .replace(/\[\[immediate\]\][\s\S]*?(?=\n\[\[immediate\]\]|\n# --- instructions)/g, "")
    .replace(/\[\[instruction\]\]\nname      = "\w+"\nextension = "base"\nformat    = "[IZAB]"[\s\S]*?\n\n/g, "")
    .replace(/\[\[pseudo_instruction\]\][\s\S]*$/, "")
  const r = same(sap, "nop\nhlt\nret\n.byte 0xaa")
  assert.equal(Buffer.from(r.image).toString("hex"), "000102aa")
})
