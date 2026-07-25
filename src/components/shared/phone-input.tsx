"use client";

import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Phone, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { validateSgPhone } from "@/lib/phone-validation";

interface PhoneInputProps {
  value?: string;
  onChange: (normalized: string, raw: string) => void;
  label?: string;
  required?: boolean;
  error?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Show validation status icon */
  showStatus?: boolean;
  placeholder?: string;
}

/**
 * Singapore phone input with +65 prefix, 8-digit validation,
 * and real-time format feedback.
 */
export function PhoneInput({
  value,
  onChange,
  label = "Mobile Number",
  required = false,
  error: externalError,
  disabled = false,
  className,
  id = "phone-input",
  showStatus = true,
  placeholder = "9123 4567",
}: PhoneInputProps) {
  // Local editing state — initialized from external value
  const [localDigits, setLocalDigits] = useState(() => {
    if (!value) return "";
    return value.replace(/^\+65/, "").replace(/[\s\-\.]/g, "");
  });

  const [validation, setValidation] = useState<{
    valid: boolean;
    error?: string;
  } | null>(null);

  // Format digits for display: XXXX XXXX
  const displayValue = (() => {
    const digits = localDigits.replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 4) return digits;
    return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  })();

  const isComplete = localDigits.replace(/\D/g, "").length === 8;
  const hasError = externalError || (validation && !validation.valid);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const digitsOnly = e.target.value.replace(/[^\d]/g, "").slice(0, 8);
      setLocalDigits(digitsOnly);
      setValidation(null);

      if (digitsOnly.length === 8) {
        const result = validateSgPhone(digitsOnly);
        setValidation({ valid: result.valid, error: result.error });
        if (result.valid && result.normalized) {
          onChange(result.normalized, digitsOnly);
        }
      } else if (digitsOnly.length > 0) {
        onChange(`+65${digitsOnly}`, digitsOnly);
      } else {
        onChange("", "");
      }
    },
    [onChange]
  );

  const handleBlur = useCallback(() => {
    if (localDigits.length > 0 && localDigits.length < 8) {
      const result = validateSgPhone(localDigits);
      setValidation({ valid: result.valid, error: result.error });
    }
  }, [localDigits]);

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </Label>
      )}
      <div className="relative">
        {/* +65 prefix */}
        <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
          <Phone size={14} className="text-[var(--anna-muted)]" />
          <span className="text-sm font-medium text-[var(--anna-slate-light)]">
            +65
          </span>
        </div>
        <Input
          id={id}
          type="tel"
          inputMode="numeric"
          value={displayValue}
          onChange={handleChange}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder={placeholder}
          className={cn(
            "pl-[68px] pr-10 h-10 text-sm",
            hasError && "border-red-400 focus-visible:ring-red-400",
            isComplete && !hasError && "border-[var(--anna-success)]/50"
          )}
        />
        {/* Validation status */}
        {showStatus && isComplete && validation && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {validation.valid ? (
              <CheckCircle2
                size={16}
                className="text-[var(--anna-success)]"
              />
            ) : (
              <XCircle size={16} className="text-red-400" />
            )}
          </div>
        )}
      </div>
      {/* Error message */}
      {(externalError || (validation && validation.error)) && (
        <p className="text-xs text-red-500">
          {externalError || validation.error}
        </p>
      )}
    </div>
  );
}
