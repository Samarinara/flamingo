# flamingo

Tools for describing an instruction set architecture (ISA) in a single TOML file.

- `isa-template.toml` is the schema, with a worked example ISA ("tiny32"). Every section is commented.
- `tools/validate_isa.py` checks an ISA file: format fields tile the instruction word, immediates assemble every bit once, no two instructions share an encoding, and all cross-references resolve.
- `tools/asm.py` assembles a source file into a flat binary for whatever ISA the TOML describes.
- `builder/` is a React + shadcn/ui app for entering an ISA through forms and copying out the TOML. It checks formats for bit gaps and overlapping encodings as you type. Its Assemble tab runs the same assembler in the browser, for the ISA being edited or for any pasted TOML file, and downloads the `.bin`.

## Validate a spec

```
python3 -I tools/validate_isa.py isa-template.toml
```

Requires Python 3.11 or newer (uses `tomllib`).

## Assemble a program

```
python3 -I tools/asm.py isa-template.toml examples/sum.s -o sum.bin --listing
```

All the instruction-specific information comes from the TOML: mnemonics and operand syntax (`assembly`), register names, field positions, immediate layout, fixed opcode bits, pseudo-instructions and byte order. The assembler makes two passes, so labels can be used before they are defined. It writes a raw image whose first byte is at `isa.reset_pc`, the first `.org`, or `--base`. Every error is reported with its line number.

Source syntax: `label:`, comments with `#` `;` or `//` (except a marker an assembly template uses, so `lda #5` works), expressions over numbers, labels and `.` (the current address), and the directives `.org .align .space .byte .half .word .dword .ascii .asciz .equ`. See the header of `tools/asm.py` for details. Two conventions worth knowing:

- For a `pc_relative` operand you write the **target** (normally a label), and the assembler encodes `target - pc`.
- An immediate operand is the **assembled value** that `[[immediate]]` describes. For tiny32's `lui` that means `lui a0, 0x12345000`, not `0x12345`.

It does not support sections, object files or relocations.

### 8-bit and variable-length ISAs

Instruction words can be any whole number of bytes, including 8 bits. For CPUs where instructions take different numbers of bytes (an opcode byte, then operand bytes), set `instruction_width = "variable"` and give each format its own `width`. If one mnemonic has forms of different sizes, such as a 2-byte zero-page `lda` and a 3-byte absolute `lda` (instruction names `lda_zp` and `lda_abs`, both with templates starting `lda`), the assembler uses the first form the operand fits. An operand that refers to a label defined later always gets the largest form.

`examples/tiny8.toml` is a worked 8-bit example (accumulator, 16-bit addresses, 1-3 byte instructions), and `examples/count8.s` is a program for it:

```
python3 -I tools/asm.py examples/tiny8.toml examples/count8.s --listing
```

In a variable-length ISA, `validate_isa.py` and the builder compare encodings from their first byte in memory. A short instruction must therefore differ from the start of every longer one, so a decoder can tell instructions apart byte by byte. With little-endian byte order, keep the opcode in bits [7:0] of each format.

Run the tests with `python3 -I -m unittest discover -s tools -p 'test_*.py'`.

## Run the builder

```
cd builder
npm install
npm run dev      # dev server
npm run build    # static site in builder/dist
npm test         # needs Node 22.18+ and python3
```

Requires Node 20.19 or newer. The ISA model (validation and TOML output) lives in `builder/src/lib/isa.ts`. The TOML it produces passes `validate_isa.py` and assembles with `tools/asm.py`.

The browser assembler, `builder/src/lib/asm.ts`, is a port of `tools/asm.py`. Change both together. `npm test` runs both on the same inputs and fails if their bytes, listings or error messages differ. In the browser the image is capped at 64 MiB.
