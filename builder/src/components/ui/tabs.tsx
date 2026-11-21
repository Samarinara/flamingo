import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Tabs as TabsPrimitive } from "radix-ui"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-full p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type Indicator = { x: number; y: number; w: number; h: number; animate: boolean }

/** Follow the active trigger so the highlight can glide between tabs. */
function useIndicator(list: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [ind, setInd] = React.useState<Indicator | null>(null)
  React.useLayoutEffect(() => {
    const el = list.current
    if (!el || !enabled) return
    const measure = () => {
      const a = el.querySelector<HTMLElement>("[data-slot=tabs-trigger][data-state=active]")
      setInd((prev) =>
        a ? { x: a.offsetLeft, y: a.offsetTop, w: a.offsetWidth, h: a.offsetHeight, animate: prev !== null } : null
      )
    }
    measure()
    const mo = new MutationObserver(measure)
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.querySelectorAll("[data-slot=tabs-trigger]").forEach((t) => ro.observe(t))
    return () => {
      mo.disconnect()
      ro.disconnect()
    }
  }, [list, enabled])
  return ind
}

function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const ref = React.useRef<HTMLDivElement>(null)
  const ind = useIndicator(ref, variant === "default")
  return (
    <TabsPrimitive.List
      ref={ref}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), "relative", className)}
      {...props}
    >
      {ind && (
        <span
          aria-hidden="true"
          data-slot="tabs-indicator"
          className={cn(
            "pointer-events-none absolute top-0 left-0 rounded-full bg-background shadow-sm shadow-primary/20 ring-1 ring-primary/20 dark:bg-input/40 dark:ring-input",
            ind.animate && "transition-[transform,width,height] duration-500 ease-spring"
          )}
          style={{ transform: `translate(${ind.x}px, ${ind.y}px)`, width: ind.w, height: ind.h }}
        />
      )}
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative z-[1] inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-full border border-transparent px-3.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-[color,box-shadow] duration-300 ease-fluid group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:text-foreground dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none animate-in fade-in-0 duration-500 ease-fluid", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
