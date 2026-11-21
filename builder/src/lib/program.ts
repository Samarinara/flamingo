/* Settings and starter program for the Assemble tab. */

export interface AsmSettings {
  /** Assemble for the ISA being edited, or for a TOML file pasted or opened here. */
  mode: "builder" | "toml"
  toml: string
  source: string
  /** Address of the first byte, as typed; empty means the ISA's reset_pc or the first .org. */
  base: string
  /** Name of the opened source file, used for the download. */
  fileName: string
}

export const EXAMPLE_SOURCE = `# Sum the words in \`table\` into a0, store the sum in \`result\`, then spin.
# Written for the tiny32 example; edit freely. Assembles as you type.
        .equ    COUNT, 4

start:  addi    t0, zero, table     # t0 = address of table
        addi    t1, zero, COUNT     # t1 = words left
        mv      a0, zero            # a0 = running sum
loop:   lw      t2, 0(t0)
        add     a0, a0, t2
        addi    t0, t0, 4
        addi    t1, t1, -1
        beq     t1, zero, done
        j       loop
done:   sw      a0, 0(t0)           # t0 now points at result
        j       .                   # spin forever

table:  .word   10, 20, 30, 40
result: .word   0
`

export const EXAMPLE8_SOURCE = `; Count down from 5, writing each value to an output port, then halt.
; Written for the tiny8 example (8-bit, variable-length); edit freely.
        .org    0x0200
        .equ    PORT, 0xf0      ; output port in the zero page

start:  lda     #5
loop:   sta     PORT            ; known and < 0x100: 2-byte zero-page form
        dec                     ; pseudo-instruction for sub #1
        bne     loop
        sta     done            ; defined later: 3-byte absolute form
        jsr     show
        hlt

show:   lda     message         ; above 0xff: absolute form
        ret

done:   .byte   0
message: .ascii "hi"
`

/** Starter program for an ISA, chosen by its name. */
export const exampleFor = (isaName: string) => (isaName === "tiny8" ? EXAMPLE8_SOURCE : EXAMPLE_SOURCE)
export const isExample = (source: string) => source === EXAMPLE_SOURCE || source === EXAMPLE8_SOURCE

export const defaultAsmSettings = (): AsmSettings => ({ mode: "builder", toml: "", source: EXAMPLE_SOURCE, base: "", fileName: "" })
