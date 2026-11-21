import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AssembleTab } from "@/components/assemble"
import { defaultAsmSettings, exampleFor, isExample, type AsmSettings } from "@/lib/program"
import { ArchTab, FormatsTab, InstructionsTab, PseudoTab, RegsTab, type Update } from "@/components/editor"
import { ChecksPanel, TomlPanel } from "@/components/output"
import { empty, example, example8, isState, syncAll, toml, validate, type IsaState } from "@/lib/isa"

const STORAGE_KEY = "isa-builder-draft"
const ASM_KEY = "isa-builder-assemble"

function load(): IsaState {
  try {
    const d = localStorage.getItem(STORAGE_KEY)
    const s: unknown = d ? JSON.parse(d) : null
    if (isState(s)) return syncAll(s)
  } catch {
    /* storage blocked or draft corrupt */
  }
  return example()
}

function loadAsm(): AsmSettings {
  try {
    const d = localStorage.getItem(ASM_KEY)
    const s: unknown = d ? JSON.parse(d) : null
    if (s && typeof s === "object") return { ...defaultAsmSettings(), ...(s as Partial<AsmSettings>) }
  } catch {
    /* storage blocked or corrupt */
  }
  return defaultAsmSettings()
}

type TabId = "arch" | "regs" | "fmts" | "ins" | "pseudo" | "asm"

export default function App() {
  const [S, setS] = useState<IsaState>(load)
  const [tab, setTab] = useState<TabId>("arch")
  const [asm, setAsm] = useState<AsmSettings>(loadAsm)
  const patchAsm = useCallback((p: Partial<AsmSettings>) => setAsm((prev) => ({ ...prev, ...p })), [])

  /** Apply a change to a copy of the state, then re-sync instruction fields with their formats. */
  const update: Update = useCallback((fn) => {
    setS((prev) => {
      const d = structuredClone(prev)
      fn(d)
      return syncAll(d)
    })
  }, [])

  /** Switch to an example ISA, and to its starter program if the source is still a starter program. */
  const loadExample = (s: IsaState) => {
    setS(s)
    setAsm((prev) => (isExample(prev.source) ? { ...prev, source: exampleFor(s.name), fileName: "" } : prev))
  }

  const problems = useMemo(() => validate(S), [S])
  const text = useMemo(() => toml(S), [S])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(S))
    } catch {
      /* storage unavailable */
    }
  }, [S])

  useEffect(() => {
    try {
      localStorage.setItem(ASM_KEY, JSON.stringify(asm))
    } catch {
      /* storage unavailable */
    }
  }, [asm])

  const tabs: [TabId, string, number | null][] = [
    ["arch", "Architecture", null],
    ["regs", "Registers", S.regfiles.length],
    ["fmts", "Formats", S.formats.length],
    ["ins", "Instructions", S.instructions.length],
    ["pseudo", "Pseudo", S.pseudos.length],
    ["asm", "Assemble", null],
  ]

  return (
    <div className="mx-auto max-w-7xl px-4 pt-5 pb-10">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">ISA Builder</h1>
          <p className="mt-1 max-w-[60ch] text-muted-foreground">
            Define registers, instruction formats and instructions, then assemble programs for them. The TOML on the right updates as you type
            and is checked for bit gaps and encoding clashes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => loadExample(example())}>
            Load tiny32 example
          </Button>
          <Button variant="outline" onClick={() => loadExample(example8())}>
            Load tiny8 example
          </Button>
          <Button
            variant="outline"
            className="hover:text-destructive"
            onClick={() => {
              setS(empty())
              setTab("arch")
            }}
          >
            Start empty
          </Button>
        </div>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <Card size="sm" aria-label="Editor">
          <CardContent>
            <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="gap-4">
              <TabsList variant="line" className="w-full justify-start overflow-x-auto">
                {tabs.map(([id, label, n]) => (
                  <TabsTrigger key={id} value={id} className="flex-none">
                    {label}
                    {n !== null && <span className="font-mono text-xs text-muted-foreground">{n}</span>}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="arch">
                <ArchTab S={S} update={update} />
              </TabsContent>
              <TabsContent value="regs">
                <RegsTab S={S} update={update} />
              </TabsContent>
              <TabsContent value="fmts">
                <FormatsTab S={S} update={update} />
              </TabsContent>
              <TabsContent value="ins">
                <InstructionsTab S={S} update={update} />
              </TabsContent>
              <TabsContent value="pseudo">
                <PseudoTab S={S} update={update} />
              </TabsContent>
              <TabsContent value="asm">
                <AssembleTab builderToml={text} isaName={S.name} problems={problems} settings={asm} onChange={patchAsm} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-3">
          <TomlPanel text={text} problems={problems} />
          <ChecksPanel problems={problems} />
        </aside>
      </div>
    </div>
  )
}
