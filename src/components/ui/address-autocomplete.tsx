"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search, CheckCircle2, ShieldCheck, MapPin, Loader2 } from "lucide-react";

export type AddressData = {
  fullName: string;
  streetAddress: string;
  apartment: string;
  city: string;
  state: string;
  zip: string;
  country: string;
};

interface AddressFormProps {
  initialValues?: Partial<AddressData>;
  onChange?: (data: AddressData) => void;
  onSubmit?: (data: AddressData) => void;
}

export function AddressAutocompleteForm({
  initialValues,
  onChange,
  onSubmit,
}: AddressFormProps) {
  const [formData, setFormData] = useState<AddressData>({
    fullName: initialValues?.fullName || "",
    streetAddress: initialValues?.streetAddress || "",
    apartment: initialValues?.apartment || "",
    city: initialValues?.city || "",
    state: initialValues?.state || "",
    zip: initialValues?.zip || "",
    country: initialValues?.country || "US",
  });

  const [query, setQuery] = useState(initialValues?.streetAddress || "");
  const [predictions, setPredictions] = useState<Array<{ placeId: string; description: string; mainText: string; secondaryText: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Debounced autocomplete search
  useEffect(() => {
    if (!query || query.trim().length < 3 || isVerified) {
      setPredictions([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/address/autocomplete?input=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data.predictions) {
          setPredictions(data.predictions);
          setShowDropdown(data.predictions.length > 0);
        }
      } catch (err) {
        console.error("Autocomplete search failed:", err);
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, isVerified]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectPrediction = async (placeId: string, description: string) => {
    setIsResolving(true);
    setShowDropdown(false);
    setQuery(description);
    try {
      const res = await fetch(`/api/address/autocomplete?placeId=${encodeURIComponent(placeId)}`);
      const data = await res.json();
      if (data && !data.error) {
        const updated: AddressData = {
          ...formData,
          streetAddress: data.streetAddress || description,
          apartment: data.apartment || formData.apartment,
          city: data.city || formData.city,
          state: data.state || formData.state,
          zip: data.zip || formData.zip,
          country: data.country || formData.country || "US",
        };
        setFormData(updated);
        setQuery(data.streetAddress || description);
        setIsVerified(true);
        onChange?.(updated);
      }
    } catch (err) {
      console.error("Failed to resolve place details:", err);
    } finally {
      setIsResolving(false);
    }
  };

  const handleInputChange = (field: keyof AddressData, value: string) => {
    const updated = { ...formData, [field]: value };
    setFormData(updated);
    if (field === "streetAddress") {
      setQuery(value);
      setIsVerified(false);
    }
    onChange?.(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit?.(formData);
  };

  return (
    <div className="w-full max-w-lg mx-auto bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl text-white font-sans">
      {/* Header Section with Updated Compliance Copy */}
      <div className="flex items-start gap-3 mb-6 pb-4 border-b border-gray-800">
        <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 mt-0.5">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white tracking-tight">
            Legal Personal Identity
          </h3>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            Please enter your <strong className="text-gray-200">legal full name</strong> and <strong className="text-gray-200">home residential address</strong> as they appear on your government-issued ID.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Full Name */}
        <div>
          <label className="block text-xs font-medium text-gray-300 uppercase tracking-wider mb-1.5">
            Legal Full Name
          </label>
          <input
            type="text"
            required
            placeholder="Johnathan Doe"
            value={formData.fullName}
            onChange={(e) => handleInputChange("fullName", e.target.value)}
            className="w-full px-3.5 py-2.5 bg-gray-800/80 border border-gray-700 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition"
          />
        </div>

        {/* Autocomplete Street Address Input */}
        <div className="relative" ref={dropdownRef}>
          <label className="block text-xs font-medium text-gray-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span>Home Address</span>
            {isVerified && (
              <span className="text-[10px] normal-case text-emerald-400 flex items-center gap-1 font-normal">
                <CheckCircle2 className="w-3 h-3" /> Verified Address
              </span>
            )}
          </label>
          <div className="relative">
            <input
              type="text"
              required
              placeholder="Start typing your home address..."
              value={query}
              onChange={(e) => handleInputChange("streetAddress", e.target.value)}
              onFocus={() => predictions.length > 0 && setShowDropdown(true)}
              className="w-full pl-10 pr-10 py-2.5 bg-gray-800/80 border border-gray-700 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition"
            />
            <MapPin className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
            {isLoading || isResolving ? (
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin absolute right-3.5 top-3" />
            ) : isVerified ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 absolute right-3.5 top-3" />
            ) : null}
          </div>

          {/* Helper Microcopy */}
          <p className="text-[11px] font-medium text-amber-400/90 mt-1.5 flex items-center gap-1.5">
            <span>💡 Use your home residential address (no P.O. Boxes or business addresses).</span>
          </p>

          {/* Google Places Suggestions Dropdown */}
          {showDropdown && predictions.length > 0 && (
            <div
              className="absolute z-[999] left-0 right-0 mt-1 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden divide-y divide-gray-700/50 max-h-60 overflow-y-auto"
              style={{ backgroundColor: "#111827", opacity: 1 }}
            >
              {/* Header with Mobile Close Button */}
              <div className="px-3.5 py-2 bg-gray-950 border-b border-gray-700/60 flex items-center justify-between text-[10px] font-semibold text-gray-400 uppercase tracking-wider" style={{ backgroundColor: "#030712" }}>
                <span>Address Suggestions</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowDropdown(false);
                  }}
                  className="px-2 py-0.5 rounded-md hover:bg-gray-700 active:scale-95 transition text-[10px] font-bold text-gray-300 hover:text-white"
                >
                  ✕ Close
                </button>
              </div>

              {predictions.map((p) => (
                <button
                  key={p.placeId}
                  type="button"
                  onClick={() => handleSelectPrediction(p.placeId, p.description)}
                  className="w-full text-left px-4 py-3 hover:bg-blue-600/20 hover:text-white transition flex items-start gap-3 group"
                >
                  <MapPin className="w-4 h-4 text-gray-400 group-hover:text-blue-400 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-gray-100 group-hover:text-blue-200">
                      {p.mainText}
                    </div>
                    {p.secondaryText && (
                      <div className="text-xs text-gray-400 group-hover:text-gray-300 mt-0.5">
                        {p.secondaryText}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Apt / Suite (Optional) */}
        <div>
          <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1.5">
            Apartment / Suite <span className="text-gray-500 font-normal">(Optional)</span>
          </label>
          <input
            type="text"
            placeholder="Apt 4B"
            value={formData.apartment}
            onChange={(e) => handleInputChange("apartment", e.target.value)}
            className="w-full px-3.5 py-2.5 bg-gray-800/80 border border-gray-700 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition"
          />
        </div>

        {/* City & State Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-300 uppercase tracking-wider mb-1.5">
              City
            </label>
            <input
              type="text"
              required
              placeholder="San Francisco"
              value={formData.city}
              onChange={(e) => handleInputChange("city", e.target.value)}
              className="w-full px-3.5 py-2.5 bg-gray-800/80 border border-gray-700 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-300 uppercase tracking-wider mb-1.5">
              State / Province
            </label>
            <input
              type="text"
              required
              placeholder="CA"
              value={formData.state}
              onChange={(e) => handleInputChange("state", e.target.value)}
              className="w-full px-3.5 py-2.5 bg-gray-800/80 border border-gray-700 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition"
            />
          </div>
        </div>

        {/* ZIP & Country Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-300 uppercase tracking-wider mb-1.5">
              ZIP / Postal Code
            </label>
            <input
              type="text"
              required
              placeholder="94105"
              value={formData.zip}
              onChange={(e) => handleInputChange("zip", e.target.value)}
              className="w-full px-3.5 py-2.5 bg-gray-800/80 border border-gray-700 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-300 uppercase tracking-wider mb-1.5">
              Country
            </label>
            <select
              value={formData.country}
              onChange={(e) => handleInputChange("country", e.target.value)}
              className="w-full px-3.5 py-2.5 bg-gray-800/80 border border-gray-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition"
            >
              <option value="US">United States (US)</option>
              <option value="CA">Canada (CA)</option>
              <option value="GB">United Kingdom (GB)</option>
              <option value="AU">Australia (AU)</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          className="w-full mt-4 py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium text-sm rounded-xl shadow-lg shadow-blue-500/20 active:scale-[0.99] transition"
        >
          Confirm Legal Identity
        </button>
      </form>
    </div>
  );
}
