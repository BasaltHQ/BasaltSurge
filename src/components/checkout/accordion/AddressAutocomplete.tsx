"use client";

import React from "react";
import { MapPin, Search } from "lucide-react";

export interface AddressSuggestionItem {
  mainText?: string;
  description?: string;
  secondaryText?: string;
  place_id?: string;
  [key: string]: any;
}

export interface AddressAutocompleteProps {
  addressSearchInput: string;
  setAddressSearchInput: (val: string) => void;
  setIsAddressParsed: (val: boolean) => void;
  onFetchSuggestions: (val: string) => void;
  onSelectSuggestion: (item: AddressSuggestionItem) => void;
  addressSuggestions: AddressSuggestionItem[];
  showSuggestions: boolean;
  onSwitchToManual: () => void;
  isLightText?: boolean;
  inputClassName?: string;
}

export function AddressAutocomplete({
  addressSearchInput,
  setAddressSearchInput,
  setIsAddressParsed,
  onFetchSuggestions,
  onSelectSuggestion,
  addressSuggestions,
  showSuggestions,
  onSwitchToManual,
  isLightText = true,
  inputClassName = "",
}: AddressAutocompleteProps) {
  return (
    <div className="relative">
      <label
        className={`flex items-center justify-between text-xs font-bold uppercase tracking-wider mb-1.5 ${
          isLightText ? "text-white/60" : "text-black/60"
        }`}
      >
        <span className="flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-amber-400" /> Residential Street Address
        </span>
        <button
          type="button"
          onClick={onSwitchToManual}
          className="text-xs text-amber-400 hover:underline cursor-pointer lowercase"
        >
          (enter manually)
        </button>
      </label>
      <div className="relative">
        <input
          type="text"
          placeholder="Search street address or place..."
          value={addressSearchInput}
          onChange={(e) => {
            setAddressSearchInput(e.target.value);
            setIsAddressParsed(false);
            onFetchSuggestions(e.target.value);
          }}
          className={`w-full h-11 px-3.5 pl-10 rounded-xl focus:outline-none transition-all text-sm font-medium ${inputClassName}`}
        />
        <Search className="w-4 h-4 absolute left-3.5 top-3.5 opacity-50 text-amber-400" />
      </div>

      {/* Autocomplete Dropdown List */}
      {showSuggestions && addressSuggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl bg-neutral-900 border border-white/15 shadow-2xl overflow-hidden max-h-52 overflow-y-auto divide-y divide-white/5 animate-in fade-in zoom-in-95">
          {addressSuggestions.map((item, i) => (
            <div
              key={i}
              onClick={() => onSelectSuggestion(item)}
              className="p-3 text-sm text-left hover:bg-white/10 cursor-pointer flex items-start gap-2.5 transition"
            >
              <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <div>
                <div className="font-semibold text-white">
                  {item.mainText || item.description}
                </div>
                {item.secondaryText && (
                  <div className="text-xs text-zinc-400">{item.secondaryText}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
