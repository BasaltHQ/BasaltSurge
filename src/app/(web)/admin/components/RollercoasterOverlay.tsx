"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { Play, Pause, X, RotateCcw, FastForward, Activity, Award, Maximize2, Minimize2, Eye, EyeOff } from "lucide-react";

interface CoasterDataPoint {
  label: string;
  aggregate: number;
  [key: string]: any;
}

interface RollercoasterOverlayProps {
  data: Record<string, any>[];
  brandKeys: string[];
  metricType: "successRate" | "amountEarned";
  scaleType: "linear" | "log";
  onClose: () => void;
}

export default function RollercoasterOverlay({
  data,
  brandKeys,
  metricType,
  scaleType,
  onClose,
}: RollercoasterOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Simulation states
  const [isPlaying, setIsPlaying] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState<1 | 2 | 4>(1);
  const [selectedTrack, setSelectedTrack] = useState<string>("aggregate");
  const [currentSpeedMph, setCurrentSpeedMph] = useState(0);
  const [currentGForce, setCurrentGForce] = useState(1.0);
  const [activeNodeInfo, setActiveNodeInfo] = useState<{ date: string; value: number } | null>(null);
  const [rideProgress, setRideProgress] = useState(0); // 0 to 100%
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeBiomeName, setActiveBiomeName] = useState("Cyber Synthwave");
  const [weather, setWeather] = useState<"clear" | "normal" | "heavy">("normal");
  const [showHud, setShowHud] = useState(true);
  const [mounted, setMounted] = useState(false);

  // Generate a large pool of particles so we can slice them dynamically based on weather density
  const particles = useMemo(() => {
    return Array.from({ length: 200 }, () => ({
      x: (Math.random() - 0.5) * 80,
      y: Math.random() * 40,
      z: Math.random() * 400,
      speedY: 8 + Math.random() * 12,
      size: 0.8 + Math.random() * 1.5,
      seed: Math.random(),
    }));
  }, []);

  useEffect(() => {
    setMounted(true);
    // Randomize weather on mount
    const weathers = ["clear", "normal", "heavy"] as const;
    setWeather(weathers[Math.floor(Math.random() * weathers.length)]);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 60);
    return () => clearTimeout(timer);
  }, [isFullscreen]);

  // Ref to track position along track points
  const progressRef = useRef(0);
  const velocityRef = useRef(15); // m/s
  const lastTimeRef = useRef<number | null>(null);

  // 1. Generate 3D Track Splines
  const track3DPoints = useMemo(() => {
    if (!data || data.length === 0) return [];

    // Extract raw elevation points based on selected track and metric
    const rawElevations = data.map((d) => {
      const val = d[selectedTrack] !== null && d[selectedTrack] !== undefined ? d[selectedTrack] : 0;
      return {
        label: d.label,
        value: val,
      };
    });

    // Helper to calculate Y height for a given value
    const maxVal = Math.max(...rawElevations.map((e) => e.value), 10);
    const getHeight = (val: number) => {
      if (metricType === "successRate") {
        if (scaleType === "linear") {
          return 15 + (val / 100) * 45; // Height between 15m and 60m
        } else {
          const logVal = Math.log10(val + 1);
          const logMax = Math.log10(101);
          return 15 + (logVal / logMax) * 45;
        }
      } else {
        if (scaleType === "linear") {
          return 15 + (val / maxVal) * 45;
        } else {
          const logVal = Math.log10(val + 1);
          const logMax = Math.log10(maxVal + 1);
          return 15 + (logVal / logMax) * 45;
        }
      }
    };

    // 3D Control Points mapping
    const controlPoints = rawElevations.map((item, idx) => {
      // Z distance spaced evenly
      const z = idx * 100;

      // Height Y mapping: linear vs log elevation
      const y = getHeight(item.value);

      // Lateral deviation X: if height change is small, add winding curves
      let x = 0;
      if (idx > 0) {
        const prevY = getHeight(rawElevations[idx - 1].value);
        const heightDelta = Math.abs(y - prevY);
        if (heightDelta < 4) {
          // Flattened section - create a banking turn
          x = Math.sin(idx * 1.5) * 25;
        } else {
          // Steep drop/climb - keep it relatively straight for g-forces
          x = Math.sin(idx * 0.5) * 5;
        }
      }

      return { x, y, z, date: item.label, value: item.value };
    });

    // Subdivide control points using Catmull-Rom spline interpolation for smoothness
    const subdividedPoints: { x: number; y: number; z: number; date: string; value: number }[] = [];
    const subdivisions = 40; // Detailed steps between days

    const getSplinePoint = (p0: any, p1: any, p2: any, p3: any, t: number) => {
      const t2 = t * t;
      const t3 = t2 * t;

      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );
      const z = 0.5 * (
        (2 * p1.z) +
        (-p0.z + p2.z) * t +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3
      );

      return { x, y, z };
    };

    const N = controlPoints.length;
    if (N < 2) return [];

    for (let i = 0; i < N - 1; i++) {
      const p0 = controlPoints[Math.max(0, i - 1)];
      const p1 = controlPoints[i];
      const p2 = controlPoints[i + 1];
      const p3 = controlPoints[Math.min(N - 1, i + 2)];

      for (let j = 0; j < subdivisions; j++) {
        const t = j / subdivisions;
        const pt = getSplinePoint(p0, p1, p2, p3, t);

        // Linearly interpolate target values and dates for HUD readout
        const itemVal = p1.value + (p2.value - p1.value) * t;

        subdividedPoints.push({
          x: pt.x,
          y: pt.y,
          z: pt.z,
          date: t < 0.5 ? p1.date : p2.date,
          value: itemVal,
        });
      }
    }

    // Add final control point
    const finalPt = controlPoints[N - 1];
    subdividedPoints.push({
      x: finalPt.x,
      y: finalPt.y,
      z: finalPt.z,
      date: finalPt.date,
      value: finalPt.value,
    });

    return subdividedPoints;
  }, [data, selectedTrack, metricType, scaleType]);

  // Reset coaster when selected track changes
  useEffect(() => {
    progressRef.current = 0;
    velocityRef.current = 15;
    lastTimeRef.current = null;
  }, [selectedTrack]);

  // 2. Main Simulation & Canvas Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;

    // Set canvas sizes
    const resizeCanvas = () => {
      if (containerRef.current && canvas) {
        canvas.width = containerRef.current.clientWidth;
        canvas.height = containerRef.current.clientHeight;
      }
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Procedural Stars generator
    const stars: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < 200; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      stars.push({
        x: Math.sin(phi) * Math.cos(theta),
        y: Math.sin(phi) * Math.sin(theta),
        z: Math.cos(phi),
      });
    }

    // Procedural Trees & Floating tokens generators along track
    const trackItems: { x: number; y: number; z: number; type: "tree" | "token" | "gate" | "lavaSpike" | "crystal"; color: string; scale: number; rotation: number }[] = [];
    if (track3DPoints.length > 5) {
      const totalPoints = track3DPoints.length;
      // Place items every few steps along the spline
      for (let i = 20; i < totalPoints - 20; i += 12) {
        const pt = track3DPoints[i];
        const nextPt = track3DPoints[i + 1];
        
        // Calculate tangent vector
        const tx = nextPt.x - pt.x;
        const tz = nextPt.z - pt.z;
        const len = Math.sqrt(tx * tx + tz * tz) || 1;
        const nx = -tz / len; // Normal vector perpendicular
        const nz = tx / len;

        // Biome cycle mapping (changes every 24 days/960 points)
        const pointsPerBiome = 24 * 40;
        const bCycle = Math.floor(i / pointsPerBiome) % 3;
        const isSynthwave = bCycle === 0;
        const isLava = bCycle === 1;

        if (isSynthwave) {
          // Place a tree on the left side
          trackItems.push({
            x: pt.x + nx * (15 + Math.random() * 10),
            y: 0,
            z: pt.z + nz * (15 + Math.random() * 10),
            type: "tree",
            color: `hsl(${130 + Math.random() * 30}, 60%, ${15 + Math.random() * 15}%)`,
            scale: 1.5 + Math.random() * 2.0,
            rotation: Math.random() * Math.PI,
          });

          // Place a tree on the right side
          trackItems.push({
            x: pt.x - nx * (15 + Math.random() * 10),
            y: 0,
            z: pt.z - nz * (15 + Math.random() * 10),
            type: "tree",
            color: `hsl(${135 + Math.random() * 25}, 65%, ${15 + Math.random() * 15}%)`,
            scale: 1.5 + Math.random() * 2.0,
            rotation: Math.random() * Math.PI,
          });
        } else if (isLava) {
          // Place lava spires on left and right
          trackItems.push({
            x: pt.x + nx * (12 + Math.random() * 8),
            y: 0,
            z: pt.z + nz * (12 + Math.random() * 8),
            type: "lavaSpike",
            color: `hsl(${15 + Math.random() * 15}, 90%, 50%)`,
            scale: 1.2 + Math.random() * 1.5,
            rotation: Math.random() * Math.PI,
          });
          trackItems.push({
            x: pt.x - nx * (12 + Math.random() * 8),
            y: 0,
            z: pt.z - nz * (12 + Math.random() * 8),
            type: "lavaSpike",
            color: `hsl(${15 + Math.random() * 15}, 90%, 50%)`,
            scale: 1.2 + Math.random() * 1.5,
            rotation: Math.random() * Math.PI,
          });
        } else {
          // Nebula Biome: place floating crystals
          trackItems.push({
            x: pt.x + nx * (10 + Math.random() * 6),
            y: pt.y - 2 + Math.random() * 8, // float them vertically too!
            z: pt.z + nz * (10 + Math.random() * 6),
            type: "crystal",
            color: `hsl(${180 + Math.random() * 30}, 80%, 70%)`,
            scale: 0.8 + Math.random() * 0.8,
            rotation: Math.random() * Math.PI,
          });
          trackItems.push({
            x: pt.x - nx * (10 + Math.random() * 6),
            y: pt.y - 2 + Math.random() * 8,
            z: pt.z - nz * (10 + Math.random() * 6),
            type: "crystal",
            color: `hsl(${180 + Math.random() * 30}, 80%, 70%)`,
            scale: 0.8 + Math.random() * 0.8,
            rotation: Math.random() * Math.PI,
          });
        }

        // Occasional Arch/Gate that the track passes directly through
        if (i % 84 === 0) {
          trackItems.push({
            x: pt.x,
            y: pt.y,
            z: pt.z,
            type: "gate",
            color: isSynthwave 
              ? "rgba(168, 85, 247, 0.4)" 
              : isLava 
                ? "rgba(239, 68, 68, 0.4)" 
                : "rgba(6, 182, 212, 0.4)",
            scale: 6.0,
            rotation: Math.atan2(tx, tz),
          });
        }

        // Occasional floating 3D Token above the track
        if (i % 36 === 0) {
          trackItems.push({
            x: pt.x + nx * (Math.random() * 4 - 2),
            y: pt.y + 4 + Math.random() * 2,
            z: pt.z + nz * (Math.random() * 4 - 2),
            type: "token",
            color: isSynthwave
              ? (metricType === "successRate" ? "#10b981" : "#a855f7")
              : isLava
                ? "#f97316"
                : "#06b6d4",
            scale: 0.8,
            rotation: 0,
          });
        }
      }
    }

    const render = (time: number) => {
      if (!ctx || !canvas || track3DPoints.length === 0) return;

      // Handle physics delta time
      if (lastTimeRef.current === null) {
        lastTimeRef.current = time;
      }
      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = time;

      if (isPlaying) {
        const steps = speedMultiplier;
        for (let s = 0; s < steps; s++) {
          const idx = Math.floor(progressRef.current);
          if (idx >= track3DPoints.length - 2) {
            // Loop back to start
            progressRef.current = 0;
            velocityRef.current = 15;
            break;
          }

          const currentPt = track3DPoints[idx];
          const nextPt = track3DPoints[idx + 1];

          // Coaster Physics: Calculate slope gravity effect
          const dy = nextPt.y - currentPt.y;
          const dz = nextPt.z - currentPt.z;
          const dx = nextPt.x - currentPt.x;
          const segmentLen = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.1;

          // Slope angle: positive is upward, negative is downward drop
          const slopeSin = dy / segmentLen;

          // Velocity update based on gravity
          const gravity = 9.81;
          const friction = 0.05;
          velocityRef.current += (-gravity * slopeSin - friction * (velocityRef.current / 30)) * dt;
          
          // Cap speeds between 6 m/s (slow crawl over hills) and 50 m/s (warp drops!)
          if (velocityRef.current < 8) velocityRef.current = 8;
          if (velocityRef.current > 50) velocityRef.current = 50;

          // Progress along spline points array
          progressRef.current += (velocityRef.current / segmentLen) * dt;
        }

        // Set UI values
        const currentIdx = Math.floor(progressRef.current);
        const activeNode = track3DPoints[Math.min(currentIdx, track3DPoints.length - 1)];
        if (activeNode) {
          setActiveNodeInfo({ date: activeNode.date, value: activeNode.value });
          setCurrentSpeedMph(Math.round(velocityRef.current * 2.23694)); // m/s to mph

          // G-Force Estimation: 1.0 (baseline gravity) + vertical centripetal acceleration + lateral G
          const prevIdx = Math.max(0, currentIdx - 2);
          const nextIdx = Math.min(track3DPoints.length - 1, currentIdx + 2);
          const prev = track3DPoints[prevIdx];
          const next = track3DPoints[nextIdx];

          const dy1 = activeNode.y - prev.y;
          const dz1 = activeNode.z - prev.z;
          const dy2 = next.y - activeNode.y;
          const dz2 = next.z - activeNode.z;
          
          const angle1 = Math.atan2(dy1, dz1);
          const angle2 = Math.atan2(dy2, dz2);
          const angleDelta = angle2 - angle1;

          const vG = 1.0 + (angleDelta * velocityRef.current * 0.4);
          const latG = Math.abs(activeNode.x - prev.x) * 0.15;
          setCurrentGForce(+(vG + latG).toFixed(2));
        }

        setRideProgress((progressRef.current / track3DPoints.length) * 100);

        // Update biome name (cycles every 8 days/320 points)
        const pPerBiome = 8 * 40;
        const bCycle = Math.floor(currentIdx / pPerBiome) % 3;
        let activeName = "Cyber Synthwave";
        if (bCycle === 1) {
          activeName = "Volcanic Lava Realm";
        } else if (bCycle === 2) {
          activeName = "Deep Space Nebula";
        }
        setActiveBiomeName((prev) => (prev !== activeName ? activeName : prev));
      }

      // Camera Coordinates Calculations
      const camIdx = Math.floor(progressRef.current);
      const camPt = track3DPoints[Math.min(camIdx, track3DPoints.length - 1)] || { x: 0, y: 15, z: 0 };
      const lookIdx = Math.min(camIdx + 6, track3DPoints.length - 1);
      const lookPt = track3DPoints[lookIdx] || { x: 0, y: 15, z: 50 };

      // Base camera offset: Sit 1.8m above rails
      const camX = camPt.x;
      const camY = camPt.y + 1.8;
      const camZ = camPt.z;

      // Add high-speed rattles/shakes to camera position
      const rumbleIntensity = Math.max(0, (velocityRef.current - 15) / 35) * 0.15;
      const camXShake = camX + (Math.random() - 0.5) * rumbleIntensity;
      const camYShake = camY + (Math.random() - 0.5) * rumbleIntensity;

      // Direction Vectors (FPV Rig)
      const dirX = lookPt.x - camPt.x;
      const dirY = (lookPt.y + 1.8) - camY;
      const dirZ = lookPt.z - camPt.z;
      const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;

      // Compute yaw (rotation left/right) and pitch (rotation up/down)
      const yaw = Math.atan2(dirX, dirZ);
      const pitch = -Math.atan2(dirY, Math.sqrt(dirX * dirX + dirZ * dirZ));

      // Dynamic banking roll based on lateral curvature
      const nextCamPt = track3DPoints[Math.min(camIdx + 2, track3DPoints.length - 1)] || camPt;
      const trackNormalX = nextCamPt.x - camPt.x;
      const roll = -trackNormalX * 0.08; // Roll into the turn!

      // Projection parameters
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2 + 30; // slightly lower center for better cockpit visibility
      const fov = canvas.width / 1.7; // perspective scaling factor

      // Camera space transformation function
      const project = (point: { x: number; y: number; z: number }) => {
        // Translation relative to camera
        const dx = point.x - camXShake;
        const dy = point.y - camYShake;
        const dz = point.z - camZ;

        // Rotate by Yaw (around Y axis)
        const cosY = Math.cos(-yaw);
        const sinY = Math.sin(-yaw);
        const rx1 = dx * cosY - dz * sinY;
        const rz1 = dx * sinY + dz * cosY;

        // Rotate by Pitch (around X axis)
        const cosP = Math.cos(-pitch);
        const sinP = Math.sin(-pitch);
        const ry2 = dy * cosP - rz1 * sinP;
        const rz2 = dy * sinP + rz1 * cosP;

        // Rotate by Roll (around Z axis)
        const cosR = Math.cos(-roll);
        const sinR = Math.sin(-roll);
        const rx3 = rx1 * cosR - ry2 * sinR;
        const ry3 = rx1 * sinR + ry2 * cosR;

        // If behind camera plane, return null
        if (rz2 <= 1.0) return null;

        // Screen coordinate projection
        const px = centerX + (rx3 / rz2) * fov;
        const py = centerY - (ry3 / rz2) * fov;

        return { x: px, y: py, depth: rz2 };
      };

      // Calculate active biome based on camera position (cycles every 24 days/960 points)
      const pointsPerBiome = 24 * 40;
      const biomeCycle = Math.floor(camIdx / pointsPerBiome) % 3;
      const activeBiome = biomeCycle === 0 ? "synthwave" : biomeCycle === 1 ? "lava" : "nebula";

      // Biome-specific style overrides
      let skyColorStart = "#030008";
      let skyColorMid = "#0b051a";
      let skyColorEnd = "#180d30";
      let groundColor = "#06030c";
      let gridStrokeColor = "rgba(139, 92, 246, 0.03)";
      let horizonStrokeColor = "rgba(139, 92, 246, 0.15)";

      if (activeBiome === "lava") {
        skyColorStart = "#090101";
        skyColorMid = "#230505";
        skyColorEnd = "#3a0909";
        groundColor = "#110202";
        gridStrokeColor = "rgba(239, 68, 68, 0.05)";
        horizonStrokeColor = "rgba(239, 68, 68, 0.2)";
      } else if (activeBiome === "nebula") {
        skyColorStart = "#000308";
        skyColorMid = "#021622";
        skyColorEnd = "#042637";
        groundColor = "#010a10";
        gridStrokeColor = "rgba(6, 182, 212, 0.05)";
        horizonStrokeColor = "rgba(6, 182, 212, 0.2)";
      }

      // Sky Gradient
      const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      skyGrad.addColorStop(0, skyColorStart);
      skyGrad.addColorStop(0.5, skyColorMid);
      skyGrad.addColorStop(1, skyColorEnd);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Render 3D Celestial Stars (No translation, only camera rotation)
      ctx.fillStyle = "#ffffff";
      stars.forEach((star) => {
        // Apply camera rotation only (stars sit at infinity)
        const cosY = Math.cos(-yaw);
        const sinY = Math.sin(-yaw);
        const rx1 = star.x * cosY - star.z * sinY;
        const rz1 = star.x * sinY + star.z * cosY;

        const cosP = Math.cos(-pitch);
        const sinP = Math.sin(-pitch);
        const ry2 = star.y * cosP - rz1 * sinP;
        const rz2 = star.y * sinP + rz1 * cosP;

        const cosR = Math.cos(-roll);
        const sinR = Math.sin(-roll);
        const rx3 = rx1 * cosR - ry2 * sinR;

        if (rz2 > 0) {
          const px = centerX + (rx3 / rz2) * fov;
          const py = centerY - (ry2 / rz2) * fov;
          const r = Math.max(0.5, (1.0 - rz2) * 1.5);
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Draw Biome Weather Particles (Cyber rain, lava embers, nebula dust)
      ctx.save();
      particles.forEach((p) => {
        let pz = (p.z - (time * 0.04 * p.speedY)) % 400;
        if (pz < 0) pz += 400;

        let py = p.y;
        let px = p.x;

        if (activeBiome === "synthwave") {
          // Cyber Rain: falls down
          py = (p.y - (time * 0.015 * p.speedY)) % 40;
          if (py < 0) py += 40;
          
          const pt1 = project({ x: px, y: py, z: camZ + pz });
          const pt2 = project({ x: px, y: py - 2.5, z: camZ + pz });
          if (pt1 && pt2) {
            ctx.strokeStyle = "rgba(168, 85, 247, 0.4)";
            ctx.lineWidth = p.size;
            ctx.beginPath();
            ctx.moveTo(pt1.x, pt1.y);
            ctx.lineTo(pt2.x, pt2.y);
            ctx.stroke();
          }
        } else if (activeBiome === "lava") {
          // Molten Embers: float up
          py = (p.y + (time * 0.008 * p.speedY)) % 40;
          px = p.x + Math.sin(time / 200 + p.seed * 100) * 1.5;
          
          const pt = project({ x: px, y: py, z: camZ + pz });
          if (pt) {
            ctx.fillStyle = `rgba(249, 115, 22, ${0.35 + Math.sin(time / 200 + p.seed * 50) * 0.35})`;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, p.size * 2.0, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          // Nebula Space Dust: drift slowly
          py = p.y + Math.sin(time / 400 + p.seed * 10) * 2;
          px = p.x + Math.cos(time / 300 + p.seed * 20) * 2;
          
          const pt = project({ x: px, y: py, z: camZ + pz });
          if (pt) {
            ctx.fillStyle = `rgba(6, 182, 212, ${0.3 + Math.sin(time / 250 + p.seed * 80) * 0.3})`;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, p.size * 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });
      ctx.restore();

      // Ground Horizon Grid (Y=0)
      const horizonY = project({ x: camPt.x, y: 0, z: camZ + 800 });
      const currentHorizonScreenY = horizonY ? horizonY.y : centerY;

      // Fill ground solid
      ctx.fillStyle = groundColor;
      ctx.beginPath();
      ctx.moveTo(0, currentHorizonScreenY);
      ctx.lineTo(canvas.width, currentHorizonScreenY);
      ctx.lineTo(canvas.width, canvas.height);
      ctx.lineTo(0, canvas.height);
      ctx.closePath();
      ctx.fill();

      // Horizon line
      ctx.strokeStyle = horizonStrokeColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, currentHorizonScreenY);
      ctx.lineTo(canvas.width, currentHorizonScreenY);
      ctx.stroke();

      // Render ground perspective lines
      ctx.strokeStyle = gridStrokeColor;
      for (let gridX = -400; gridX <= 400; gridX += 80) {
        const p1 = project({ x: camPt.x + gridX, y: 0, z: camZ });
        const p2 = project({ x: camPt.x + gridX, y: 0, z: camZ + 500 });
        if (p1 && p2) {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }

      // ────────────────────────────────────────────────────────────────────────
      // RENDER PROCEDURAL SCENERY & Support Pillars (Sorted by Depth Z)
      // ────────────────────────────────────────────────────────────────────────
      const drawableElements: { depth: number; renderFn: () => void }[] = [];

      // Add scenery (trees, tokens, gates) to draw list
      trackItems.forEach((item) => {
        // Draw distance check
        const distZ = item.z - camZ;
        if (distZ < -20 || distZ > 450) return; // Keep rendering pool tight

        const p = project(item);
        if (!p) return;

        if (item.type === "tree") {
          drawableElements.push({
            depth: p.depth,
            renderFn: () => {
              // Simple 3D layered wireframe pine tree
              const treeHeight = 12 * item.scale;
              const trunkW = 1.5 * item.scale;
              const baseW = 7 * item.scale;

              const trunkTop = project({ x: item.x, y: item.y + treeHeight * 0.2, z: item.z });
              const trunkBase = project({ x: item.x, y: item.y, z: item.z });

              if (trunkTop && trunkBase) {
                // Trunk
                ctx.strokeStyle = "rgba(115, 77, 38, 0.3)";
                ctx.lineWidth = trunkW * (fov / p.depth) * 0.05;
                ctx.beginPath();
                ctx.moveTo(trunkBase.x, trunkBase.y);
                ctx.lineTo(trunkTop.x, trunkTop.y);
                ctx.stroke();

                // Pine leaves levels
                ctx.fillStyle = item.color;
                ctx.strokeStyle = "rgba(16, 185, 129, 0.2)";
                ctx.lineWidth = 1;

                for (let lvl = 0; lvl < 3; lvl++) {
                  const hBot = item.y + treeHeight * (0.2 + lvl * 0.25);
                  const hTop = item.y + treeHeight * (0.5 + lvl * 0.25);
                  const rWidth = baseW * (1.0 - lvl * 0.3);

                  const l = project({ x: item.x - rWidth, y: hBot, z: item.z });
                  const r = project({ x: item.x + rWidth, y: hBot, z: item.z });
                  const t = project({ x: item.x, y: hTop, z: item.z });

                  if (l && r && t) {
                    ctx.beginPath();
                    ctx.moveTo(l.x, l.y);
                    ctx.lineTo(r.x, r.y);
                    ctx.lineTo(t.x, t.y);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                  }
                }
              }
            },
          });
        } else if (item.type === "gate") {
          drawableElements.push({
            depth: p.depth,
            renderFn: () => {
              // Glowing cyber portal archways
              const w = 8;
              const h = 7;
              
              // Points of arch
              const bl = project({ x: item.x - w, y: item.y - 1.8, z: item.z });
              const br = project({ x: item.x + w, y: item.y - 1.8, z: item.z });
              const tl = project({ x: item.x - w, y: item.y + h, z: item.z });
              const tr = project({ x: item.x + w, y: item.y + h, z: item.z });

              if (bl && br && tl && tr) {
                ctx.strokeStyle = item.color;
                ctx.lineWidth = 3 * (fov / p.depth) * 0.05;
                ctx.beginPath();
                ctx.moveTo(bl.x, bl.y);
                ctx.lineTo(tl.x, tl.y);
                ctx.lineTo(tr.x, tr.y);
                ctx.lineTo(br.x, br.y);
                ctx.stroke();

                // Draw glowing lines inside gate arch
                ctx.strokeStyle = "rgba(168, 85, 247, 0.1)";
                ctx.lineWidth = 1 * (fov / p.depth) * 0.05;
                ctx.beginPath();
                ctx.moveTo(bl.x, bl.y);
                ctx.lineTo(tr.x, tr.y);
                ctx.moveTo(br.x, br.y);
                ctx.lineTo(tl.x, tl.y);
                ctx.stroke();
              }
            },
          });
        } else if (item.type === "token") {
          drawableElements.push({
            depth: p.depth,
            renderFn: () => {
              // Neon floating coin / data icon
              const spin = (time / 400) % (Math.PI * 2);
              const r = 1.0 * item.scale;
              
              // 4 corners of spinning diamond
              const p0 = project({ x: item.x + Math.sin(spin) * r, y: item.y, z: item.z + Math.cos(spin) * r });
              const p1 = project({ x: item.x, y: item.y + r, z: item.z });
              const p2 = project({ x: item.x - Math.sin(spin) * r, y: item.y, z: item.z - Math.cos(spin) * r });
              const p3 = project({ x: item.x, y: item.y - r, z: item.z });

              if (p0 && p1 && p2 && p3) {
                ctx.fillStyle = "rgba(168, 85, 247, 0.15)";
                ctx.strokeStyle = item.color;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.lineTo(p3.x, p3.y);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // Inner core
                const coreSize = 0.3;
                const c = project({ x: item.x, y: item.y, z: item.z });
                if (c) {
                  ctx.fillStyle = "#ffffff";
                  ctx.beginPath();
                  ctx.arc(c.x, c.y, Math.max(1, coreSize * (fov / p.depth)), 0, Math.PI * 2);
                  ctx.fill();
                }
              }
            },
          });
        } else if (item.type === "lavaSpike") {
          drawableElements.push({
            depth: p.depth,
            renderFn: () => {
              // Volcanic molten rock spire
              const h = 14 * item.scale;
              const w = 4 * item.scale;

              const baseL = project({ x: item.x - w, y: item.y, z: item.z });
              const baseR = project({ x: item.x + w, y: item.y, z: item.z });
              const tip = project({ x: item.x + (Math.sin(item.rotation) * w * 0.5), y: item.y + h, z: item.z });

              if (baseL && baseR && tip) {
                // Draw solid triangle body
                ctx.fillStyle = "rgba(30, 10, 10, 0.85)";
                ctx.strokeStyle = item.color; // molten orange/red outline
                ctx.lineWidth = 2 * (fov / p.depth) * 0.05;
                ctx.beginPath();
                ctx.moveTo(baseL.x, baseL.y);
                ctx.lineTo(baseR.x, baseR.y);
                ctx.lineTo(tip.x, tip.y);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // Draw glowing lava cracks inside spire
                ctx.strokeStyle = "#ef4444";
                ctx.lineWidth = 1;
                const mid = project({ x: item.x, y: item.y + h * 0.4, z: item.z });
                if (mid) {
                  ctx.beginPath();
                  ctx.moveTo(tip.x, tip.y);
                  ctx.lineTo(mid.x, mid.y);
                  ctx.lineTo(baseL.x + (baseR.x - baseL.x) * 0.5, baseL.y);
                  ctx.stroke();
                }
              }
            },
          });
        } else if (item.type === "crystal") {
          drawableElements.push({
            depth: p.depth,
            renderFn: () => {
              // Floating dual-pyramid ice crystal
              const r = 2.2 * item.scale;
              const h = 4.5 * item.scale;
              const hoverOffset = Math.sin(time / 300 + item.rotation) * 1.5;

              const cTop = project({ x: item.x, y: item.y + h + hoverOffset, z: item.z });
              const cBot = project({ x: item.x, y: item.y - h + hoverOffset, z: item.z });
              const p0 = project({ x: item.x - r, y: item.y + hoverOffset, z: item.z - r });
              const p1 = project({ x: item.x + r, y: item.y + hoverOffset, z: item.z - r });
              const p2 = project({ x: item.x + r, y: item.y + hoverOffset, z: item.z + r });
              const p3 = project({ x: item.x - r, y: item.y + hoverOffset, z: item.z + r });

              if (cTop && cBot && p0 && p1 && p2 && p3) {
                ctx.fillStyle = "rgba(6, 182, 212, 0.12)";
                ctx.strokeStyle = item.color;
                ctx.lineWidth = 1.5 * (fov / p.depth) * 0.05;

                // Draw faces helper
                const drawFace = (a: any, b: any, c: any) => {
                  ctx.beginPath();
                  ctx.moveTo(a.x, a.y);
                  ctx.lineTo(b.x, b.y);
                  ctx.lineTo(c.x, c.y);
                  ctx.closePath();
                  ctx.fill();
                  ctx.stroke();
                };

                // Upper pyramid faces
                drawFace(cTop, p0, p1);
                drawFace(cTop, p1, p2);
                drawFace(cTop, p2, p3);
                drawFace(cTop, p3, p0);

                // Lower pyramid faces
                drawFace(cBot, p0, p1);
                drawFace(cBot, p1, p2);
                drawFace(cBot, p2, p3);
                drawFace(cBot, p3, p0);
              }
            },
          });
        }
      });

      // ────────────────────────────────────────────────────────────────────────
      // GENERATE AND DRAW TRACK RAILS & PILLARS
      // ────────────────────────────────────────────────────────────────────────
      const startIdx = Math.max(0, camIdx - 5);
      const endIdx = Math.min(track3DPoints.length - 1, camIdx + 120);

      // Render track elements
      for (let i = startIdx; i < endIdx; i++) {
        const pt = track3DPoints[i];
        const nextPt = track3DPoints[i + 1];

        // Draw distance checks
        const distZ = pt.z - camZ;
        if (distZ < -30) continue;

        // 3D vector math to find parallel rails
        const tx = nextPt.x - pt.x;
        const tz = nextPt.z - pt.z;
        const len = Math.sqrt(tx * tx + tz * tz) || 1;
        const nx = -tz / len;
        const nz = tx / len;

        const railOffset = 0.9; // rails spaced 1.8m apart

        const leftStart = { x: pt.x + nx * railOffset, y: pt.y, z: pt.z };
        const rightStart = { x: pt.x - nx * railOffset, y: pt.y, z: pt.z };
        const leftEnd = { x: nextPt.x + nx * railOffset, y: nextPt.y, z: nextPt.z };
        const rightEnd = { x: nextPt.x - nx * railOffset, y: nextPt.y, z: nextPt.z };

        const ls = project(leftStart);
        const rs = project(rightStart);
        const le = project(leftEnd);
        const re = project(rightEnd);

        if (ls && le && rs && re) {
          const depth = (ls.depth + le.depth) / 2;

          // Draw Rails
          drawableElements.push({
            depth,
            renderFn: () => {
              // Left rail segment
              ctx.strokeStyle = "rgba(224, 242, 254, 0.7)";
              ctx.lineWidth = Math.max(1, 3 * (fov / depth) * 0.05);
              ctx.beginPath();
              ctx.moveTo(ls.x, ls.y);
              ctx.lineTo(le.x, le.y);
              ctx.stroke();

              // Right rail segment
              ctx.beginPath();
              ctx.moveTo(rs.x, rs.y);
              ctx.lineTo(re.x, re.y);
              ctx.stroke();

              // Rail support connection ties (every 4th index)
              if (i % 4 === 0) {
                ctx.strokeStyle = "rgba(100, 116, 139, 0.4)";
                ctx.lineWidth = Math.max(1, 4 * (fov / depth) * 0.05);
                ctx.beginPath();
                ctx.moveTo(ls.x, ls.y);
                ctx.lineTo(rs.x, rs.y);
                ctx.stroke();
              }
            },
          });
        }

        // Draw Support pillars going down to ground (every 12th index)
        if (i % 12 === 0) {
          const pillarTop = { x: pt.x, y: pt.y, z: pt.z };
          const pillarBase = { x: pt.x, y: 0, z: pt.z };

          const pTop = project(pillarTop);
          const pBase = project(pillarBase);

          if (pTop && pBase) {
            const depth = pTop.depth;
            drawableElements.push({
              depth,
              renderFn: () => {
                ctx.strokeStyle = "rgba(30, 41, 59, 0.5)";
                ctx.lineWidth = Math.max(1, 5 * (fov / depth) * 0.05);
                ctx.beginPath();
                ctx.moveTo(pTop.x, pTop.y);
                ctx.lineTo(pBase.x, pBase.y);
                ctx.stroke();

                // Crossbars on pillars
                ctx.strokeStyle = "rgba(71, 85, 105, 0.2)";
                ctx.lineWidth = Math.max(1, 2 * (fov / depth) * 0.05);
                ctx.beginPath();
                ctx.moveTo(pTop.x - (fov / depth) * 0.2, pTop.y + (pBase.y - pTop.y) * 0.5);
                ctx.lineTo(pTop.x + (fov / depth) * 0.2, pTop.y + (pBase.y - pTop.y) * 0.5);
                ctx.stroke();
              },
            });
          }
        }
      }

      // Sort all drawable elements by depth descending (render background elements first)
      drawableElements.sort((a, b) => b.depth - a.depth);
      drawableElements.forEach((el) => el.renderFn());

      // ────────────────────────────────────────────────────────────────────────
      // SPEED STREAKS / WARP HUD EFFECTS
      // ────────────────────────────────────────────────────────────────────────
      const speedRatio = (velocityRef.current - 10) / 40; // [0, 1] speed ratio
      if (speedRatio > 0.3) {
        ctx.strokeStyle = `rgba(168, 85, 247, ${speedRatio * 0.18})`;
        ctx.lineWidth = 1.5;
        const count = Math.floor(speedRatio * 35);
        for (let s = 0; s < count; s++) {
          const ang = Math.random() * Math.PI * 2;
          const radIn = 150 + Math.random() * 100;
          const radOut = radIn + 30 + speedRatio * 80;

          const sx = centerX + Math.cos(ang) * radIn;
          const sy = centerY + Math.sin(ang) * radIn;
          const ex = centerX + Math.cos(ang) * radOut;
          const ey = centerY + Math.sin(ang) * radOut;

          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
        }
      }

      // ────────────────────────────────────────────────────────────────────────
      // FIRST-PERSON CART WINDSHIELD HUD OVERLAY
      // ────────────────────────────────────────────────────────────────────────
      // Render simple neon cockpit hud lines
      ctx.strokeStyle = "rgba(224, 242, 254, 0.06)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      // Left cockpit pillar
      ctx.moveTo(20, canvas.height);
      ctx.lineTo(centerX - 180, canvas.height - 130);
      ctx.lineTo(centerX - 90, canvas.height - 40);
      // Right cockpit pillar
      ctx.moveTo(canvas.width - 20, canvas.height);
      ctx.lineTo(centerX + 180, canvas.height - 130);
      ctx.lineTo(centerX + 90, canvas.height - 40);
      // Cockpit hood connecting line
      ctx.moveTo(centerX - 180, canvas.height - 130);
      ctx.lineTo(centerX + 180, canvas.height - 130);
      ctx.stroke();

      // Draw Flailing Hands FPV Rig (Two side-by-side riders)
      const drawFlailingRider = (seatOffsetX: number, phaseShift: number) => {
        const handWobbleSpeed = 40 + (velocityRef.current * 1.5);
        
        // Left hand of this rider
        const leftHandX = centerX + seatOffsetX - 45 + Math.sin((time / handWobbleSpeed) + phaseShift) * 25;
        const leftHandY = canvas.height - 85 - Math.abs(Math.cos((time / (handWobbleSpeed * 1.2)) + phaseShift)) * 60 - (velocityRef.current - 10) * 1.8;

        // Right hand of this rider
        const rightHandX = centerX + seatOffsetX + 45 + Math.sin((time / (handWobbleSpeed * 1.1)) + phaseShift + 1) * 25;
        const rightHandY = canvas.height - 85 - Math.abs(Math.sin((time / (handWobbleSpeed * 0.9)) + phaseShift + 1)) * 60 - (velocityRef.current - 10) * 1.8;

        // Left Arm
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(centerX + seatOffsetX - 80, canvas.height + 20);
        const leftElbowX = centerX + seatOffsetX - 70 + Math.sin((time / (handWobbleSpeed * 2.0)) + phaseShift) * 10;
        const leftElbowY = canvas.height - 30;
        ctx.lineTo(leftElbowX, leftElbowY);
        ctx.lineTo(leftHandX, leftHandY);
        ctx.stroke();

        // Left Fingers
        ctx.lineWidth = 3;
        for (let f = -2; f <= 2; f++) {
          const fAng = -Math.PI / 2 + f * 0.25 + Math.sin((time / 40) + f + phaseShift) * 0.15;
          const fx = leftHandX + Math.cos(fAng) * 16;
          const fy = leftHandY + Math.sin(fAng) * 16;
          ctx.beginPath();
          ctx.moveTo(leftHandX, leftHandY);
          ctx.lineTo(fx, fy);
          ctx.stroke();
        }

        // Right Arm
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(centerX + seatOffsetX + 80, canvas.height + 20);
        const rightElbowX = centerX + seatOffsetX + 70 + Math.sin((time / (handWobbleSpeed * 2.0)) + phaseShift + 0.5) * 10;
        const rightElbowY = canvas.height - 30;
        ctx.lineTo(rightElbowX, rightElbowY);
        ctx.lineTo(rightHandX, rightHandY);
        ctx.stroke();

        // Right Fingers
        ctx.lineWidth = 3;
        for (let f = -2; f <= 2; f++) {
          const fAng = -Math.PI / 2 + f * 0.25 + Math.sin((time / 45) + f + phaseShift + 1) * 0.15;
          const fx = rightHandX + Math.cos(fAng) * 16;
          const fy = rightHandY + Math.sin(fAng) * 16;
          ctx.beginPath();
          ctx.moveTo(rightHandX, rightHandY);
          ctx.lineTo(fx, fy);
          ctx.stroke();
        }
      };

      ctx.save();
      ctx.strokeStyle = "#ffffff";
      ctx.lineCap = "round";
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#a855f7";

      // Rider 1 (Left Seat)
      drawFlailingRider(-120, 0);

      // Rider 2 (Right Seat)
      drawFlailingRider(120, 2.5);

      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [isPlaying, track3DPoints, speedMultiplier, metricType, weather]);

  if (!mounted || typeof window === "undefined") return null;

  return createPortal(
    <div className={`fixed inset-0 z-[9999] transition-all duration-300 ${
      isFullscreen 
        ? "bg-[#030008] w-screen h-screen p-0" 
        : "flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    }`}>
      <div
        ref={containerRef}
        className={`relative bg-[#030008] text-white flex flex-col justify-between overflow-hidden font-sans select-none transition-all duration-300 ${
          isFullscreen 
            ? "w-full h-full rounded-none border-none" 
            : "max-w-5xl w-full aspect-video rounded-3xl border border-white/10 shadow-[0_0_50px_rgba(168,85,247,0.25)]"
        }`}
      >
        {/* Simulation Backdrop Canvas */}
        <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" />

        {/* Top HUD Controls bar */}
        {showHud && (
          <div className="relative z-10 w-full bg-gradient-to-b from-black/80 to-transparent p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/20 border border-primary/30 rounded-xl">
                <Activity className="w-5 h-5 text-primary animate-pulse" />
              </div>
              <div>
                <h2 className="text-base font-extrabold tracking-tight flex items-center gap-2">
                  <span>Platform Rollercoaster Ride</span>
                  <span className="text-[10px] uppercase font-bold tracking-widest text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full animate-pulse">
                    FPV Mode
                  </span>
                </h2>
                <p className="text-xs text-white/50 font-medium">
                  Riding the <strong className="text-white capitalize">{selectedTrack}</strong> track in{" "}
                  <strong className="text-white capitalize">{scaleType}</strong> scale.
                </p>
              </div>
            </div>

            {/* Track / Metric selector switches */}
            <div className="flex items-center gap-3 self-end sm:self-center">
              <div className="flex items-center gap-1 bg-white/5 border border-white/10 p-1 rounded-xl">
                <span className="text-[10px] font-bold text-white/40 px-2 uppercase">Track:</span>
                <button
                  onClick={() => setSelectedTrack("aggregate")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    selectedTrack === "aggregate" ? "bg-primary text-white" : "text-white/60 hover:text-white"
                  }`}
                >
                  Aggregate
                </button>
                {brandKeys.map((bk) => (
                  <button
                    key={bk}
                    onClick={() => setSelectedTrack(bk)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      selectedTrack === bk ? "bg-primary text-white" : "text-white/60 hover:text-white"
                    }`}
                  >
                    {bk}
                  </button>
                ))}
              </div>

              {/* Fullscreen Button */}
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 text-white/80 hover:text-white transition-all shadow-lg"
                title={isFullscreen ? "Exit Fullscreen" : "Fullscreen View"}
              >
                {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
              </button>

              {/* Close button */}
              <button
                onClick={onClose}
                className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 text-red-400 hover:text-red-300 transition-all shadow-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

      {/* Floating HUD Panel (F1-Style Dashboard overlay) */}
      {showHud && (
        <div className="absolute top-[20%] left-6 z-10 bg-black/60 backdrop-blur-md border border-white/10 rounded-2xl p-5 w-60 shadow-2xl flex flex-col gap-4 text-xs">
          <h3 className="font-bold text-white/50 uppercase tracking-widest text-[9px] border-b border-white/5 pb-2">Telemetry</h3>
          
          {/* Biome Indicator */}
          <div>
            <span className="text-white/40 text-[10px]">Active Biome</span>
            <div className="text-[11px] font-extrabold text-primary flex items-center gap-1.5 mt-0.5">
              <Activity className="w-3.5 h-3.5 animate-pulse" />
              <span>{activeBiomeName}</span>
            </div>
          </div>
          
          {/* Date Card */}
          <div>
            <span className="text-white/40 text-[10px]">Active Data Node</span>
            <div className="text-base font-extrabold text-white mt-0.5">{activeNodeInfo?.date || "Calculating..."}</div>
          </div>

          {/* Value Card */}
          <div>
            <span className="text-white/40 text-[10px]">
              {metricType === "successRate" ? "Success Rate" : "Amount Earned"}
            </span>
            <div className="text-lg font-black text-primary flex items-center gap-1.5 mt-0.5">
              {metricType === "successRate" ? (
                <span>{activeNodeInfo?.value.toFixed(1)}%</span>
              ) : (
                <span>${activeNodeInfo?.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              )}
              <Award className="w-4.5 h-4.5 text-primary" />
            </div>
          </div>

          {/* Speedometer */}
          <div className="grid grid-cols-2 gap-4 border-t border-white/5 pt-4">
            <div>
              <span className="text-white/40 text-[10px]">Speed</span>
              <div className="text-xl font-black text-white tracking-tight mt-0.5 tabular-nums">
                {currentSpeedMph} <span className="text-[10px] font-normal text-white/50">mph</span>
              </div>
            </div>
            <div>
              <span className="text-white/40 text-[10px]">G-Force</span>
              <div className="text-xl font-black text-white tracking-tight mt-0.5 tabular-nums">
                {currentGForce} <span className="text-[10px] font-normal text-white/50">G</span>
              </div>
            </div>
          </div>

          {/* Live track progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-white/40 font-bold">
              <span>RIDE PROGRESS</span>
              <span>{Math.round(rideProgress)}%</span>
            </div>
            <div className="w-full bg-white/5 border border-white/5 rounded-full h-1.5 overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${rideProgress}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Bottom Dashboard Controls */}
      {showHud && (
        <div className="relative z-10 w-full bg-gradient-to-t from-black/90 to-transparent p-6 flex justify-center">
          <div className="flex items-center gap-4 bg-neutral-900/80 backdrop-blur-xl border border-white/10 px-6 py-4 rounded-3xl shadow-2xl">
            {/* Reset button */}
            <button
              onClick={() => {
                progressRef.current = 0;
                velocityRef.current = 15;
              }}
              title="Restart Ride"
              className="p-3.5 rounded-2xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/5 hover:border-white/10 transition-all"
            >
              <RotateCcw className="w-5 h-5" />
            </button>

            {/* Play/Pause Button */}
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-5 rounded-2xl bg-primary text-white hover:bg-primary-hover shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-all transform active:scale-95"
            >
              {isPlaying ? <Pause className="w-6 h-6 fill-white" /> : <Play className="w-6 h-6 fill-white" />}
            </button>

            {/* Speed multiplier selector */}
            <div className="flex items-center bg-white/5 border border-white/5 p-1 rounded-2xl">
              {([1, 2, 4] as const).map((mul) => (
                <button
                  key={mul}
                  onClick={() => setSpeedMultiplier(mul)}
                  className={`px-3 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-0.5 ${
                    speedMultiplier === mul ? "bg-primary text-white shadow-md" : "text-white/60 hover:text-white"
                  }`}
                >
                  {mul > 1 && <FastForward className="w-3.5 h-3.5" />}
                  <span>{mul}x</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* HUD Visibility Toggle Button - ALWAYS visible */}
      <button
        onClick={() => setShowHud(!showHud)}
        className="absolute bottom-5 left-5 z-30 p-2.5 rounded-xl bg-black/60 hover:bg-black/80 border border-white/10 text-white/70 hover:text-white transition-all shadow-xl active:scale-95 flex items-center justify-center"
        title={showHud ? "Hide Interface" : "Show Interface"}
      >
        {showHud ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  </div>,
  document.body
);
}
