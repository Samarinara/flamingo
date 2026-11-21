# flamingo

Tools for describing an instruction set architecture (ISA) in a single TOML file.

- `isa-template.toml` is the schema, with a worked example ISA ("tiny32"). Every section is commented.
- `tools/validate_isa.py` checks an ISA file: format fields tile the instruction word, immediates assemble every bit once, no two instructions share an encoding, and all cross-references resolve.
- `builder/` is a React + shadcn/ui app for entering an ISA through forms and copying out the TOML. It checks formats for bit gaps and overlapping encodings as you type.

## Validate a spec

```
python3 -I tools/validate_isa.py isa-template.toml
```

Requires Python 3.11 or newer (uses `tomllib`).

## Run the builder

```
cd builder
npm install
npm run dev      # dev server
npm run build    # static site in builder/dist
```

Requires Node 20.19 or newer. The ISA model (validation and TOML output) lives in `builder/src/lib/isa.ts`.
