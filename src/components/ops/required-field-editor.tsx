"use client"

import { Plus, Trash2, GripVertical, Hash, List } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RequiredFieldOption {
  label: string
  value: number
}

export interface RequiredField {
  key: string
  label: string
  type: "number" | "select"
  min?: number
  max?: number
  defaultValue?: number
  options?: RequiredFieldOption[]
}

export interface RequiredFieldEditorProps {
  fields: RequiredField[]
  onChange: (fields: RequiredField[]) => void
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

/** Tiny inline label shown above / beside micro-inputs */
function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="shrink-0 leading-none"
      style={{ fontSize: "10px", color: "var(--anna-slate)" }}
    >
      {children}
    </span>
  )
}

/** Compact number input used for min / max / default */
function MiniInput({
  value,
  onChange,
  placeholder,
}: {
  value?: number
  onChange: (v: number | undefined) => void
  placeholder?: string
}) {
  return (
    <input
      type="number"
      value={value ?? ""}
      onChange={(e) => {
        const raw = e.target.value
        onChange(raw === "" ? undefined : Number(raw))
      }}
      placeholder={placeholder}
      className="h-6 w-14 rounded border px-1.5 text-xs outline-none transition-colors focus:ring-1"
      style={{
        borderColor: "var(--anna-border)",
        backgroundColor: "var(--anna-white)",
        color: "var(--anna-slate)",
      }}
    />
  )
}

/** Single select-option row inside a select field's options list */
function OptionRow({
  option,
  index,
  onUpdate,
  onRemove,
}: {
  option: RequiredFieldOption
  index: number
  onUpdate: (i: number, o: RequiredFieldOption) => void
  onRemove: (i: number) => void
}) {
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <input
        type="text"
        value={option.label}
        onChange={(e) => onUpdate(index, { ...option, label: e.target.value })}
        placeholder="Label"
        className="h-6 min-w-0 flex-1 rounded border px-1.5 text-[10px] outline-none transition-colors focus:ring-1"
        style={{
          borderColor: "var(--anna-border)",
          backgroundColor: "var(--anna-white)",
          color: "var(--anna-slate)",
        }}
      />
      <input
        type="number"
        value={option.value}
        onChange={(e) =>
          onUpdate(index, { ...option, value: Number(e.target.value) })
        }
        placeholder="Val"
        className="h-6 w-14 rounded border px-1.5 text-[10px] outline-none transition-colors focus:ring-1"
        style={{
          borderColor: "var(--anna-border)",
          backgroundColor: "var(--anna-white)",
          color: "var(--anna-slate)",
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-red-50"
            style={{ color: "var(--anna-red)" }}
          >
            <Trash2 className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Remove option</TooltipContent>
      </Tooltip>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function RequiredFieldEditor({
  fields: incomingFields,
  onChange,
}: RequiredFieldEditorProps) {
  // Defensive: ensure fields is always an array
  const fields = Array.isArray(incomingFields) ? incomingFields : [];

  /* ---- mutators ---- */

  const updateField = (index: number, patch: Partial<RequiredField>) => {
    const next = [...fields]
    const updated = { ...next[index], ...patch }
    if (patch.label !== undefined) {
      updated.key = slugify(patch.label)
    }
    if (updated.type === "select") {
      updated.min = undefined
      updated.max = undefined
      updated.defaultValue = undefined
      if (!updated.options) updated.options = []
    } else {
      updated.options = undefined
    }
    next[index] = updated
    onChange(next)
  }

  const removeField = (index: number) => {
    onChange(fields.filter((_, i) => i !== index))
  }

  const addField = () => {
    const newField: RequiredField = {
      key: `field_${fields.length + 1}`,
      label: "",
      type: "number",
    }
    onChange([...fields, newField])
  }

  /* ---- option helpers (scoped to a select-type field) ---- */

  const addOption = (fieldIndex: number) => {
    const field = fields[fieldIndex]
    const opts = [...(field.options ?? []), { label: "", value: 0 }]
    updateField(fieldIndex, { options: opts })
  }

  const updateOption = (
    fieldIndex: number,
    optIndex: number,
    opt: RequiredFieldOption,
  ) => {
    const field = fields[fieldIndex]
    const opts = [...(field.options ?? [])]
    opts[optIndex] = opt
    updateField(fieldIndex, { options: opts })
  }

  const removeOption = (fieldIndex: number, optIndex: number) => {
    const field = fields[fieldIndex]
    const opts = (field.options ?? []).filter((_, i) => i !== optIndex)
    updateField(fieldIndex, { options: opts })
  }

  /* ---- render ---- */

  return (
    <div className="flex flex-col gap-2">
      {fields.length === 0 && (
        <div
          className="rounded-md px-3 py-6 text-center text-xs"
          style={{
            color: "var(--anna-muted)",
            backgroundColor: "var(--anna-bg)",
            border: "1px dashed var(--anna-border)",
          }}
        >
          No required fields configured yet.
        </div>
      )}

      {fields.map((field, idx) => (
        <div
          key={idx}
          className="group rounded-lg p-3 transition-colors"
          style={{
            backgroundColor: "var(--anna-white)",
            border: "1px solid var(--anna-border)",
          }}
        >
          {/* Row 1: grip + badge + label + type selector + delete */}
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <GripVertical
                  className="size-3.5 shrink-0 cursor-grab"
                  style={{ color: "var(--anna-muted)" }}
                />
              </TooltipTrigger>
              <TooltipContent>Drag to reorder</TooltipContent>
            </Tooltip>

            <Badge
              variant="outline"
              className="h-6 shrink-0 gap-1 rounded-md px-1.5 text-[10px] font-normal"
              style={{
                borderColor: "var(--anna-border)",
                color: "var(--anna-sage-dark)",
                backgroundColor: "var(--anna-sage-light)",
              }}
            >
              {field.type === "number" ? (
                <Hash className="size-3" />
              ) : (
                <List className="size-3" />
              )}
              <span className="hidden sm:inline">
                {field.type === "number" ? "Num" : "Select"}
              </span>
            </Badge>

            <input
              type="text"
              value={field.label}
              onChange={(e) => updateField(idx, { label: e.target.value })}
              placeholder="Field label"
              className="h-7 min-w-0 flex-1 rounded-md border px-2 text-xs font-medium outline-none transition-colors focus:ring-1"
              style={{
                borderColor: "var(--anna-border)",
                backgroundColor: "var(--anna-bg)",
                color: "var(--anna-slate)",
              }}
            />

            <Select
              value={field.type}
              onValueChange={(v) =>
                updateField(idx, { type: v as "number" | "select" })
              }
            >
              <SelectTrigger
                size="sm"
                className="h-7 w-[90px] shrink-0 rounded-md border px-2 text-[10px]"
                style={{
                  borderColor: "var(--anna-border)",
                  color: "var(--anna-slate)",
                }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="number" className="text-xs">
                  Number
                </SelectItem>
                <SelectItem value="select" className="text-xs">
                  Select
                </SelectItem>
              </SelectContent>
            </Select>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => removeField(idx)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-red-50"
                  style={{ color: "var(--anna-red)" }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Delete field</TooltipContent>
            </Tooltip>
          </div>

          {/* Row 1b: auto-generated key */}
          {field.label && (
            <div
              className="mt-1.5 pl-[22px] text-[10px] leading-none"
              style={{ color: "var(--anna-muted)" }}
            >
              key: {slugify(field.label)}
            </div>
          )}

          {/* Row 2: type-specific controls */}
          {field.type === "number" && (
            <div className="mt-2 flex flex-wrap items-end gap-3 pl-[22px]">
              <div className="flex flex-col gap-0.5">
                <MicroLabel>Min</MicroLabel>
                <MiniInput
                  value={field.min}
                  onChange={(v) => updateField(idx, { min: v })}
                  placeholder="0"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <MicroLabel>Max</MicroLabel>
                <MiniInput
                  value={field.max}
                  onChange={(v) => updateField(idx, { max: v })}
                  placeholder="∞"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <MicroLabel>Default</MicroLabel>
                <MiniInput
                  value={field.defaultValue}
                  onChange={(v) => updateField(idx, { defaultValue: v })}
                  placeholder="—"
                />
              </div>
            </div>
          )}

          {field.type === "select" && (
            <div className="mt-2 pl-[22px]">
              <div className="mb-1 flex items-center justify-between">
                <MicroLabel>Options</MicroLabel>
                <button
                  type="button"
                  onClick={() => addOption(idx)}
                  className="flex items-center gap-0.5 text-[10px] font-medium transition-colors hover:opacity-80"
                  style={{ color: "var(--anna-sage-dark)" }}
                >
                  <Plus className="size-2.5" />
                  Add
                </button>
              </div>

              {(field.options ?? []).length === 0 ? (
                <div
                  className="rounded px-2 py-2 text-center text-[10px]"
                  style={{
                    color: "var(--anna-muted)",
                    backgroundColor: "var(--anna-bg)",
                  }}
                >
                  No options — click Add
                </div>
              ) : (
                <div
                  className="max-h-40 space-y-0.5 overflow-y-auto rounded-md p-1.5"
                  style={{
                    backgroundColor: "var(--anna-bg)",
                    border: "1px solid var(--anna-border)",
                  }}
                >
                  {field.options?.map((opt, oi) => (
                    <OptionRow
                      key={oi}
                      option={opt}
                      index={oi}
                      onUpdate={(i, o) => updateOption(idx, i, o)}
                      onRemove={(i) => removeOption(idx, i)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Add Field button */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addField}
        className="h-8 w-full gap-1.5 rounded-md text-xs"
        style={{
          borderColor: "var(--anna-border)",
          color: "var(--anna-sage-dark)",
          backgroundColor: "var(--anna-white)",
        }}
      >
        <Plus className="size-3.5" />
        Add Field
      </Button>
    </div>
  )
}
