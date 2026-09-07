"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  getAnalyticsFailureReasonId,
  type AnalyticsFailureHeatmap,
  type AnalyticsFailurePair,
} from "@/lib/platform-analytics-failures";

export interface FailureExplorerProps {
  data: AnalyticsFailureHeatmap;
  selected: [string, string] | null;
  onSelect: (selection: [string, string] | null) => void;
}

const controlClass = "min-h-10 rounded-lg border border-white/20 px-3 py-2 text-sm text-white/85 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300";
const pageSize = 10;

function sameReason(first: string, second: string) {
  return first === second || getAnalyticsFailureReasonId(first) === getAnalyticsFailureReasonId(second)
    || first === getAnalyticsFailureReasonId(second) || second === getAnalyticsFailureReasonId(first);
}

export default function FailureExplorer({ data, selected, onSelect }: FailureExplorerProps) {
  const headingId = useId();
  const searchId = useId();
  const [view, setView] = useState<"pairs" | "matrix">("pairs");
  const [allReasons, setAllReasons] = useState(false);
  const [search, setSearch] = useState("");
  const [showZeroPairs, setShowZeroPairs] = useState(false);
  const [reasonPage, setReasonPage] = useState(0);
  const [pairPage, setPairPage] = useState(0);
  const reasons = data.reasonCounts;
  const topReasons = data.topReasons;
  const affected = data.affectedReceiptCount;
  const query = search.trim().toLowerCase();

  const visibleReasons = useMemo(() => {
    const source = allReasons || query ? reasons : reasons.slice(0, topReasons.length);
    return source.filter(reason => !query || reason.reason.toLowerCase().includes(query) || reason.id.includes(query));
  }, [allReasons, query, reasons, topReasons.length]);

  const pairs = useMemo(() => {
    const result = [...data.pairs];
    if (showZeroPairs) {
      for (let first = 0; first < topReasons.length; first += 1) {
        for (let second = first + 1; second < topReasons.length; second += 1) {
          if ((data.matrix[first]?.[second] || 0) !== 0) continue;
          result.push({ reasonA: topReasons[first], reasonB: topReasons[second], reasonAId: getAnalyticsFailureReasonId(topReasons[first]), reasonBId: getAnalyticsFailureReasonId(topReasons[second]), count: 0 });
        }
      }
    }
    return result.filter(pair => !query || `${pair.reasonA} ${pair.reasonB} ${pair.reasonAId} ${pair.reasonBId}`.toLowerCase().includes(query));
  }, [data.pairs, data.matrix, topReasons, query, showZeroPairs]);

  useEffect(() => { setReasonPage(0); setPairPage(0); }, [search, allReasons, showZeroPairs, data]);
  const reasonPages = Math.max(1, Math.ceil(visibleReasons.length / pageSize));
  const pairPages = Math.max(1, Math.ceil(pairs.length / pageSize));
  const currentReasonPage = Math.min(reasonPage, reasonPages - 1);
  const currentPairPage = Math.min(pairPage, pairPages - 1);
  const largestReason = reasons.reduce((maximum, reason) => Math.max(maximum, reason.count), 1);
  const largestPair = data.pairs.reduce((maximum, pair) => Math.max(maximum, pair.count), 1);
  const isSelected = (a: string, b: string) => !!selected && (
    (sameReason(selected[0], a) && sameReason(selected[1], b))
    || (sameReason(selected[0], b) && sameReason(selected[1], a))
  );
  const select = (a: string, b: string) => onSelect(isSelected(a, b) ? null : [a, b]);
  const pairLabel = (pair: AnalyticsFailurePair) => `${pair.reasonA} + ${pair.reasonB}`;

  return (
    <section aria-labelledby={headingId} className="rounded-2xl border border-white/15 bg-zinc-950/75 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-lg font-semibold text-white">Failure analysis</h2>
          <p className="mt-1 text-sm text-white/65">{affected.toLocaleString()} affected receipts of {data.totalReceiptCount.toLocaleString()} in scope</p>
        </div>
        <div className="flex gap-1" role="group" aria-label="Co-occurrence visualization">
          <button type="button" aria-pressed={view === "pairs"} className={`${controlClass} ${view === "pairs" ? "bg-white/10" : ""}`} onClick={() => setView("pairs")}>Unique pairs</button>
          <button type="button" aria-pressed={view === "matrix"} className={`${controlClass} ${view === "matrix" ? "bg-white/10" : ""}`} onClick={() => setView("matrix")}>Triangle</button>
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-white/65">
        Counts include historical errors on receipts that later recovered. Each reason counts once per receipt; a pair means both occurred on the same receipt, with any additional reasons.
      </p>
      {affected > 0 && <p className="mt-2 text-sm text-white/75">Top {topReasons.length} cover <strong className="font-semibold text-white">{data.topReasonAffectedReceiptCount.toLocaleString()} of {affected.toLocaleString()}</strong> affected receipts. {data.otherOnlyAffectedReceiptCount.toLocaleString()} have only other reasons.</p>}

      {selected && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-400/40 bg-rose-400/10 p-3" role="status">
        <p className="min-w-0 break-words text-sm text-rose-100">Evidence filter: {selected.map((value, index) => reasons.find(reason => sameReason(reason.reason, value))?.reason || value).filter((value, index, values) => index === 0 || value !== values[0]).join(" + ")}</p>
        <button type="button" className={controlClass} onClick={() => onSelect(null)}>Clear filter</button>
      </div>}

      {affected === 0 ? <p className="mt-5 rounded-lg border border-white/10 p-5 text-sm text-white/65">No persisted error signals in the selected scope.</p> : <>
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor={searchId} className="mb-1 block text-sm font-medium text-white/80">Find a reason or stable code</label>
            <input id={searchId} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search all recorded reasons" className="min-h-10 w-full rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300" />
          </div>
          <button type="button" aria-pressed={allReasons} className={controlClass} onClick={() => setAllReasons(value => !value)}>{allReasons ? `Top ${topReasons.length} reasons` : `All ${reasons.length} reasons`}</button>
        </div>

        <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-white">Reason frequency</h3>
            <p className="mt-1 text-xs leading-relaxed text-white/65">Non-exclusive counts and share of all affected receipts.</p>
            <ul className="mt-3 space-y-2">
              {visibleReasons.slice(currentReasonPage * pageSize, (currentReasonPage + 1) * pageSize).map(reason => <li key={reason.id}>
                <button type="button" onClick={() => select(reason.reason, reason.reason)} aria-pressed={isSelected(reason.reason, reason.reason)} className={`w-full rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 ${isSelected(reason.reason, reason.reason) ? "border-rose-300 bg-rose-400/10" : "border-white/10 hover:bg-white/5"}`}>
                  <div className="flex items-start justify-between gap-3"><span className="min-w-0 break-words text-sm text-white/90">{reason.reason}</span><span className="shrink-0 text-right text-sm font-semibold tabular-nums text-white">{reason.count.toLocaleString()}<span className="ml-2 font-normal text-white/65">{((reason.count / affected) * 100).toFixed(1)}%</span></span></div>
                  <span className="mt-1 block break-all font-mono text-xs text-white/55">{reason.id}</span>
                  <span aria-hidden="true" className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-rose-400" style={{ width: `${(reason.count / largestReason) * 100}%` }} /></span>
                </button>
              </li>)}
            </ul>
            {visibleReasons.length === 0 && <p className="mt-3 text-sm text-white/65">No reasons match this search.</p>}
            {reasonPages > 1 && <div className="mt-3 flex items-center justify-between gap-2"><button type="button" disabled={currentReasonPage === 0} className={`${controlClass} disabled:opacity-40`} onClick={() => setReasonPage(value => value - 1)} aria-label="Previous page of reasons">Previous</button><span className="text-xs text-white/65">{currentReasonPage + 1} / {reasonPages}</span><button type="button" disabled={currentReasonPage + 1 >= reasonPages} className={`${controlClass} disabled:opacity-40`} onClick={() => setReasonPage(value => value + 1)} aria-label="Next page of reasons">Next</button></div>}
          </div>

          <div className="min-w-0">
            <h3 className="font-semibold text-white">{view === "pairs" ? "Co-occurring pairs" : `Top ${topReasons.length} pair matrix`}</h3>
            <p className="mt-1 text-xs leading-relaxed text-white/65">Each unordered pair appears once. Counts do not imply sequence or cause.</p>
            {view === "pairs" ? <>
              <label className="mt-3 flex min-h-10 cursor-pointer items-center gap-2 text-sm text-white/75"><input type="checkbox" checked={showZeroPairs} onChange={event => setShowZeroPairs(event.target.checked)} className="h-4 w-4 accent-rose-400 focus-visible:ring-2 focus-visible:ring-rose-300" />Include zero pairs among the top {topReasons.length}</label>
              <ul className="mt-2 space-y-2">
                {pairs.slice(currentPairPage * pageSize, (currentPairPage + 1) * pageSize).map(pair => <li key={`${pair.reasonAId}:${pair.reasonBId}`}>
                  <button type="button" onClick={() => select(pair.reasonA, pair.reasonB)} aria-pressed={isSelected(pair.reasonA, pair.reasonB)} aria-label={`${pairLabel(pair)}: ${pair.count} affected receipts. Filter evidence.`} className={`w-full rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 ${isSelected(pair.reasonA, pair.reasonB) ? "border-rose-300 bg-rose-400/10" : "border-white/10 hover:bg-white/5"}`}>
                    <div className="flex items-start justify-between gap-3"><span className="min-w-0 break-words text-sm leading-relaxed text-white/90">{pair.reasonA}<span className="my-1 block text-xs text-white/55">and</span>{pair.reasonB}</span><span className="shrink-0 text-sm font-semibold tabular-nums text-white">{pair.count.toLocaleString()}</span></div>
                    <span aria-hidden="true" className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-violet-400" style={{ width: `${(pair.count / largestPair) * 100}%` }} /></span>
                  </button>
                </li>)}
              </ul>
              {pairs.length === 0 && <p className="mt-3 rounded-lg border border-white/10 p-4 text-sm text-white/65">{query ? "No pairs match this search." : "No receipts contain more than one recorded reason."}</p>}
              {pairPages > 1 && <div className="mt-3 flex items-center justify-between gap-2"><button type="button" disabled={currentPairPage === 0} className={`${controlClass} disabled:opacity-40`} onClick={() => setPairPage(value => value - 1)} aria-label="Previous page of pairs">Previous</button><span className="text-xs text-white/65">{currentPairPage + 1} / {pairPages}</span><button type="button" disabled={currentPairPage + 1 >= pairPages} className={`${controlClass} disabled:opacity-40`} onClick={() => setPairPage(value => value + 1)} aria-label="Next page of pairs">Next</button></div>}
            </> : <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full border-collapse text-sm">
                <caption className="p-3 text-left text-xs leading-relaxed text-white/65">Inclusive intersections of the top reasons. Zero pairs remain selectable; individual frequencies are in the adjacent list. Row and column labels use stable code suffixes; buttons announce the full reasons.</caption>
                <thead><tr><th scope="col" className="p-2 text-left text-xs text-white/65">Reason</th>{topReasons.map(reason => <th key={reason} scope="col" className="p-2 text-xs font-medium text-white/75" title={reason}>{getAnalyticsFailureReasonId(reason).slice(-6)}</th>)}</tr></thead>
                <tbody>{topReasons.map((row, rowIndex) => <tr key={row}><th scope="row" className="max-w-44 break-words p-2 text-left text-xs font-medium text-white/80">{row}<span className="mt-1 block font-mono text-white/55">{getAnalyticsFailureReasonId(row).slice(-6)}</span></th>{topReasons.map((column, columnIndex) => <td key={column} className="p-1 text-center">{columnIndex > rowIndex ? <button type="button" aria-pressed={isSelected(row, column)} aria-label={`${row} and ${column}: ${data.matrix[rowIndex]?.[columnIndex] || 0} receipts. Filter evidence.`} onClick={() => select(row, column)} className={`min-h-10 min-w-10 rounded-md border px-2 font-semibold tabular-nums text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 ${isSelected(row, column) ? "border-rose-300" : "border-white/10"}`} style={{ backgroundColor: `rgba(167, 139, 250, ${0.06 + ((data.matrix[rowIndex]?.[columnIndex] || 0) / largestPair) * 0.42})` }}>{data.matrix[rowIndex]?.[columnIndex] || 0}</button> : <span aria-label={columnIndex === rowIndex ? "Frequency is in reason list" : "Mirrored pair omitted"} className="text-white/35">—</span>}</td>)}</tr>)}</tbody>
              </table>
            </div>}
          </div>
        </div>
      </>}
    </section>
  );
}
