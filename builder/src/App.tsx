import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArchTab, FormatsTab, InstructionsTab, RegsTab, type Update } from "@/components/editor"
import { ChecksPanel, TomlPanel } from "@/components/output"
import { empty, example, isState, syncAll, toml, validate, type IsaState } from "@/lib/isa"

const STORAGE_KEY = "isa-builder-draft"

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

type TabId = "arch" | "regs" | "fmts" | "ins"
const TAB_ORDER: TabId[] = ["arch", "regs", "fmts", "ins"]

export default function App() {
  const [S, setS] = useState<IsaState>(load)
  const [tab, setTabState] = useState<TabId>("arch")
  // Slide new tab content in from the side the user is moving towards.
  const [dir, setDir] = useState<1 | -1>(1)
  const setTab = (next: TabId) => {
    if (next !== tab) setDir(TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(tab) ? 1 : -1)
    setTabState(next)
  }

  /** Apply a change to a copy of the state, then re-sync instruction fields with their formats. */
  const update: Update = useCallback((fn) => {
    setS((prev) => {
      const d = structuredClone(prev)
      fn(d)
      return syncAll(d)
    })
  }, [])

  const problems = useMemo(() => validate(S), [S])
  const text = useMemo(() => toml(S), [S])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(S))
    } catch {
      /* storage unavailable */
    }
  }, [S])

  const tabs: [TabId, string, number | null][] = [
    ["arch", "Architecture", null],
    ["regs", "Registers", S.regfiles.length],
    ["fmts", "Formats", S.formats.length],
    ["ins", "Instructions", S.instructions.length],
  ]

  const slide = dir === 1 ? "slide-in-from-right-6" : "slide-in-from-left-6"

  return (
    <div className="mx-auto max-w-7xl px-4 pt-5 pb-10">
      <header className="mb-4 flex animate-in fill-mode-both fade-in-0 slide-in-from-top-3 duration-700 ease-fluid flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-balance">
            <span aria-hidden="true" className="inline-block origin-bottom transition-transform duration-500 ease-spring hover:-rotate-12 hover:scale-110">
              🦩
            </span>
            ISA Builder
          </h1>
          <p className="mt-1 max-w-[60ch] text-muted-foreground">
            Define registers, instruction formats and instructions. The TOML on the right updates as you type and is checked for bit gaps and
            encoding clashes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setS(example())}>
            Load tiny32 example
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
        <Card size="sm" aria-label="Editor" className="animate-in fill-mode-both fade-in-0 slide-in-from-bottom-4 delay-100 duration-700 ease-fluid">
          <CardContent>
            <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="gap-4">
              <TabsList className="max-w-full justify-start overflow-x-auto">
                {tabs.map(([id, label, n]) => (
                  <TabsTrigger key={id} value={id} className="flex-none">
                    {label}
                    {n !== null && <span className="font-mono text-xs text-muted-foreground">{n}</span>}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="arch" className={slide}>
                <ArchTab S={S} update={update} />
              </TabsContent>
              <TabsContent value="regs" className={slide}>
                <RegsTab S={S} update={update} />
              </TabsContent>
              <TabsContent value="fmts" className={slide}>
                <FormatsTab S={S} update={update} />
              </TabsContent>
              <TabsContent value="ins" className={slide}>
                <InstructionsTab S={S} update={update} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <aside className="flex animate-in fill-mode-both flex-col gap-3 fade-in-0 slide-in-from-bottom-4 delay-200 duration-700 ease-fluid lg:sticky lg:top-3">
          <TomlPanel text={text} problems={problems} />
          <ChecksPanel problems={problems} />
        </aside>
      </div>
    </div>
  )
}
