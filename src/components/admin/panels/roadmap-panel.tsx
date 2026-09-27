import React, { useState, useEffect } from "react";
import { Milestone, Flag, Star, Bug, Megaphone, Clock } from "lucide-react";
import { SystemUpdate } from "@/types/updates";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

export function RoadmapPanel({ brandKey }: { brandKey?: string }) {
  const [updates, setUpdates] = useState<SystemUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchUpdates();
  }, [brandKey]);

  const fetchUpdates = async () => {
    setLoading(true);
    try {
      const url = brandKey ? `/api/admin/updates?brandKey=${brandKey}` : "/api/admin/updates";
      const res = await fetch(url);
      const data = await res.json();
      if (data.ok) {
        setUpdates(data.updates);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError("Failed to fetch roadmap");
    }
    setLoading(false);
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'FEATURE': return <Star className="w-4 h-4 text-emerald-400" />;
      case 'IMPROVEMENT': return <Flag className="w-4 h-4 text-blue-400" />;
      case 'BUGFIX': return <Bug className="w-4 h-4 text-rose-400" />;
      case 'ANNOUNCEMENT': return <Megaphone className="w-4 h-4 text-purple-400" />;
      default: return <Milestone className="w-4 h-4 text-gray-400" />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'FEATURE': return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
      case 'IMPROVEMENT': return 'bg-blue-500/10 border-blue-500/30 text-blue-400';
      case 'BUGFIX': return 'bg-rose-500/10 border-rose-500/30 text-rose-400';
      case 'ANNOUNCEMENT': return 'bg-purple-500/10 border-purple-500/30 text-purple-400';
      default: return 'bg-gray-500/10 border-gray-500/30 text-gray-400';
    }
  };

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex items-center gap-4 mb-2">
          <div className="p-3 bg-foreground/[0.02] rounded-xl border border-foreground/[0.05] shadow-sm">
            <Milestone className="w-8 h-8 text-primary" />
          </div>
          <div data-tour="roadmap.product-roadmap">
            <h2 className="text-3xl font-bold tracking-tight">Platform Roadmap</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Track the latest features, improvements, and system updates for the BasaltSurge ecosystem.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-64 flex flex-col items-center justify-center text-muted-foreground gap-4">
          <Clock className="w-8 h-8 animate-spin opacity-50" />
          <p>Loading the future...</p>
        </div>
      ) : error ? (
        <div className="p-6 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl">{error}</div>
      ) : updates.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center border border-foreground/[0.05] bg-foreground/[0.02] rounded-2xl text-muted-foreground">
          <Milestone className="w-12 h-12 opacity-20 mb-4" />
          <p>No roadmap updates available yet.</p>
        </div>
      ) : (
        <div data-tour="roadmap.timeline" className="relative pl-4 md:pl-8 py-4">
          {/* Vertical glowing timeline line */}
          <div className="absolute left-[15px] md:left-[31px] top-0 bottom-0 w-px bg-gradient-to-b from-primary/40 via-foreground/[0.05] to-transparent" />

          <div className="space-y-12">
            {updates.map((u, index) => (
              <div key={u.id} className="relative pl-8 md:pl-12 group">
                {/* Timeline Node */}
                <div className="absolute left-[-5px] md:left-[-5px] top-1 w-10 h-10 rounded-full bg-background border border-foreground/[0.05] flex items-center justify-center shadow-sm z-10 group-hover:border-primary/30 group-hover:shadow-md transition-all duration-300">
                  {getCategoryIcon(u.category)}
                </div>

                {/* Content Card */}
                <div className="p-6 rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md shadow-sm hover:bg-foreground/[0.04] transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-lg">
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <span className={`text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border ${getCategoryColor(u.category)}`}>
                      {u.category}
                    </span>
                    <span className="text-sm font-medium text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </span>
                  </div>
                  
                  <h3 className="text-2xl font-bold mb-4 tracking-tight">{u.title}</h3>
                  
                  <div className="prose prose-sm prose-invert max-w-none text-muted-foreground leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                      {u.content}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
