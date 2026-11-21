# flamingo

Tools for describing an instruction set architecture (ISA) in a single TOML file.

- `isa-template.toml` is the schema, with a worked example ISA ("tiny32"). Every section is commented.
- `tools/validate_isa.py` checks an ISA file: format fields tile the instruction word, immediates assemble every bit once, no two instructions share an encoding, and all cross-references resolve.
- `tools/asm.py` assembles a source file into a flat binary for whatever ISA the TOML describes.
- `builder/` is a React + shadcn/ui app for entering an ISA through forms and copying out the TOML. It checks formats for bit gaps and overlapping encodings as you type.

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

Source syntax: `label:`, comments with `#` `;` or `//`, expressions over numbers, labels and `.` (the current address), and the directives `.org .align .space .byte .half .word .dword .ascii .asciz .equ`. See the header of `tools/asm.py` for details. Two conventions worth knowing:

- For a `pc_relative` operand you write the **target** (normally a label), and the assembler encodes `target - pc`.
- An immediate operand is the **assembled value** that `[[immediate]]` describes. For tiny32's `lui` that means `lui a0, 0x12345000`, not `0x12345`.

It does not yet support variable-length ISAs, sections, object files or relocations.

Run the tests with `python3 -I -m unittest discover -s tools -p 'test_*.py'`.

## Run the builder

```
cd builder
npm install
npm run dev      # dev server
npm run build    # static site in builder/dist
```

Requires Node 20.19 or newer. The ISA model (validation and TOML output) lives in `builder/src/lib/isa.ts`.
