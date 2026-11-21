"""Tests for asm.py. Run: python3 -I -m unittest discover -s tools -p 'test_*.py'"""
import pathlib, subprocess, sys, tempfile, tomllib, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import asm  # noqa: E402

ISA = asm.ISA(tomllib.loads((ROOT / "isa-template.toml").read_text()))


def words(src, base=0):
    image, _, _ = asm.assemble(ISA, src, base)
    return [int.from_bytes(image[i:i + 4], "little") for i in range(0, len(image), 4)]


class Encodings(unittest.TestCase):
    # Expected values are the standard RV32I encodings, which tiny32 shares.
    def test_r_type(self):
        self.assertEqual(words("add a0, a1, a2\nsub t0, t1, t2\nand x5, x6, x7\nmul a0, a0, a1"),
                         [0x00C58533, 0x407302B3, 0x007372B3, 0x02B50533])

    def test_i_type_and_loads(self):
        self.assertEqual(words("addi a0, sp, 16\naddi a0, a0, -1\nlw a0, -4(sp)"),
                         [0x01010513, 0xFFF50513, 0xFFC12503])

    def test_store_splits_immediate(self):
        self.assertEqual(words("sw a0, 8(sp)\nsw ra, -20(s0)"), [0x00A12423, 0xFE142623])

    def test_upper_immediate_is_full_value(self):
        self.assertEqual(words("lui a0, 0x12345000"), [0x12345537])

    def test_branch_and_jump_offsets(self):
        src = "back: add a0, a0, a0\nadd a0, a0, a0\nbeq a0, a1, back\njal ra, fwd\nadd x0, x0, x0\nfwd: jal x0, ."
        self.assertEqual(words(src), [0x00A50533, 0x00A50533, 0xFEB50CE3, 0x008000EF, 0x00000033, 0x0000006F])

    def test_pseudo_instructions(self):
        self.assertEqual(words("nop\nmv a0, a1\nl: j l"), [0x00000013, 0x00058513, 0x0000006F])

    def test_data_and_symbols(self):
        image, base, _ = asm.assemble(ISA, ".org 0x100\nx: .word x, 0xdeadbeef\n.byte 1, -1\n.asciz \"hi\"\n.equ K, 3\n.half K*2")
        self.assertEqual(base, 0x100)
        self.assertEqual(image, bytes.fromhex("00010000 efbeadde 01ff 686900 0600"))

    def test_org_and_align_pad(self):
        image, _, _ = asm.assemble(ISA, ".byte 1\n.align 4\n.word 2\n.org 12\n.byte 3", 0)
        self.assertEqual(image, bytes.fromhex("01000000 02000000 00000000 03"))


class Errors(unittest.TestCase):
    def check(self, src, needle):
        with self.assertRaises(asm.AsmError) as cm:
            asm.assemble(ISA, src, 0)
        self.assertIn(needle, str(cm.exception))

    def test_messages(self):
        self.check("addi a0, a0, 2048", "out of range")
        self.check("beq a0, a1, 3", "multiple of 2")
        self.check("add a0, a1, q9", "not a register")
        self.check("frob a0", "unknown instruction")
        self.check("add a0, a1", "don't fit")
        self.check("j nowhere", "undefined symbol 'nowhere'")
        self.check("x: nop\nx: nop", "defined twice")
        self.check(".byte 1\nnop", "aligned")
        self.check(".word 1\n.org 0", "behind")

    def test_reports_every_error_with_line_numbers(self):
        with self.assertRaises(asm.AsmError) as cm:
            asm.assemble(ISA, "nop\nfrob\nnop\naddi a0, a0, 9999", 0)
        self.assertIn("line 2:", str(cm.exception))
        self.assertIn("line 4:", str(cm.exception))


class CommandLine(unittest.TestCase):
    def test_example_program(self):
        with tempfile.TemporaryDirectory() as d:
            out = pathlib.Path(d) / "sum.bin"
            r = subprocess.run([sys.executable, "-I", str(ROOT / "tools/asm.py"), str(ROOT / "isa-template.toml"),
                                str(ROOT / "examples/sum.s"), "-o", str(out), "--listing"], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            data = out.read_bytes()
            self.assertEqual(len(data), 12 * 4 + 5 * 4 + 5)
            self.assertEqual(data[48:64], bytes.fromhex("0a000000 14000000 1e000000 28000000"))
            self.assertIn("loop:", r.stdout)


if __name__ == "__main__":
    unittest.main()
