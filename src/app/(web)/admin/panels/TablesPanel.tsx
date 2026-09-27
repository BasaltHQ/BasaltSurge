"use client";

import React, { useState, useEffect } from "react";
import { useActiveAccount } from "thirdweb/react";
import { Plus, Trash2, LayoutGrid, List } from "lucide-react";

export default function TablesPanel() {
    const account = useActiveAccount();
    const [tables, setTables] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [newTable, setNewTable] = useState("");
    const [saving, setSaving] = useState(false);

    // Load configuration
    useEffect(() => {
        async function load() {
            if (!account?.address) return;
            try {
                setLoading(true);
                const res = await fetch("/api/site/config", {
                    headers: { "x-wallet": account.address }
                });
                const data = await res.json();
                const existingTables = data?.config?.industryParams?.restaurant?.tables || [];
                // Support legacy or flat formats if any, but default to array of strings
                setTables(Array.isArray(existingTables) ? existingTables : []);
            } catch (e) {
                console.error("Failed to load tables", e);
                setError("Failed to load tables");
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [account?.address]);

    async function saveTables(newTables: string[]) {
        if (!account?.address) return;
        try {
            setSaving(true);
            setError("");

            // We need to merge with existing config to not lose other industry params
            const fetchRes = await fetch("/api/site/config", { headers: { "x-wallet": account.address } });
            const fetchData = await fetchRes.json();
            const currentConfig = fetchData.config || {};

            const newIndustryParams = {
                ...(currentConfig.industryParams || {}),
                restaurant: {
                    ...(currentConfig.industryParams?.restaurant || {}),
                    tables: newTables
                }
            };

            const res = await fetch("/api/site/config", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-wallet": account.address,
                },
                body: JSON.stringify({
                    industryParams: newIndustryParams
                }),
            });

            if (!res.ok) throw new Error("Failed to save tables");

            setTables(newTables);
        } catch (e) {
            console.error("Failed to save tables", e);
            setError("Failed to save tables");
        } finally {
            setSaving(false);
        }
    }

    const addTable = async () => {
        if (!newTable.trim()) return;
        if (tables.includes(newTable.trim())) {
            setError("Table identifier already exists");
            return;
        }
        const updated = [...tables, newTable.trim()].sort((a, b) => {
            // Try numeric sort
            const numA = parseInt(a);
            const numB = parseInt(b);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.localeCompare(b);
        });
        await saveTables(updated);
        setNewTable("");
    };

    const removeTable = async (table: string) => {
        const updated = tables.filter(t => t !== table);
        await saveTables(updated);
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            addTable();
        }
    };

    if (!account?.address) return <div className="p-4">Please connect your wallet.</div>;

    return (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 w-full space-y-6 pb-24">
            <div data-tour="tables.restaurant-tables">
                <h2 className="text-xl font-semibold">Restaurant Tables</h2>
                <p className="text-sm text-muted-foreground mt-1">
                    Manage your table identifiers. These will be available for selection on the Handheld devices.
                </p>
            </div>

            <div className="flex gap-2 max-w-md">
                <input data-tour="tables.table-naming"
                    type="text"
                    value={newTable}
                    onChange={(e) => setNewTable(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="Enter table number or name (e.g. '1', 'Patio 2')"
                    className="flex-1 px-3 py-2 rounded-md bg-transparent border border-white/10 focus:outline-none focus:border-white/20"
                    disabled={saving}
                />
                <button
                    onClick={addTable}
                    disabled={!newTable.trim() || saving}
                    className="px-4 py-2 bg-emerald-500 text-black font-medium rounded-md hover:bg-emerald-400 disabled:opacity-50 flex items-center gap-2"
                >
                    <Plus className="w-4 h-4" />
                    Add
                </button>
            </div>

            {error && <div className="text-red-400 text-sm">{error}</div>}

            {loading ? (
                <div className="text-muted-foreground">Loading tables...</div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {tables.map(table => (
                        <div key={table} className="flex items-center justify-between p-3 rounded-lg border border-white/10 bg-white/5 group">
                            <span className="font-mono font-medium">{table}</span>
                            <button
                                onClick={() => removeTable(table)}
                                className="text-white/40 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                title="Remove table"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                    {tables.length === 0 && (
                        <div className="col-span-full py-8 text-center text-muted-foreground border border-dashed border-white/10 rounded-lg">
                            No tables configured. Add one above.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
