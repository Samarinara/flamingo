# flamingo

Tools for describing an instruction set architecture (ISA) in a single TOML file.

- `isa-template.toml` is the schema, with a worked example ISA ("tiny32"). Every section is commented.
- `tools/validate_isa.py` checks an ISA file: format fields tile the instruction word, immediates assemble every bit once, no two instructions share an encoding, and all cross-references resolve.
- `builder/index.html` is a self-contained page for entering an ISA through forms and copying out the TOML. Open it in a browser; it needs no build step.

## Validate a spec

```
python3 -I tools/validate_isa.py isa-template.toml
```

Requires Python 3.11 or newer (uses `tomllib`).
