#!/usr/bin/env python3
"""Validate an ISA TOML description (schema 0.1). Usage: python3 -I validate_isa.py FILE.toml"""
import sys, tomllib

def main(path):
    with open(path, "rb") as f:
        d = tomllib.load(f)
    errs = []
    E = errs.append

    for sec in ("meta", "isa", "semantics"):
        if sec not in d: E(f"missing required section [{sec}]")
    if not d.get("instruction"): E("no [[instruction]] entries")

    exts = {e["name"] for e in d.get("extension", [])}
    for e in d.get("extension", []):
        for dep in e.get("depends_on", []):
            if dep not in exts: E(f"extension {e['name']}: unknown dependency {dep}")

    files = {r["name"]: r for r in d.get("register_file", [])}
    for r in files.values():
        if r["count"] > 2 ** r["index_bits"]: E(f"register_file {r['name']}: count exceeds index_bits")
        for k in ("names", "abi_names"):
            if k in r and len(r[k]) != r["count"]: E(f"register_file {r['name']}: {k} length != count")

    # formats tile the word
    formats = {}
    for fm in d.get("format", []):
        cover = [None] * fm["width"]
        fields = {}
        for fl in fm["field"]:
            hi, lo = fl["bits"]
            if hi < lo or hi >= fm["width"]: E(f"format {fm['name']}.{fl['name']}: bad bits {fl['bits']}"); continue
            fields[fl["name"]] = hi - lo + 1
            for b in range(lo, hi + 1):
                if cover[b] is not None: E(f"format {fm['name']}: bit {b} in both {cover[b]} and {fl['name']}")
                cover[b] = fl["name"]
        gaps = [i for i, c in enumerate(cover) if c is None]
        if gaps: E(f"format {fm['name']}: uncovered bits {gaps}")
        formats[fm["name"]] = {"width": fm["width"], "fields": fields}
    if "isa" in d and d["isa"].get("instruction_width") == "fixed":
        for n, fm in formats.items():
            if fm["width"] != d["isa"]["instruction_bits"]: E(f"format {n}: width != isa.instruction_bits")

    # immediates assemble fully
    imms = {}
    for im in d.get("immediate", []):
        fm = formats.get(im["format"])
        if not fm: E(f"immediate {im['name']}: unknown format {im['format']}"); continue
        covered = set()
        for p in im["parts"]:
            w = fm["fields"].get(p["field"])
            if w is None: E(f"immediate {im['name']}: field {p['field']} not in format {im['format']}"); continue
            bits = set(range(p["dst_lsb"], p["dst_lsb"] + w))
            if bits & covered: E(f"immediate {im['name']}: overlapping parts at {sorted(bits & covered)}")
            covered |= bits
        need = set(range(im.get("implicit_zero_bits", 0), im["bits"]))
        if covered != need: E(f"immediate {im['name']}: bit coverage {sorted(covered)} != expected {sorted(need)}")
        imms[im["name"]] = im

    excs = {e["name"] for e in d.get("exception", [])}
    seen = {}
    for ins in d.get("instruction", []):
        n = ins["name"]
        if ins["extension"] not in exts: E(f"{n}: unknown extension {ins['extension']}")
        fm = formats.get(ins["format"])
        if not fm: E(f"{n}: unknown format {ins['format']}"); continue
        fixed = ins.get("encoding", {}).get("fixed", {})
        opnames = {o["name"] for o in ins.get("operands", [])}
        # operand legality; immediates consume their format's fields
        consumed = set()
        for o in ins.get("operands", []):
            if o["kind"] == "reg":
                if o["file"] not in files: E(f"{n}: unknown register file {o['file']}")
                if o["name"] not in fm["fields"]: E(f"{n}: operand {o['name']} not a field of format {ins['format']}")
                consumed.add(o["name"])
            else:
                im = imms.get(o["name"])
                if not im or im["format"] != ins["format"]: E(f"{n}: immediate {o['name']} not defined for format {ins['format']}")
                else: consumed |= {p["field"] for p in im["parts"]}
        for k, v in fixed.items():
            if k not in fm["fields"]: E(f"{n}: fixed field {k} not in format"); continue
            if len(v) != fm["fields"][k]: E(f"{n}: fixed {k} width {len(v)} != {fm['fields'][k]}")
            if k in consumed: E(f"{n}: field {k} both fixed and an operand")
        unspecified = set(fm["fields"]) - consumed - set(fixed)
        if unspecified: E(f"{n}: fields neither fixed nor operand: {sorted(unspecified)}")
        for t in ins.get("traps", []):
            if t not in excs: E(f"{n}: unknown trap {t}")
        for ph in __import__("re").findall(r"\{(\w+)\}", ins.get("assembly", "")):
            if ph not in opnames: E(f"{n}: assembly placeholder {{{ph}}} is not an operand")
        # build match/mask for overlap detection
        match = mask = 0
        for fl in d["format"][[f["name"] for f in d["format"]].index(ins["format"])]["field"]:
            if fl["name"] in fixed:
                hi, lo = fl["bits"]
                mask |= ((1 << (hi - lo + 1)) - 1) << lo
                match |= int(fixed[fl["name"]], 2) << lo
        seen[n] = (match, mask)
    names = list(seen)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            (ma, ka), (mb, kb) = seen[a], seen[b]
            if (ma ^ mb) & ka & kb == 0: E(f"encoding overlap: {a} and {b}")
    if len(names) != len(set(i["name"] for i in d["instruction"])): E("duplicate instruction names")

    for p in d.get("pseudo_instruction", []):
        for line in p["expands_to"]:
            mn = line.split()[0]
            if mn not in seen: E(f"pseudo {p['name']}: expands to unknown instruction {mn}")

    classes = d.get("timing", {}).get("latency_class", {})
    for ins in d.get("instruction", []):
        lc = ins.get("timing", {}).get("latency_class")
        if lc and lc not in classes: E(f"{ins['name']}: unknown latency_class {lc}")

    if errs:
        print(f"{len(errs)} problem(s):"); [print(" -", e) for e in errs]; return 1
    print(f"OK: {len(d['instruction'])} instructions, {len(formats)} formats, {len(imms)} immediates, "
          f"{len(d.get('csr', []))} CSRs, {len(d.get('pseudo_instruction', []))} pseudo-instructions")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
