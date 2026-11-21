/* Runs tools/asm.py and src/lib/asm.ts on the same input and asserts they agree. */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assemble, formatErrors, listing, loadIsa } from "../src/lib/asm.ts"

export const ROOT = join(import.meta.dirname, "..", "..")
export const TEMPLATE = readFileSync(join(ROOT, "isa-template.toml"), "utf8")
const dir = mkdtempSync(join(tmpdir(), "asm-parity-"))

function python(isaToml: string, source: string, base?: string) {
  const isaPath = join(dir, "isa.toml"),
    src = join(dir, "in.s"),
    out = join(dir, "out.bin")
  writeFileSync(isaPath, isaToml)
  writeFileSync(src, source)
  const args = ["-I", join(ROOT, "tools/asm.py"), isaPath, src, "-o", out, "--listing", ...(base ? ["--base", base] : [])]
  try {
    const stdout = execFileSync("python3", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    return { ok: true, image: readFileSync(out), listing: stdout.replace(/\n$/, ""), errors: "" }
  } catch (e) {
    const stderr = String((e as { stderr: string }).stderr)
    return { ok: false, image: Buffer.alloc(0), listing: "", errors: stderr.replace(/^.*?: error:\n/, "").replace(/\n$/, "") }
  }
}

/** Assemble with both; return the browser result. */
export function same(isaToml: string, source: string, base?: string) {
  const py = python(isaToml, source, base)
  const isa = loadIsa(isaToml)
  const js = assemble(isa, source, base === undefined ? undefined : BigInt(base))
  if (!py.ok) {
    assert.equal(formatErrors(js.errors), py.errors)
    return js
  }
  assert.deepEqual(js.errors, [])
  assert.equal(Buffer.from(js.image).toString("hex"), py.image.toString("hex"))
  assert.equal(listing(js.items), py.listing)
  return js
}
