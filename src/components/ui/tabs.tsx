import * as React from "react"
import { cn } from "@/lib/utils"

type TabsContextType = {
  value: string
  setValue: (v: string) => void
}

const TabsContext = React.createContext<TabsContextType | null>(null)

type TabsProps = React.HTMLAttributes<HTMLDivElement> & {
  defaultValue: string
  value?: string
  onValueChange?: (value: string) => void
}

const Tabs = ({ defaultValue, value: controlledValue, onValueChange, className, children, ...rest }: TabsProps) => {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue)
  const value = controlledValue ?? uncontrolledValue
  const setValue = React.useCallback((nextValue: string) => {
    if (controlledValue === undefined) {
      setUncontrolledValue(nextValue)
    }
    onValueChange?.(nextValue)
  }, [controlledValue, onValueChange])

  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div className={className} {...rest}>{children}</div>
    </TabsContext.Provider>
  )
}

const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
        className
      )}
      {...props}
    />
  )
)
TabsList.displayName = "TabsList"

type TabsTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(({ className, value, onClick, ...props }, ref) => {
  const ctx = React.useContext(TabsContext)
  const active = ctx?.value === value
  return (
    <button
      ref={ref}
      data-state={active ? "active" : "inactive"}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        active && "bg-background text-foreground shadow-sm",
        className
      )}
      aria-pressed={active}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) {
          ctx?.setValue(value)
        }
      }}
      {...props}
    />
  )
})
TabsTrigger.displayName = "TabsTrigger"

type TabsContentProps = React.HTMLAttributes<HTMLDivElement> & { value: string }

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(({ className, value, ...props }, ref) => {
  const ctx = React.useContext(TabsContext)
  const isActive = ctx?.value === value
  if (!isActive) return null
  return (
    <div
      ref={ref}
      className={cn(
        "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      {...props}
    />
  )
})
TabsContent.displayName = "TabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent }
