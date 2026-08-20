import React from "react";
import { Check, Edit2 } from "lucide-react";
import { AccordionStepHeaderProps } from "./types";

export function AccordionStepHeader({
  stepNumber,
  title,
  subtitle,
  badge,
  isActive,
  isCompleted,
  isLocked = false,
  isLightText = true,
  canEdit = true,
  onHeaderClick,
}: AccordionStepHeaderProps) {
  const isClickable = !isLocked && isCompleted && !isActive && canEdit;

  return (
    <div
      onClick={() => {
        if (isClickable) onHeaderClick?.();
      }}
      className={`p-3 sm:p-3.5 flex items-center justify-between gap-2 select-none min-w-0 ${
        isClickable ? "cursor-pointer hover:bg-white/[0.04]" : "cursor-default"
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {isCompleted && !isActive ? (
          <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40 shrink-0">
            <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
          </div>
        ) : (
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
              isActive ? "bg-amber-500 text-black shadow-sm" : "bg-white/10 text-white/40"
            }`}
          >
            {stepNumber}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <h4 className={`text-xs font-bold tracking-tight truncate ${isLightText ? "text-white" : "text-black"}`}>
              {title}
            </h4>
            {badge}
          </div>

          {subtitle}
        </div>
      </div>

      {isCompleted && !isActive && !isLocked && canEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!isLocked) onHeaderClick?.();
          }}
          className="text-[11px] font-semibold text-amber-400 flex items-center gap-1 hover:underline cursor-pointer shrink-0 ml-1"
        >
          <Edit2 className="w-3 h-3" /> Edit
        </button>
      )}
    </div>
  );
}
