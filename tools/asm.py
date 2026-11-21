#!/usr/bin/env python3
"""Assemble a source file into a flat binary for any ISA described in TOML (schema 0.1).

Usage: python3 -I tools/asm.py ISA.toml SOURCE.s [-o OUT.bin] [--base ADDR] [--listing]

The ISA file supplies everything instruction-specific: mnemonics and operand
syntax (`assembly`), register names, field positions (`format`), immediate
scattering (`immediate`), fixed opcode bits (`encoding.fixed`), aliases
(`pseudo_instruction`) and byte order. The source syntax around it is fixed:

  label:                 labels; several per line, instruction may follow
  # ...  ; ...  // ...   comments
  42 0x2a 0b101 0o52 'a' numbers; expressions use + - * / % << >> & | ^ ~ ( )
  .                      address of the current line
  .org ADDR              move to absolute ADDR (zero-filled; first one sets the image base)
  .align N               pad with zeros to an N-byte boundary
  .space N[, FILL]       N bytes of FILL (default 0); also .zero
  .byte/.half/.word/.dword EXPR, ...   1/2/4/8-byte values in the ISA's byte order
  .ascii/.asciz/.string "text", ...    strings (.asciz/.string append a NUL)
  .equ NAME, EXPR        define a constant; also .set
  .text .globl .global   accepted and ignored

A pc-relative immediate operand is written as the target address (normally a
label); the assembler encodes target - address of the instruction.
"""
import argparse, ast, re, sys, tomllib


class AsmError(Exception):
    pass


class Undefined(AsmError):
    pass


# --- expressions --------------------------------------------------------------

_TOKEN = re.compile(r"""\s*(?:
    (?P<num>0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*)
  | (?P<chr>'(?:\\.|[^'\\])+')
  | (?P<sym>[A-Za-z_.$][\w.$]*)
  | (?P<op><<|>>|[-+*/%&|^~()])
)""", re.X)

_BINARY = [{"|"}, {"^"}, {"&"}, {"<<", ">>"}, {"+", "-"}, {"*", "/", "%"}]


def _tokenize(text):
    toks, pos, text = [], 0, text.rstrip()
    while pos < len(text):
        m = _TOKEN.match(text, pos)
        if not m or m.end() == pos:
            raise AsmError(f"bad expression near '{text[pos:].strip()}'")
        pos = m.end()
        kind = m.lastgroup
        s = m[kind]
        if kind == "num":
            s = s.replace("_", "")
            toks.append(("num", int(s, 0) if s[:2].lower() in ("0x", "0b", "0o") else int(s, 10)))
        elif kind == "chr":
            v = ast.literal_eval(s)
            if len(v) != 1:
                raise AsmError(f"character literal {s} must be one character")
            toks.append(("num", ord(v)))
        else:
            toks.append((kind, s))
    if not toks:
        raise AsmError("empty expression")
    return toks


def evaluate(text, syms, here):
    """Evaluate an integer expression. Raises Undefined for unknown symbols."""
    toks = _tokenize(text)
    pos = 0

    def take(op=None):
        nonlocal pos
        if pos < len(toks) and (op is None or toks[pos] == ("op", op)):
            pos += 1
            return toks[pos - 1]
        return None

    def unary():
        t = take()
        if t is None:
            raise AsmError(f"expression '{text}' ends early")
        kind, v = t
        if kind == "num":
            return v
        if kind == "sym":
            if v == ".":
                return here
            if v not in syms:
                raise Undefined(f"undefined symbol '{v}'")
            return syms[v]
        if v == "(":
            r = binary(0)
            if not take(")"):
                raise AsmError(f"missing ')' in '{text}'")
            return r
        if v == "-":
            return -unary()
        if v == "+":
            return unary()
        if v == "~":
            return ~unary()
        raise AsmError(f"unexpected '{v}' in '{text}'")

    def binary(level):
        if level == len(_BINARY):
            return unary()
        left = binary(level + 1)
        while pos < len(toks) and toks[pos][0] == "op" and toks[pos][1] in _BINARY[level]:
            op = take()[1]
            right = binary(level + 1)
            if op in "/%" and right == 0:
                raise AsmError(f"division by zero in '{text}'")
            if op in ("<<", ">>") and right < 0:
                raise AsmError(f"negative shift in '{text}'")
            if op == "/":  # truncate toward zero, like C
                q = abs(left) // abs(right)
                left = -q if (left < 0) != (right < 0) else q
            elif op == "%":
                left = left - right * int(left / right)
            elif op == "|":
                left |= right
            elif op == "^":
                left ^= right
            elif op == "&":
                left &= right
            elif op == "<<":
                left <<= right
            elif op == ">>":
                left >>= right
            elif op == "+":
                left += right
            elif op == "-":
                left -= right
            else:
                left *= right
        return left

    result = binary(0)
    if pos != len(toks):
        raise AsmError(f"unexpected '{toks[pos][1]}' in '{text}'")
    return result


# --- ISA tables ---------------------------------------------------------------

def compile_template(template):
    """'lw {rd}, {imm_i}({rs1})' -> ('lw', regex matching the operand text)."""
    mnemonic, _, rest = template.strip().partition(" ")
    rx = ""
    for piece in re.split(r"(\{\w+\})", rest.strip()):
        m = re.fullmatch(r"\{(\w+)\}", piece)
        if m:
            rx += f"(?P<{m[1]}>.+?)"
        else:
            rx += "".join(r"\s*" + re.escape(c) + r"\s*" for c in piece if not c.isspace())
    return mnemonic.lower(), re.compile(rx)


class ISA:
    def __init__(self, d, endian=None):
        isa = d["isa"]
        if isa.get("instruction_width", "fixed") != "fixed":
            raise AsmError("variable-length instruction sets are not supported yet")
        if isa["instruction_bits"] % 8:
            raise AsmError("instruction_bits must be a whole number of bytes")
        self.ibytes = isa["instruction_bits"] // 8
        self.endian = endian or ("big" if isa.get("endianness") == "big" else "little")
        self.xlen = isa.get("xlen", 32)
        self.align = isa.get("fetch_alignment", self.ibytes)
        self.reset_pc = isa.get("reset_pc", 0)
        self.formats = {f["name"]: {fl["name"]: tuple(fl["bits"]) for fl in f["field"]}
                        for f in d.get("format", [])}
        self.imms = {i["name"]: i for i in d.get("immediate", [])}
        self.regs = {}
        for rf in d.get("register_file", []):
            names = {}
            for key in ("names", "abi_names"):
                for i, n in enumerate(rf.get(key, [])):
                    names[n.lower()] = i
            self.regs[rf["name"]] = names
        self.insns, self.pseudos = {}, {}
        for ins in d.get("instruction", []):
            mn, rx = compile_template(ins["assembly"])
            self.insns.setdefault(mn, []).append((ins, rx))
        for p in d.get("pseudo_instruction", []):
            mn, rx = compile_template(p["assembly"])
            self.pseudos.setdefault(mn, []).append((p, rx))

    def expand(self, mnemonic, ops, depth=0):
        """Resolve pseudo-instructions textually. Returns [(mnemonic, operand_text), ...]."""
        if depth > 8:
            raise AsmError(f"pseudo-instruction '{mnemonic}' expands too deeply")
        if any(rx.fullmatch(ops) for _, rx in self.insns.get(mnemonic, [])):
            return [(mnemonic, ops)]
        for p, rx in self.pseudos.get(mnemonic, []):
            m = rx.fullmatch(ops)
            if not m:
                continue
            out = []
            for line in p["expands_to"]:
                text = re.sub(r"\{(\w+)\}", lambda k: m[k[1]].strip(), line)
                mn, _, rest = text.strip().partition(" ")
                out += self.expand(mn.lower(), rest.strip(), depth + 1)
            return out
        forms = [r["assembly"] for r, _ in self.insns.get(mnemonic, []) + self.pseudos.get(mnemonic, [])]
        if forms:
            raise AsmError(f"operands '{ops}' don't fit {' or '.join(repr(f) for f in forms)}")
        raise AsmError(f"unknown instruction '{mnemonic}'")

    def encode(self, mnemonic, ops, pc, syms):
        first_error = None
        for ins, rx in self.insns[mnemonic]:
            m = rx.fullmatch(ops)
            if not m:
                continue
            try:
                return self._encode_one(ins, m, pc, syms)
            except Undefined:
                raise
            except AsmError as e:
                first_error = first_error or e
        raise first_error or AsmError(f"operands '{ops}' don't fit '{mnemonic}'")

    def _encode_one(self, ins, m, pc, syms):
        fields = self.formats[ins["format"]]
        word = 0

        def put(field, value):
            nonlocal word
            hi, lo = fields[field]
            word |= (value & ((1 << (hi - lo + 1)) - 1)) << lo

        for field, bits in ins.get("encoding", {}).get("fixed", {}).items():
            put(field, int(bits, 2))
        for op in ins.get("operands", []):
            name = op["name"]
            if name not in m.re.groupindex:
                raise AsmError(f"{ins['name']}: operand {name} does not appear in its assembly template")
            text = m[name].strip()
            if op["kind"] == "reg":
                idx = self.regs.get(op["file"], {}).get(text.lower())
                if idx is None:
                    raise AsmError(f"'{text}' is not a register in file {op['file']}")
                put(name, idx)
                continue
            im = self.imms[name]
            value = evaluate(text, syms, pc)
            what = name
            if op.get("pc_relative"):
                value -= pc
                what = f"{name} (offset to target)"
            bits, zeros = im["bits"], im.get("implicit_zero_bits", 0)
            if im.get("signed"):
                lo, hi = -(1 << (bits - 1)), (1 << (bits - 1)) - 1
            else:
                # a full-width unsigned immediate may also be written as a negative number
                lo, hi = (-(1 << (bits - 1)) if bits >= self.xlen else 0), (1 << bits) - 1
            if not lo <= value <= hi:
                raise AsmError(f"{what} = {value} is out of range [{lo}, {hi}]")
            if value & ((1 << zeros) - 1):
                raise AsmError(f"{what} = {value} must be a multiple of {1 << zeros}")
            value &= (1 << bits) - 1
            for part in im["parts"]:
                put(part["field"], value >> part["dst_lsb"])
        return word.to_bytes(self.ibytes, self.endian)


# --- source parsing -----------------------------------------------------------

def strip_comment(line):
    out, quote, i = [], None, 0
    while i < len(line):
        c = line[i]
        if quote:
            out.append(c)
            if c == "\\" and i + 1 < len(line):
                out.append(line[i + 1])
                i += 1
            elif c == quote:
                quote = None
        elif c in "\"'":
            quote = c
            out.append(c)
        elif c in "#;" or line.startswith("//", i):
            break
        else:
            out.append(c)
        i += 1
    return "".join(out).strip()


def split_args(text):
    args, cur, quote, i = [], "", None, 0
    while i < len(text):
        c = text[i]
        if quote:
            cur += c
            if c == "\\" and i + 1 < len(text):
                cur += text[i + 1]
                i += 1
            elif c == quote:
                quote = None
        elif c in "\"'":
            quote = c
            cur += c
        elif c == ",":
            args.append(cur.strip())
            cur = ""
        else:
            cur += c
        i += 1
    if cur.strip() or args:
        args.append(cur.strip())
    return args


_LABEL = re.compile(r"([A-Za-z_.$][\w.$]*)\s*:(?!=)")
_DATA = {".byte": 1, ".half": 2, ".short": 2, ".word": 4, ".long": 4, ".dword": 8, ".quad": 8}
_IGNORED = {".text", ".globl", ".global"}


class Item:
    """One placed thing in the image: an instruction, data values, or raw bytes."""
    def __init__(self, lineno, source, addr, kind, payload, size):
        self.lineno, self.source, self.addr = lineno, source, addr
        self.kind, self.payload, self.size = kind, payload, size


def assemble(isa, source, base=None):
    """Returns (image_bytes, base_address, items). Raises AsmError with all problems listed."""
    errors, items, syms, start_labels = [], [], {}, []
    addr = isa.reset_pc if base is None else base
    image_base, base_fixed = addr, base is not None

    def here_expr(text):
        try:
            return evaluate(text, syms, addr)
        except Undefined as e:
            raise AsmError(f"{e} (must be defined before this line)")

    # Pass 1: lay out addresses, define labels, expand pseudo-instructions.
    for lineno, raw in enumerate(source.splitlines(), 1):
        line = strip_comment(raw)
        try:
            while m := _LABEL.match(line):
                name = m[1]
                if name in syms:
                    raise AsmError(f"symbol '{name}' defined twice")
                syms[name] = addr
                if not items:
                    start_labels.append(name)
                line = line[m.end():].strip()
            if not line:
                continue
            word, _, rest = line.partition(" ")
            if "\t" in word:
                word, _, more = word.partition("\t")
                rest = more + " " + rest
            word, rest = word.lower(), rest.strip()
            if word.startswith("."):
                args = split_args(rest)
                if word in _IGNORED:
                    continue
                if word in (".equ", ".set"):
                    if len(args) != 2 or not re.fullmatch(r"[A-Za-z_.$][\w.$]*", args[0]):
                        raise AsmError(f"usage: {word} NAME, EXPR")
                    if args[0] in syms:
                        raise AsmError(f"symbol '{args[0]}' defined twice")
                    syms[args[0]] = here_expr(args[1])
                elif word == ".org":
                    target = here_expr(rest)
                    if not items and not base_fixed:
                        image_base = addr = target
                        for name in start_labels:  # labels above the first .org move with it
                            syms[name] = target
                    elif target < addr:
                        raise AsmError(f".org {target:#x} is behind the current address {addr:#x}")
                    else:
                        items.append(Item(lineno, raw, addr, "fill", 0, target - addr))
                        addr = target
                elif word == ".align":
                    n = here_expr(rest)
                    if n <= 0:
                        raise AsmError(".align needs a positive byte count")
                    pad = -addr % n
                    if pad:
                        items.append(Item(lineno, raw, addr, "fill", 0, pad))
                        addr += pad
                elif word in (".space", ".zero"):
                    if len(args) not in (1, 2):
                        raise AsmError(f"usage: {word} N[, FILL]")
                    n = here_expr(args[0])
                    fill = here_expr(args[1]) if len(args) == 2 else 0
                    if n < 0 or not 0 <= fill <= 255:
                        raise AsmError(f"{word}: bad size or fill byte")
                    items.append(Item(lineno, raw, addr, "fill", fill, n))
                    addr += n
                elif word in _DATA:
                    if not args or "" in args:
                        raise AsmError(f"{word} needs one or more comma-separated values")
                    size = _DATA[word]
                    items.append(Item(lineno, raw, addr, "data", (size, args), size * len(args)))
                    addr += size * len(args)
                elif word in (".ascii", ".asciz", ".string"):
                    data = b""
                    for a in args:
                        if not (len(a) >= 2 and a[0] == a[-1] == '"'):
                            raise AsmError(f"{word} expects double-quoted strings")
                        data += ast.literal_eval(a).encode("utf-8") + (b"\0" if word != ".ascii" else b"")
                    items.append(Item(lineno, raw, addr, "bytes", data, len(data)))
                    addr += len(data)
                elif word in (".data", ".bss", ".section", ".rodata"):
                    raise AsmError(f"{word}: sections are not supported; the output is one flat image")
                else:
                    raise AsmError(f"unknown directive '{word}'")
                continue
            expansion = isa.expand(word, rest)
            for mn, ops in expansion:
                if addr % isa.align:
                    raise AsmError(f"instruction at {addr:#x} is not {isa.align}-byte aligned (add .align {isa.align})")
                shown = raw if len(expansion) == 1 and mn == word else f"{mn} {ops}".strip() + f"    ; {line}"
                items.append(Item(lineno, shown, addr, "insn", (mn, ops), isa.ibytes))
                addr += isa.ibytes
        except AsmError as e:
            errors.append((lineno, f"line {lineno}: {e}\n    {raw.strip()}"))

    # Pass 2: evaluate operands and encode.
    image = bytearray()
    for it in items:
        try:
            if it.kind == "insn":
                out = isa.encode(*it.payload, it.addr, syms)
            elif it.kind == "fill":
                out = bytes([it.payload]) * it.size
            elif it.kind == "bytes":
                out = it.payload
            else:
                size, args = it.payload
                out = b""
                for a in args:
                    v = evaluate(a, syms, it.addr + len(out))
                    if not -(1 << (size * 8 - 1)) <= v < (1 << (size * 8)):
                        raise AsmError(f"value {v} does not fit in {size} byte(s)")
                    out += (v & ((1 << (size * 8)) - 1)).to_bytes(size, isa.endian)
            it.bytes = out
            image += out
        except AsmError as e:
            it.bytes = b""
            errors.append((it.lineno, f"line {it.lineno}: {e}\n    {it.source.strip()}"))

    if errors:
        raise AsmError("\n".join(msg for _, msg in sorted(errors, key=lambda e: e[0])))
    return bytes(image), image_base, items


def listing(items, ibytes):
    out = []
    for it in items:
        if it.kind == "fill" and it.size > 8:
            out.append(f"{it.addr:08x}  ({it.size} bytes of {it.payload:#04x})")
            continue
        chunk = ibytes if it.kind == "insn" else 8
        for off in range(0, max(len(it.bytes), 1), chunk):
            hexs = it.bytes[off:off + chunk].hex(" ")
            src = it.source.strip() if off == 0 else ""
            out.append(f"{it.addr + off:08x}  {hexs:<23}  {src}".rstrip())
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Assemble SOURCE for the ISA described in ISA.toml into a flat binary.")
    ap.add_argument("isa", help="ISA description (TOML, schema 0.1)")
    ap.add_argument("source", help="assembly source file")
    ap.add_argument("-o", "--output", help="output binary (default: SOURCE with .bin extension)")
    ap.add_argument("--base", type=lambda s: int(s, 0), help="address of the first byte (default: isa.reset_pc, or the first .org)")
    ap.add_argument("--endian", choices=["little", "big"], help="override the ISA's byte order (needed for 'bi')")
    ap.add_argument("--listing", action="store_true", help="print address, bytes and source for each line")
    a = ap.parse_args(argv)

    try:
        with open(a.isa, "rb") as f:
            isa = ISA(tomllib.load(f), a.endian)
        with open(a.source, encoding="utf-8") as f:
            image, base, items = assemble(isa, f.read(), a.base)
    except (AsmError, OSError, tomllib.TOMLDecodeError, KeyError) as e:
        msg = f"missing key {e}" if isinstance(e, KeyError) else str(e)
        print(f"{a.source}: error:\n{msg}" if isinstance(e, AsmError) else f"error: {msg}", file=sys.stderr)
        return 1

    out = a.output or re.sub(r"(\.[^./\\]*)?$", ".bin", a.source, count=1)
    with open(out, "wb") as f:
        f.write(image)
    if a.listing:
        print(listing(items, isa.ibytes))
    print(f"wrote {len(image)} bytes to {out} (base {base:#x})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
