"use client";

import React, { useEffect, useRef, useState } from "react";
import { Activity, ShieldCheck } from "lucide-react";

export default function SideScrollerRollercoaster() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1000, height: 200 });

  // Coaster Physics & Motion State
  const [posX, setPosX] = useState(0);
  const [speed, setSpeed] = useState(3.5);
  const [currentSlope, setCurrentSlope] = useState(0);

  // Responsive container sizing
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth || 1000,
          height: containerRef.current.clientHeight || 200,
        });
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Compute spline Y height and slope for any given X position
  // Chart curve equation matching a realistic financial rollercoaster chart:
  // Compute spline Y height and slope for any given X position
  // Smooth, realistic financial chart slopes (reasonable max slope angle ~30 deg)
  const getTrackY = (x: number, h: number) => {
    const baseline = h * 0.52;
    const wave1 = Math.sin(x * 0.003) * (h * 0.18);
    const wave2 = Math.cos(x * 0.007) * (h * 0.08);
    const wave3 = Math.sin(x * 0.014) * (h * 0.04);
    return baseline - (wave1 + wave2 + wave3);
  };

  // Compute tangent angle for coaster rotation
  const getTrackAngle = (x: number, h: number) => {
    const delta = 2;
    const y1 = getTrackY(x - delta, h);
    const y2 = getTrackY(x + delta, h);
    const dy = y2 - y1;
    const dx = delta * 2;
    return Math.atan2(dy, dx) * (180 / Math.PI);
  };

  // Main animation loop (Gravity physics & seamless side-scrolling track displacement)
  useEffect(() => {
    let animId: number;
    let currentX = 0;
    let currentVel = 3.5;

    const tick = () => {
      const h = dimensions.height || 200;
      
      // Calculate slope at current position
      const y1 = getTrackY(currentX, h);
      const y2 = getTrackY(currentX + 2, h);
      const dy = y2 - y1; // Positive = going down, Negative = climbing up

      // Gravity simulation: Acceleration on drops, decelerate on climbs
      const gravityAcc = dy * 0.12;
      currentVel += gravityAcc;

      // Friction & speed limits
      currentVel *= 0.985;
      if (currentVel < 1.8) currentVel = 1.8;
      if (currentVel > 9.5) currentVel = 9.5;

      currentX += currentVel * 1.6;
      if (currentX > 2400) {
        currentX = 0;
      }

      setPosX(currentX);
      setSpeed(+currentVel.toFixed(1));
      setCurrentSlope(+dy.toFixed(2));

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [dimensions.height]);

  // Generate SVG Path for the Chart Line Track (Extends from -1200 to 3600 to fill left/right edges)
  const generateTrackPath = (w: number, h: number) => {
    let path = "";
    const step = 10;
    const minX = -1200;
    const maxX = Math.max(w + 1200, 3600);

    for (let x = minX; x <= maxX; x += step) {
      const y = getTrackY(x, h);
      if (x === minX) path += `M ${x} ${y}`;
      else path += ` L ${x} ${y}`;
    }
    return path;
  };

  const trackPathD = generateTrackPath(dimensions.width, dimensions.height);
  const currentY = getTrackY(posX, dimensions.height);
  const currentAngle = getTrackAngle(posX, dimensions.height);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full rounded-2xl bg-zinc-950/90 border border-white/10 overflow-hidden shadow-2xl flex flex-col justify-between select-none"
    >
      {/* Background Cyber Mesh Parallax Grid */}
      <div
        className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:3rem_3rem] pointer-events-none transition-transform duration-75"
        style={{ transform: `translateX(-${(posX * 0.15) % 48}px)` }}
      />

      {/* Top Header HUD Info Strip */}
      <div className="relative z-20 flex items-center justify-between p-3 border-b border-white/10 shrink-0 bg-zinc-950/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/40 flex items-center justify-center text-primary shadow-[0_0_12px_rgba(59,130,246,0.3)]">
            <Activity className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="text-[10px] font-mono font-bold text-white flex items-center gap-2">
              <span>FINANCIAL CHART ROLLERCOASTER TELEMETRY</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <div className="text-[9px] text-white/40 font-mono">LIVE CHART VELOCITY & G-FORCE TRACKING</div>
          </div>
        </div>

        {/* Live Velocity Diagnostics Badges */}
        <div className="flex items-center gap-2 font-mono text-[10px]">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/10">
            <span className="text-white/40">SPEED:</span>
            <span className="text-primary font-bold">{Math.round(speed * 12)} MPH</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/10">
            <span className="text-white/40">G-FORCE:</span>
            <span className="text-purple-400 font-bold">{(1.0 + Math.abs(currentSlope) * 0.4).toFixed(1)}G</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <ShieldCheck className="w-3 h-3" />
            <span className="font-bold">TRACK LOCKED</span>
          </div>
        </div>
      </div>

      {/* Main 2D Side-Scrolling SVG Canvas */}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden">
        <svg
          className="w-full h-full absolute inset-0 overflow-visible"
          viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="coaster-line-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="40%" stopColor="#a855f7" />
              <stop offset="80%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
            <linearGradient id="coaster-fill-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#a855f7" stopOpacity="0.01" />
            </linearGradient>
            <filter id="coaster-glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Sliding View Container translating track to keep coaster centered horizontally at 25% screen */}
          <g transform={`translate(${dimensions.width * 0.25 - posX}, 0)`}>
            
            {/* Structural Steel Lattice Columns (Under-track Coaster Supports spanning from x=-1200 to 3600) */}
            {Array.from({ length: 96 }).map((_, idx) => {
              const x = -1200 + idx * 50;
              const yTrack = getTrackY(x, dimensions.height);
              return (
                <g key={idx} opacity="0.4">
                  {/* Main Vertical Support Column */}
                  <line
                    x1={x}
                    y1={yTrack}
                    x2={x}
                    y2={dimensions.height}
                    stroke="rgba(255,255,255,0.12)"
                    strokeWidth="2"
                  />
                  {/* Diagonal Cross-Truss Brace */}
                  <line
                    x1={x}
                    y1={yTrack + 15}
                    x2={x + 50}
                    y2={dimensions.height}
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth="1"
                    strokeDasharray="4 2"
                  />
                </g>
              );
            })}

            {/* Glowing Chart Area Underfill (Spanning -1200 to 3600) */}
            <path
              d={`${trackPathD} L 3600 ${dimensions.height} L -1200 ${dimensions.height} Z`}
              fill="url(#coaster-fill-grad)"
            />

            {/* Chart Line Track (Secondary Outer Wireframe Rail) */}
            <path
              d={trackPathD}
              fill="none"
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="6"
              strokeLinecap="round"
            />

            {/* Main Glowing Neon Financial Chart Line Track */}
            <path
              d={trackPathD}
              fill="none"
              stroke="url(#coaster-line-grad)"
              strokeWidth="3"
              strokeLinecap="round"
              filter="url(#coaster-glow)"
            />

            {/* Interactive Milestone Nodes along the Track */}
            <g transform={`translate(300, ${getTrackY(300, dimensions.height)})`}>
              <circle r="4" fill="#3b82f6" filter="url(#coaster-glow)" />
              <rect x="-35" y="-24" width="70" height="16" rx="4" fill="#1e1b4b" stroke="#60a5fa" strokeWidth="1" />
              <text x="0" y="-13" textAnchor="middle" fill="#60a5fa" fontSize="8" fontFamily="monospace" fontWeight="bold">
                1,480 REQ/S
              </text>
            </g>

            <g transform={`translate(800, ${getTrackY(800, dimensions.height)})`}>
              <circle r="4" fill="#a855f7" filter="url(#coaster-glow)" />
              <rect x="-35" y="-24" width="70" height="16" rx="4" fill="#2e1065" stroke="#c084fc" strokeWidth="1" />
              <text x="0" y="-13" textAnchor="middle" fill="#c084fc" fontSize="8" fontFamily="monospace" fontWeight="bold">
                SAFE $10,000
              </text>
            </g>

            <g transform={`translate(1400, ${getTrackY(1400, dimensions.height)})`}>
              <circle r="4" fill="#10b981" filter="url(#coaster-glow)" />
              <rect x="-35" y="-24" width="70" height="16" rx="4" fill="#064e3b" stroke="#34d399" strokeWidth="1" />
              <text x="0" y="-13" textAnchor="middle" fill="#34d399" fontSize="8" fontFamily="monospace" fontWeight="bold">
                100% SYNCED
              </text>
            </g>

            {/* ───────────────────────────────────────────────────────────── */}
            {/* THE INDEPENDENTLY LINKED ROLLERCOASTER TRAIN (3 Connected Cars) */}
            {/* ───────────────────────────────────────────────────────────── */}
            {(() => {
              // Car 1 (Lead Front Car)
              const pos1 = posX;
              const y1 = getTrackY(pos1, dimensions.height);
              const angle1 = getTrackAngle(pos1, dimensions.height);

              // Car 2 (Middle Car)
              const pos2 = posX - 26;
              const y2 = getTrackY(pos2, dimensions.height);
              const angle2 = getTrackAngle(pos2, dimensions.height);

              // Car 3 (Rear Back Car)
              const pos3 = posX - 52;
              const y3 = getTrackY(pos3, dimensions.height);
              const angle3 = getTrackAngle(pos3, dimensions.height);

              return (
                <g>
                  {/* Dynamic Flexible Hitches between cars */}
                  <line x1={pos3} y1={y3 - 4} x2={pos2} y2={y2 - 4} stroke="#a855f7" strokeWidth="2.5" strokeDasharray="3 1" />
                  <line x1={pos2} y1={y2 - 4} x2={pos1} y2={y1 - 4} stroke="#3b82f6" strokeWidth="2.5" strokeDasharray="3 1" />

                  {/* Car #3 (Rear Car - Independent Transform) */}
                  <g transform={`translate(${pos3}, ${y3}) rotate(${angle3})`}>
                    <g transform="translate(-9, -10)">
                      <rect x="0" y="0" width="18" height="10" rx="3" fill="#18181b" stroke="#a855f7" strokeWidth="1.5" />
                      <circle cx="4" cy="11" r="2.5" fill="#38bdf8" />
                      <circle cx="14" cy="11" r="2.5" fill="#38bdf8" />
                      <text x="9" y="-2" textAnchor="middle" fontSize="10">🙌</text>
                    </g>
                  </g>

                  {/* Car #2 (Middle Car - Independent Transform) */}
                  <g transform={`translate(${pos2}, ${y2}) rotate(${angle2})`}>
                    <g transform="translate(-9, -10)">
                      <rect x="0" y="0" width="18" height="10" rx="3" fill="#18181b" stroke="#3b82f6" strokeWidth="1.5" />
                      <circle cx="4" cy="11" r="2.5" fill="#38bdf8" />
                      <circle cx="14" cy="11" r="2.5" fill="#38bdf8" />
                      <text x="9" y="-2" textAnchor="middle" fontSize="10">🚀</text>
                    </g>
                  </g>

                  {/* Car #1 (Front Lead Car - Independent Transform) */}
                  <g transform={`translate(${pos1}, ${y1}) rotate(${angle1})`}>
                    <g transform="translate(-9, -12)">
                      <path d="M 0 2 L 18 2 Q 24 6 22 12 L 0 12 Z" fill="#1e1b4b" stroke="#10b981" strokeWidth="1.5" />
                      <rect x="2" y="10" width="16" height="2" fill="#10b981" filter="url(#coaster-glow)" />
                      <circle cx="5" cy="13" r="3" fill="#34d399" stroke="#ffffff" strokeWidth="0.5" />
                      <circle cx="17" cy="13" r="3" fill="#34d399" stroke="#ffffff" strokeWidth="0.5" />
                      <line x1="22" y1="7" x2="45" y2="7" stroke="#34d399" strokeWidth="2" filter="url(#coaster-glow)" />
                      <text x="8" y="-2" textAnchor="middle" fontSize="11">😱</text>
                    </g>
                  </g>
                </g>
              );
            })()}
          </g>
        </svg>
      </div>

      {/* Bottom Footer Status Bar */}
      <div className="relative z-20 flex items-center justify-between px-3 py-1.5 border-t border-white/10 shrink-0 bg-zinc-950/90 text-[9px] font-mono text-white/40">
        <span>STATUS: ACTIVE DISPATCH</span>
        <span className="text-primary font-bold">SMOOTH TANGENT PHYSICS • 60 FPS</span>
        <span>NODE REPOSITORIES OK</span>
      </div>
    </div>
  );
}
