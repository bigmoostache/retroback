import { useId, useState, type FormEvent } from "react"
import { kebab } from "@engine/flags.ts"
import type { OpInfo, OpResponse } from "@engine/types.ts"
import { CommandLine } from "@/components/ops/CommandLine"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import { Input as TextField } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { toCommand, type Input } from "@/lib/api"
import { asText, fieldsOf, startValues, toInput, type FormSetup } from "@/lib/opInput"

type Prop = NonNullable<OpInfo["input"]["properties"]>[string]

const NONE: Input = {}
const LONG_TEXT = new Set(["description", "target", "text"])
const SELECT =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 py-1 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30 dark:[color-scheme:dark]"

/** `presentValue` -> `Present value`. */
function label(key: string) {
  const words = kebab(key).replace(/-/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function Control({
  id,
  name,
  prop,
  value,
  onChange,
}: {
  id: string
  name: string
  prop: Prop
  value: string
  onChange: (value: string) => void
}) {
  const fallback = asText(prop.default)
  const placeholder = fallback ? `default: ${fallback}` : ""
  if (prop.enum || prop.type === "boolean") {
    return (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={SELECT}>
        <option value="">(not set)</option>
        {(prop.enum ?? ["true", "false"]).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
  }
  if (prop.type === "array") {
    return (
      <Textarea id={id} value={value} rows={3} placeholder="One per line" onChange={(e) => onChange(e.target.value)} />
    )
  }
  if (LONG_TEXT.has(name)) {
    return <Textarea id={id} value={value} rows={2} onChange={(e) => onChange(e.target.value)} />
  }
  const numeric = prop.type === "number" || prop.type === "integer"
  return (
    <TextField
      id={id}
      value={value}
      placeholder={placeholder}
      inputMode={numeric ? "decimal" : "text"}
      className={numeric ? "font-mono tabular-nums" : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/**
 * The form of one operation, generated from its JSON Schema: the same list of
 * inputs the CLI turns into flags. It shows the `rb` command for the values
 * typed so far, and the error the engine answers.
 */
export function OpForm({
  info,
  fixed = NONE,
  initial = NONE,
  changesOnly = false,
  submitLabel = "Run",
  destructive = false,
  onRun,
  onDone,
  onCancel,
}: {
  info: OpInfo
  fixed?: Input | undefined
  initial?: Input | undefined
  changesOnly?: boolean | undefined
  submitLabel?: string | undefined
  destructive?: boolean | undefined
  onRun: (input: Input) => Promise<OpResponse<unknown>>
  onDone?: ((result: unknown) => void) | undefined
  onCancel?: (() => void) | undefined
}) {
  const setup: FormSetup = { fixed, initial, changesOnly }
  const base = useId()
  const [values, setValues] = useState(() => startValues(info, setup))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fields = fieldsOf(info, fixed)
  const required = new Set(info.input.required ?? [])
  const built = toInput(info, values, setup)
  // An update with no field changed has nothing to send.
  const idle = changesOnly && Object.keys(built.input).every((key) => key in fixed)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (built.error) {
      setError(built.error)
      return
    }
    setBusy(true)
    setError(null)
    const response = await onRun(built.input)
    setBusy(false)
    if (response.ok) onDone?.(response.result)
    else setError(response.error.message)
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      {fields.length > 0 && (
        <div className="flex flex-col gap-3">
          {fields.map(([key, prop]) => (
            <div key={key} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <label htmlFor={`${base}-${key}`} className="text-callout font-medium text-foreground">
                  {label(key)}
                </label>
                {required.has(key) && <span className="text-caption text-muted-foreground">required</span>}
                <code className="ml-auto font-mono text-caption text-muted-foreground/60">--{kebab(key)}</code>
              </div>
              <Control
                id={`${base}-${key}`}
                name={key}
                prop={prop}
                value={values[key] ?? ""}
                onChange={(value) => setValues((current) => ({ ...current, [key]: value }))}
              />
              {prop.description && <p className="text-caption text-muted-foreground">{prop.description}</p>}
            </div>
          ))}
        </div>
      )}
      <CommandLine command={toCommand(info.name, built.input)} />
      {error && (
        <p role="alert" className="text-callout break-words text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <button
          type="submit"
          disabled={busy || idle}
          className={buttonVariants({ variant: destructive ? "destructive" : "signal", size: "sm" })}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
