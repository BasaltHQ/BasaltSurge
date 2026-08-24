"use client";

import React, { useState, useEffect, useRef } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { MONTH_NAMES } from "./constants";
import { DobPickerProps } from "./types";

export function DobPicker({
  value,
  onChange,
  onBlur,
  isLightText = true,
  primaryColor = "#635BFF",
  hasError = false,
  isValid = false,
  onOpenStateChange,
}: DobPickerProps) {
  // Parse initial YYYY-MM-DD
  const [year, setYear] = useState(() => (value && value.includes("-") ? value.split("-")[0] : ""));
  const [month, setMonth] = useState(() => (value && value.includes("-") ? value.split("-")[1] : ""));
  const [day, setDay] = useState(() => (value && value.includes("-") ? value.split("-")[2] : ""));

  const [isOpen, setIsOpen] = useState(false);

  // Default view: selected year or 20 years ago
  const currentYear = new Date().getFullYear();
  const maxAllowedYear = currentYear;
  const [viewYear, setViewYear] = useState(() => (year ? parseInt(year, 10) : currentYear - 20));
  const [viewMonth, setViewMonth] = useState(() => (month ? parseInt(month, 10) - 1 : 0));

  const containerRef = useRef<HTMLDivElement>(null);
  const monthRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  // Sync internal state when external value changes
  useEffect(() => {
    if (value && value.includes("-")) {
      const [y, m, d] = value.split("-");
      if (y && y !== year) setYear(y);
      if (m && m !== month) setMonth(m);
      if (d && d !== day) setDay(d);
    } else if (!value) {
      setYear("");
      setMonth("");
      setDay("");
    }
  }, [value]);

  const triggerOnChange = (m: string, d: string, y: string) => {
    if (m && d && y && y.length === 4 && m.length === 2 && d.length === 2) {
      onChange(`${y}-${m}-${d}`);
    } else if (!m && !d && !y) {
      onChange("");
    } else {
      onChange(`${y || ""}-${m || ""}-${d || ""}`);
    }
  };

  const handleToggleOpen = () => {
    const next = !isOpen;
    setIsOpen(next);
    onOpenStateChange?.(next);
    if (next) {
      if (year && month) {
        setViewYear(parseInt(year, 10));
        setViewMonth(parseInt(month, 10) - 1);
      }
    }
  };

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        onOpenStateChange?.(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onOpenStateChange]);

  const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, "").slice(0, 2);
    if (val.length === 1 && parseInt(val, 10) > 1) {
      val = `0${val}`;
    }
    if (parseInt(val, 10) > 12) {
      val = "12";
    }
    setMonth(val);
    triggerOnChange(val, day, year);
    if (val.length === 2) {
      dayRef.current?.focus();
    }
  };

  const handleDayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, "").slice(0, 2);
    if (val.length === 1 && parseInt(val, 10) > 3) {
      val = `0${val}`;
    }
    if (parseInt(val, 10) > 31) {
      val = "31";
    }
    setDay(val);
    triggerOnChange(month, val, year);
    if (val.length === 2) {
      yearRef.current?.focus();
    }
  };

  const handleYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, "").slice(0, 4);
    setYear(val);
    triggerOnChange(month, day, val);
  };

  const handleKeyDown = (field: "m" | "d" | "y", e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (field === "d" && !day) {
        monthRef.current?.focus();
      } else if (field === "y" && !year) {
        dayRef.current?.focus();
      }
    } else if (e.key === "ArrowRight") {
      if (field === "m" && month.length > 0) dayRef.current?.focus();
      if (field === "d" && day.length > 0) yearRef.current?.focus();
    } else if (e.key === "ArrowLeft") {
      if (field === "y") dayRef.current?.focus();
      if (field === "d") monthRef.current?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text").trim();
    if (text.includes("-")) {
      const p = text.split("-");
      if (p.length === 3 && p[0].length === 4) {
        setYear(p[0]);
        setMonth(p[1].padStart(2, "0"));
        setDay(p[2].padStart(2, "0"));
        triggerOnChange(p[1].padStart(2, "0"), p[2].padStart(2, "0"), p[0]);
        e.preventDefault();
        return;
      }
    }
    const cleanDigits = text.replace(/\D/g, "");
    if (cleanDigits.length === 8) {
      const m = cleanDigits.slice(0, 2);
      const d = cleanDigits.slice(2, 4);
      const y = cleanDigits.slice(4, 8);
      setMonth(m);
      setDay(d);
      setYear(y);
      triggerOnChange(m, d, y);
      e.preventDefault();
    }
  };

  // Calendar calculations
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();

  const handleSelectDay = (selectedD: number) => {
    const mStr = String(viewMonth + 1).padStart(2, "0");
    const dStr = String(selectedD).padStart(2, "0");
    const yStr = String(viewYear);
    setMonth(mStr);
    setDay(dStr);
    setYear(yStr);
    onChange(`${yStr}-${mStr}-${dStr}`);
    setIsOpen(false);
    onOpenStateChange?.(false);
  };

  const isDateAllowed = (d: number) => {
    const date = new Date(viewYear, viewMonth, d);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return date <= today;
  };

  const yearOptions = [];
  for (let y = maxAllowedYear; y >= 1920; y--) {
    yearOptions.push(y);
  }

  const containerClass = hasError
    ? isLightText
      ? "bg-red-500/10 border-2 border-red-500/80 ring-1 ring-red-500/30"
      : "bg-red-50/80 border-2 border-red-500 ring-1 ring-red-500/20"
    : isValid
    ? isLightText
      ? "bg-emerald-500/5 border border-emerald-500/40"
      : "bg-emerald-50/40 border border-emerald-500/40"
    : isLightText
    ? "bg-white/5 border border-white/10 focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-400/30"
    : "bg-black/5 border border-black/10 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500/30";

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      {/* 3-Segment Input Container */}
      <div
        className={`w-full h-11 px-3 rounded-xl flex items-center justify-between transition-all select-none min-w-0 ${containerClass}`}
        onClick={() => {
          if (!month) monthRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-1.5 font-mono text-sm font-medium min-w-0 flex-1" onPaste={handlePaste}>
          <input
            ref={monthRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            placeholder="MM"
            value={month}
            onChange={handleMonthChange}
            onKeyDown={(e) => handleKeyDown("m", e)}
            onBlur={onBlur}
            className={`w-7 sm:w-8 text-center bg-transparent focus:outline-none placeholder:opacity-40 font-mono text-sm shrink-0 ${
              isLightText ? "text-white placeholder-white/30" : "text-black placeholder-black/30"
            }`}
          />
          <span className="opacity-30 text-sm shrink-0">/</span>
          <input
            ref={dayRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            placeholder="DD"
            value={day}
            onChange={handleDayChange}
            onKeyDown={(e) => handleKeyDown("d", e)}
            onBlur={onBlur}
            className={`w-7 sm:w-8 text-center bg-transparent focus:outline-none placeholder:opacity-40 font-mono text-sm shrink-0 ${
              isLightText ? "text-white placeholder-white/30" : "text-black placeholder-black/30"
            }`}
          />
          <span className="opacity-30 text-sm shrink-0">/</span>
          <input
            ref={yearRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            placeholder="YYYY"
            value={year}
            onChange={handleYearChange}
            onKeyDown={(e) => handleKeyDown("y", e)}
            onBlur={onBlur}
            className={`w-12 sm:w-14 text-center bg-transparent focus:outline-none placeholder:opacity-40 font-mono text-sm shrink-0 ${
              isLightText ? "text-white placeholder-white/30" : "text-black placeholder-black/30"
            }`}
          />
        </div>

        {/* Calendar Picker Trigger Button */}
        <button
          type="button"
          onClick={handleToggleOpen}
          aria-label="Toggle calendar picker"
          className={`p-1.5 rounded-lg transition flex items-center justify-center shrink-0 cursor-pointer ${
            isOpen
              ? "bg-amber-400/20 text-amber-400"
              : isLightText
              ? "text-white/60 hover:text-white hover:bg-white/10"
              : "text-black/60 hover:text-black hover:bg-black/10"
          }`}
        >
          <Calendar className="w-4 h-4" />
        </button>
      </div>

      {/* Interactive Calendar Popover */}
      {isOpen && (
        <div
          className={`pp-calendar-popover absolute z-50 mt-1.5 left-0 right-0 sm:left-auto sm:right-0 sm:w-72 max-w-[calc(100vw-2rem)] p-3 rounded-2xl shadow-2xl border backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150 ${
            isLightText
              ? "bg-[#141624] border-white/20 text-white shadow-black/80"
              : "bg-white border-black/15 text-black shadow-xl"
          }`}
          style={{ zIndex: 99999 }}
        >
          {/* Header Controls: Month & Year Dropdowns */}
          <div className="flex items-center justify-between gap-1.5 mb-2.5 pb-2 border-b border-white/10">
            <button
              type="button"
              onClick={() => {
                if (viewMonth === 0) {
                  setViewMonth(11);
                  setViewYear((y) => y - 1);
                } else {
                  setViewMonth((m) => m - 1);
                }
              }}
              className="p-1 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition cursor-pointer shrink-0"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-center gap-1 min-w-0">
              {/* Month Select */}
              <select
                value={viewMonth}
                onChange={(e) => setViewMonth(parseInt(e.target.value, 10))}
                className="bg-white/10 border border-white/15 rounded-lg px-2 py-1 text-xs font-bold text-white focus:outline-none cursor-pointer"
              >
                {MONTH_NAMES.map((name, idx) => (
                  <option key={name} value={idx} className="bg-[#141624] text-white">
                    {name.slice(0, 3)}
                  </option>
                ))}
              </select>

              {/* Year Select */}
              <select
                value={viewYear}
                onChange={(e) => setViewYear(parseInt(e.target.value, 10))}
                className="bg-white/10 border border-white/15 rounded-lg px-2 py-1 text-xs font-bold text-white focus:outline-none cursor-pointer"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y} className="bg-[#141624] text-white">
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              disabled={viewYear === maxAllowedYear && viewMonth >= new Date().getMonth()}
              onClick={() => {
                if (viewMonth === 11) {
                  setViewMonth(0);
                  setViewYear((y) => y + 1);
                } else {
                  setViewMonth((m) => m + 1);
                }
              }}
              className="p-1 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition disabled:opacity-30 cursor-pointer shrink-0"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Days of Week Row */}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wider opacity-50 mb-1">
            <span>Su</span>
            <span>Mo</span>
            <span>Tu</span>
            <span>We</span>
            <span>Th</span>
            <span>Fr</span>
            <span>Sa</span>
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="h-7 w-full" />
            ))}

            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dNum = i + 1;
              const allowed = isDateAllowed(dNum);
              const isSelected =
                parseInt(year, 10) === viewYear &&
                parseInt(month, 10) === viewMonth + 1 &&
                parseInt(day, 10) === dNum;

              return (
                <button
                  key={dNum}
                  type="button"
                  disabled={!allowed}
                  onClick={() => handleSelectDay(dNum)}
                  className={`h-7 w-full rounded-lg text-xs font-medium flex items-center justify-center transition cursor-pointer ${
                    isSelected
                      ? "text-white font-bold shadow-md ring-1 ring-white/40"
                      : allowed
                      ? "hover:bg-white/15 text-white/90"
                      : "opacity-20 cursor-not-allowed text-white/40"
                  }`}
                  style={isSelected ? { backgroundColor: primaryColor } : {}}
                >
                  {dNum}
                </button>
              );
            })}
          </div>

          {/* Footer note */}
          <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[10.5px]">
            <span className="text-white/50 font-medium truncate">Select Date of Birth</span>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onOpenStateChange?.(false);
              }}
              className="text-white/60 hover:text-white font-semibold underline cursor-pointer shrink-0 ml-2"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
