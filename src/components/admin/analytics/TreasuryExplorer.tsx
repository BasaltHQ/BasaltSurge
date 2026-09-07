"use client";

import React, { useId, useMemo, useState } from "react";
import { useChartViewport } from "./useChartViewport";
import { ChevronLeft, ChevronRight, Table2 } from "lucide-react";
import { buildTreasuryScenarios, normalizeTreasuryHistory, treasuryValue, type TreasuryScenario, type TreasuryScenarioMode } from "./treasury-model";

export interface TreasuryExplorerProps {
  data: Array<Record<string, unknown>>;
  tokenPrices: Record<string, number>;
}

const TOKEN_COLORS: Record<string, string> = {
  totalUsd: "#e4e4e7", USDC: "#60a5fa", USDT: "#34d399", cbBTC: "#fbbf24",
  cbXRP: "#f472b6", SOL: "#c084fc", ETH: "#818cf8",
};
const SCENARIOS: TreasuryScenario[] = ["conservative", "standard", "aggressive"];
const SCENARIO_COLORS = { conservative: "#38bdf8", standard: "#c084fc", aggressive: "#fbbf24" };
const money = (value: number | null) => value === null ? "Unavailable" : value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const units = (value: number | null) => value === null ? "Unavailable" : value.toLocaleString("en-US", { maximumFractionDigits: 8 });
const tokenLabel = (token: string) => token === "totalUsd" ? "Total portfolio" : token;
const scenarioLabel = (scenario: TreasuryScenario) => scenario.charAt(0).toUpperCase() + scenario.slice(1);

/** Treasury history and explicit, editable compound-growth scenarios. */
export default function TreasuryExplorer({ data, tokenPrices }: TreasuryExplorerProps) {
  const id = useId();
  const viewport = useChartViewport();
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [hoveredToken, setHoveredToken] = useState<string | null>(null);
  const [observationIndex, setObservationIndex] = useState<number | null>(null);
  const [activeTrend, setActiveTrend] = useState<TreasuryScenarioMode>("none");
  const [dailyRate, setDailyRate] = useState("0");
  const [scenarioSpread, setScenarioSpread] = useState("0.25");
  const [showTable, setShowTable] = useState(false);

  // Hooks always run, including an empty response followed by a successful refresh.
  const { history, tokens, omittedDates } = useMemo(() => normalizeTreasuryHistory(data, tokenPrices), [data, tokenPrices]);
  const latest = history[history.length - 1];
  const scenarios = useMemo(() => buildTreasuryScenarios(latest, dailyRate.trim() ? Number(dailyRate) : NaN, scenarioSpread.trim() ? Number(scenarioSpread) : NaN), [latest, dailyRate, scenarioSpread]);
  const visibleScenarios = activeTrend === "none" ? [] : activeTrend === "all" ? SCENARIOS : [activeTrend];
  const forecast = activeTrend !== "none" ? scenarios : null;
  const series = ["totalUsd", ...tokens];
  const activeToken = selectedToken && series.includes(selectedToken) ? selectedToken : null;
  const highlight = hoveredToken || activeToken;
  const readoutToken = highlight || "totalUsd";
  const index = history.length ? Math.min(observationIndex ?? history.length - 1, history.length - 1) : 0;
  const observation = history[index];

  const axis = useMemo(() => {
    const values = history.flatMap(row => [row.totalUsd, ...tokens.map(token => row.tokens[token].valueUsd)]).filter((value): value is number => value !== null);
    if (forecast) for (const point of forecast.points) for (const scenario of visibleScenarios) if (point[scenario] !== null) values.push(point[scenario]!);
    const minimum = Math.min(0, ...values);
    const maximum = Math.max(0, ...values);
    const padding = maximum === minimum ? 1 : (maximum - minimum) * 0.08;
    return { minimum: minimum < 0 ? minimum - padding : 0, maximum: maximum + padding };
  }, [history, tokens, forecast, activeTrend]);

  if (!history.length) {
    return <div role="status" className="rounded-xl border border-dashed border-white/15 p-8 text-center text-sm text-white/60">No treasury balance history is available.{omittedDates > 0 && " Returned observations did not contain valid dates."}</div>;
  }

  const firstTimestamp = history[0].timestamp;
  const lastTimestamp = forecast?.points[forecast.points.length - 1].timestamp ?? latest.timestamp;
  const x = (timestamp: number) => lastTimestamp === firstTimestamp ? viewport.width / 2 : 75 + ((timestamp - firstTimestamp) / (lastTimestamp - firstTimestamp)) * (viewport.width - 105);
  const y = (value: number) => 280 - ((value - axis.minimum) / (axis.maximum - axis.minimum)) * 255;
  const pathFor = (points: Array<{ timestamp: number; value: number | null }>) => {
    let open = false;
    return points.map(point => {
      if (point.value === null) { open = false; return ""; }
      const result = `${open ? "L" : "M"} ${x(point.timestamp)} ${y(point.value)}`;
      open = true;
      return result;
    }).join(" ");
  };
  const changeIndex = (delta: number) => setObservationIndex(Math.max(0, Math.min(history.length - 1, index + delta)));

  return (
    <div className="min-w-0 space-y-5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs text-white/60">Latest reported portfolio value · {latest.date}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{money(latest.totalUsd)}</div>
        </div>
        <button type="button" onClick={() => setShowTable(value => !value)} aria-expanded={showTable} aria-controls={`${id}-table`} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 px-3 text-xs font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <Table2 aria-hidden="true" className="h-4 w-4" />{showTable ? "Hide data table" : "View data table"}
        </button>
      </div>

      <div role="group" aria-label="Highlight treasury series" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={activeToken === null} onClick={() => setSelectedToken(null)} className={`min-h-10 rounded-lg border px-3 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${activeToken === null ? "border-primary bg-primary/15 text-white" : "border-white/15 text-white/65"}`}>Show all</button>
        {series.map(token => <button type="button" key={token} aria-pressed={activeToken === token} onClick={() => setSelectedToken(current => current === token ? null : token)} onMouseEnter={() => setHoveredToken(token)} onMouseLeave={() => setHoveredToken(null)} onFocus={() => setHoveredToken(token)} onBlur={() => setHoveredToken(null)} className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${activeToken === token ? "border-primary bg-primary/15 text-white" : "border-white/15 text-white/70"}`}>
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TOKEN_COLORS[token] || "#94a3b8" }} />{tokenLabel(token)}
        </button>)}
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label htmlFor={`${id}-scenario`} className="flex items-center gap-3 text-xs font-medium text-white/80">Scenario view
            <select id={`${id}-scenario`} value={activeTrend} onChange={event => setActiveTrend(event.target.value as TreasuryScenarioMode)} className="min-h-10 rounded-lg border border-white/15 bg-zinc-950 px-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              <option value="none">None</option><option value="standard">Standard</option><option value="conservative">Conservative</option><option value="aggressive">Aggressive</option><option value="all">All scenarios</option>
            </select>
          </label>
          <span className="text-xs text-white/50">All supplied history retained · {history.length.toLocaleString()} observations</span>
        </div>
        {activeTrend !== "none" && <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
          <div className="flex flex-wrap gap-4">
            <label htmlFor={`${id}-rate`} className="flex flex-col gap-1.5 text-xs text-white/75">Standard daily change (%)
              <input id={`${id}-rate`} type="number" min={-100} max={100} step="0.1" value={dailyRate} onChange={event => setDailyRate(event.target.value)} aria-describedby={`${id}-assumptions`} className="min-h-10 w-40 rounded-lg border border-white/15 bg-zinc-950 px-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
            </label>
            <label htmlFor={`${id}-spread`} className="flex flex-col gap-1.5 text-xs text-white/75">Scenario spread (percentage points)
              <input id={`${id}-spread`} type="number" min={0} max={100} step="0.05" value={scenarioSpread} onChange={event => setScenarioSpread(event.target.value)} aria-describedby={`${id}-assumptions`} className="min-h-10 w-40 rounded-lg border border-white/15 bg-zinc-950 px-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
            </label>
          </div>
          <p id={`${id}-assumptions`} className="max-w-3xl text-xs leading-relaxed text-white/60">Illustrative 30-day scenarios use the latest reported total × (1 + daily change / 100)<sup>days</sup>. Conservative subtracts the spread; aggressive adds it. The minimum possible daily change is −100%. Assumptions are editable and are not estimates of future deposits, withdrawals, token prices, or a statistical confidence interval.</p>
          {!scenarios ? <p role="status" className="text-xs text-amber-300">Scenarios require an available non-negative latest balance, daily change from −100% to 100%, and spread from 0 to 100 percentage points.</p> : <div className="grid gap-3 sm:grid-cols-3">
            {SCENARIOS.map(scenario => <div key={scenario} className="rounded-lg border border-white/10 p-3"><div className="text-xs" style={{ color: SCENARIO_COLORS[scenario] }}>{scenarioLabel(scenario)} · {scenarios.rates[scenario].toFixed(2)}% daily</div><div className="mt-1 font-semibold tabular-nums text-white">{money(scenarios.points[scenarios.points.length - 1][scenario])}</div><div className="mt-1 text-xs text-white/50">At 30 days · assumed total portfolio value</div></div>)}
          </div>}
        </div>}
      </div>

      <div ref={viewport.ref} className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
        <svg viewBox={`0 0 ${viewport.width} 325`} style={{ width: viewport.width, height: 325, display: "block" }} role="img" aria-labelledby={`${id}-title ${id}-description`} preserveAspectRatio="xMidYMid meet">
          <title id={`${id}-title`}>Treasury portfolio and token values over time</title>
          <desc id={`${id}-description`}>Solid lines show supplied history. Dashed lines, when enabled, show editable assumptions from the last observation. Use the observation controls or data table for exact values. Missing values break the lines.</desc>
          {[0, 0.25, 0.5, 0.75, 1].map(fraction => {
            const value = axis.minimum + fraction * (axis.maximum - axis.minimum);
            return <g key={fraction}><line x1="75" x2={viewport.width - 30} y1={y(value)} y2={y(value)} stroke="#ffffff18" /><text x="66" y={y(value) + 4} textAnchor="end" fill="#a1a1aa" fontSize="11">{value.toLocaleString("en-US", { notation: "compact", style: "currency", currency: "USD", maximumFractionDigits: 1 })}</text></g>;
          })}
          {series.map(token => {
            const opacity = !highlight || highlight === token ? 1 : 0.15;
            return <g key={token} opacity={opacity}>
              <path d={pathFor(history.map(row => ({ timestamp: row.timestamp, value: treasuryValue(row, token) })))} fill="none" stroke={TOKEN_COLORS[token] || "#94a3b8"} strokeWidth={token === "totalUsd" ? 2.5 : 1.5} />
              {history.map((row, i) => {
                const value = treasuryValue(row, token);
                return value === null ? null : <circle key={`${row.timestamp}-${i}`} cx={x(row.timestamp)} cy={y(value)} r={i === index && token === readoutToken ? 4.5 : 2.5} fill={TOKEN_COLORS[token] || "#94a3b8"} onClick={() => { setObservationIndex(i); setSelectedToken(token); }} onMouseEnter={() => { setObservationIndex(i); setHoveredToken(token); }} onMouseLeave={() => setHoveredToken(null)}><title>{`${row.date}: ${tokenLabel(token)} ${money(value)}`}</title></circle>;
              })}
            </g>;
          })}
          {forecast && <>
            <line x1={x(latest.timestamp)} x2={x(latest.timestamp)} y1="20" y2="285" stroke="#a1a1aa" strokeDasharray="4 4" />
            <text x={Math.min(x(latest.timestamp) + 8, 845)} y="17" fill="#a1a1aa" fontSize="11">Scenarios begin</text>
            {visibleScenarios.map(scenario => <path key={scenario} d={pathFor(forecast.points.map(point => ({ timestamp: point.timestamp, value: point[scenario] })))} fill="none" stroke={SCENARIO_COLORS[scenario]} strokeWidth="2" strokeDasharray="6 4" />)}
          </>}
          <text x="75" y="311" fill="#a1a1aa" fontSize="11">{history[0].date}</text>
          <text x={viewport.width - 30} y="311" textAnchor="end" fill="#a1a1aa" fontSize="11">{new Date(lastTimestamp).toISOString().slice(0, 10)}</text>
        </svg>
      </div>

      <div className="space-y-3 rounded-xl border border-white/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label htmlFor={`${id}-observation`} className="text-xs font-medium text-white/80">Inspect historical observation</label>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Previous treasury observation" disabled={index === 0} onClick={() => changeIndex(-1)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 text-white disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
            <span className="min-w-24 text-center text-xs tabular-nums text-white/75">{index + 1} / {history.length}</span>
            <button type="button" aria-label="Next treasury observation" disabled={index === history.length - 1} onClick={() => changeIndex(1)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 text-white disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
          </div>
        </div>
        <input id={`${id}-observation`} type="range" min={0} max={Math.max(0, history.length - 1)} step={1} value={index} onChange={event => setObservationIndex(Number(event.target.value))} aria-valuetext={`${observation.date}: ${tokenLabel(readoutToken)} ${money(treasuryValue(observation, readoutToken))}`} className="w-full accent-primary" />
        <div aria-live="polite" aria-atomic="true" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white"><span className="text-white/65">{observation.date}</span><span>{tokenLabel(readoutToken)}</span><strong className="tabular-nums">{money(treasuryValue(observation, readoutToken))}</strong>{readoutToken !== "totalUsd" && <span className="text-white/65">{units(observation.tokens[readoutToken]?.amount ?? null)} {readoutToken}</span>}</div>
        <p className="text-xs leading-relaxed text-white/50">Token USD values use the supplied token prices. Total portfolio values come from the treasury source. Missing balances or prices display as unavailable.</p>
        {omittedDates > 0 && <p role="status" className="text-xs text-amber-300">{omittedDates} observations with invalid dates could not be plotted.</p>}
      </div>

      {showTable && <div id={`${id}-table`} className="space-y-4">
        <div role="region" aria-label="Treasury history data table" tabIndex={0} className="max-h-[28rem] overflow-auto rounded-xl border border-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <table className="w-full whitespace-nowrap text-left text-xs"><caption className="p-3 text-left text-sm font-medium text-white">Complete supplied treasury history. Token columns include balances and USD valuations.</caption><thead className="sticky top-0 bg-zinc-950 text-white/75"><tr><th scope="col" className="p-3">Date</th><th scope="col" className="p-3">Total portfolio (USD)</th>{tokens.map(token => <React.Fragment key={token}><th scope="col" className="p-3">{token} units</th><th scope="col" className="p-3">{token} value (USD)</th></React.Fragment>)}</tr></thead><tbody>{history.map((row, rowIndex) => <tr key={`${row.timestamp}-${rowIndex}`} className="border-t border-white/10 text-white/80"><th scope="row" className="p-3 font-medium">{row.date}</th><td className="p-3 tabular-nums">{money(row.totalUsd)}</td>{tokens.map(token => <React.Fragment key={token}><td className="p-3 tabular-nums">{units(row.tokens[token].amount)}</td><td className="p-3 tabular-nums">{money(row.tokens[token].valueUsd)}</td></React.Fragment>)}</tr>)}</tbody></table>
        </div>
        {forecast && <div role="region" aria-label="Treasury scenario data table" tabIndex={0} className="max-h-80 overflow-auto rounded-xl border border-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><table className="w-full text-left text-xs"><caption className="p-3 text-left text-sm font-medium text-white">Illustrative 30-day scenario values (USD)</caption><thead className="sticky top-0 bg-zinc-950 text-white/75"><tr><th scope="col" className="p-3">Date</th>{SCENARIOS.map(scenario => <th scope="col" key={scenario} className="p-3">{scenarioLabel(scenario)}</th>)}</tr></thead><tbody>{forecast.points.map(point => <tr key={point.timestamp} className="border-t border-white/10 text-white/80"><th scope="row" className="p-3 font-medium">{point.date}{point.day === 0 ? " (anchor)" : ""}</th>{SCENARIOS.map(scenario => <td key={scenario} className="p-3 tabular-nums">{money(point[scenario])}</td>)}</tr>)}</tbody></table></div>}
      </div>}
    </div>
  );
}
