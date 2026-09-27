import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { Plus, Trash2, Edit2, Send, Image as ImageIcon, CheckCircle2, AlertCircle, Type, GripVertical, Link as LinkIcon, Minus, Smartphone, Monitor, Maximize2, Minimize2, LayoutTemplate, Rows } from "lucide-react";
import { SystemUpdate, UpdateCategory, UpdateTarget, UpdateStatus } from "@/types/updates";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type BlockType = 'hero' | 'heading' | 'paragraph' | 'button' | 'divider';

interface NewsletterBlock {
  id: string;
  type: BlockType;
  content: string;
  url?: string;
}

// --------------------------------------------------------------------------------
// Sortable Block Component
// --------------------------------------------------------------------------------
function SortableBlock({ block, onUpdate, onRemove }: { block: NewsletterBlock, onUpdate: (id: string, updates: Partial<NewsletterBlock>) => void, onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: block.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const getIcon = () => {
    switch (block.type) {
      case 'hero': return <ImageIcon className="w-4 h-4 text-blue-400" />;
      case 'heading': return <Type className="w-4 h-4 text-emerald-400" />;
      case 'paragraph': return <Type className="w-4 h-4 text-gray-400" />;
      case 'button': return <LinkIcon className="w-4 h-4 text-purple-400" />;
      case 'divider': return <Minus className="w-4 h-4 text-zinc-500" />;
    }
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group border border-foreground/[0.05] bg-foreground/[0.02] p-4 rounded-2xl shadow-sm mb-3 flex items-start gap-3 backdrop-blur-md">
      <div {...attributes} {...listeners} className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-white transition-colors touch-none">
        <GripVertical className="w-5 h-5" />
      </div>
      
      <div className="flex-1 space-y-3 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getIcon()}
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{block.type}</span>
          </div>
          <button onClick={() => onRemove(block.id)} className="opacity-0 group-hover:opacity-100 p-1.5 text-red-400/70 hover:text-red-400 hover:bg-red-500/20 rounded-md transition-all">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {block.type === 'hero' && (
          <input type="text" value={block.content} onChange={e => onUpdate(block.id, { content: e.target.value })} placeholder="Image URL (e.g. https://...)" className="w-full bg-background border border-foreground/[0.05] rounded-lg p-2.5 text-sm focus:border-foreground/30 focus:outline-none transition-colors" />
        )}
        {block.type === 'heading' && (
          <input type="text" value={block.content} onChange={e => onUpdate(block.id, { content: e.target.value })} placeholder="Heading text..." className="w-full bg-background border border-foreground/[0.05] rounded-lg p-2.5 text-base font-bold focus:border-foreground/30 focus:outline-none transition-colors" />
        )}
        {block.type === 'paragraph' && (
          <textarea value={block.content} onChange={e => onUpdate(block.id, { content: e.target.value })} placeholder="Paragraph content (Markdown supported)..." className="w-full h-24 bg-background border border-foreground/[0.05] rounded-lg p-2.5 text-sm focus:border-foreground/30 focus:outline-none resize-y transition-colors" />
        )}
        {block.type === 'button' && (
          <div className="grid grid-cols-2 gap-3">
            <input type="text" value={block.content} onChange={e => onUpdate(block.id, { content: e.target.value })} placeholder="Button Label" className="w-full bg-background border border-foreground/[0.05] rounded-lg p-2.5 text-sm focus:border-foreground/30 focus:outline-none transition-colors" />
            <input type="text" value={block.url || ''} onChange={e => onUpdate(block.id, { url: e.target.value })} placeholder="Button URL" className="w-full bg-background border border-foreground/[0.05] rounded-lg p-2.5 text-sm focus:border-foreground/30 focus:outline-none transition-colors" />
          </div>
        )}
        {block.type === 'divider' && (
          <div className="h-px bg-foreground/[0.05] w-full my-2" />
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------
// Main Panel
// --------------------------------------------------------------------------------
export function UpdatesPanel({ brandKey }: { brandKey?: string }) {
  const [activeTab, setActiveTab] = useState<"system" | "newsletter">("system");

  // --- System Updates State ---
  const [updates, setUpdates] = useState<SystemUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [currentUpdate, setCurrentUpdate] = useState<Partial<SystemUpdate>>({
    title: "", content: "", category: "FEATURE", target: "ALL", partnerId: "", status: "PUBLISHED"
  });

  // --- Newsletter State ---
  const [newsEmails, setNewsEmails] = useState("");
  const [newsSubject, setNewsSubject] = useState("");
  const [blocks, setBlocks] = useState<NewsletterBlock[]>([
    { id: "1", type: "heading", content: "BasaltSurge Updates" },
    { id: "2", type: "paragraph", content: "Welcome to the latest partner newsletter." }
  ]);
  const [sendingNewsletter, setSendingNewsletter] = useState(false);
  const [newsResult, setNewsResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"split" | "stacked">("split");

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    fetchUpdates();
  }, []);

  const fetchUpdates = async () => {
    setLoading(true);
    try {
      const url = brandKey ? `/api/admin/updates?brandKey=${brandKey}` : "/api/admin/updates";
      const res = await fetch(url);
      const data = await res.json();
      if (data.ok) setUpdates(data.updates);
      else setError(data.error);
    } catch (err) {
      setError("Failed to fetch updates");
    }
    setLoading(false);
  };

  const handleSaveUpdate = async () => {
    try {
      const url = brandKey ? `/api/admin/updates?brandKey=${brandKey}` : "/api/admin/updates";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentUpdate),
      });
      const data = await res.json();
      if (data.ok) {
        setIsEditing(false);
        setCurrentUpdate({ title: "", content: "", category: "FEATURE", target: "ALL", partnerId: "", status: "PUBLISHED" });
        fetchUpdates();
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert("Failed to save");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this update?")) return;
    try {
      const url = brandKey ? `/api/admin/updates?brandKey=${brandKey}&id=${id}` : `/api/admin/updates?id=${id}`;
      const res = await fetch(url, { method: "DELETE" });
      if (res.ok) fetchUpdates();
    } catch (err) {
      alert("Failed to delete");
    }
  };

  // --- DnD Handlers ---
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setBlocks((items) => {
        const oldIndex = items.findIndex(i => i.id === active.id);
        const newIndex = items.findIndex(i => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const addBlock = (type: BlockType) => {
    const newBlock: NewsletterBlock = { id: crypto.randomUUID(), type, content: type === 'button' ? 'Click Here' : '' };
    setBlocks([...blocks, newBlock]);
  };

  const updateBlock = (id: string, blockUpdates: Partial<NewsletterBlock>) => {
    setBlocks(blocks.map(b => b.id === id ? { ...b, ...blockUpdates } : b));
  };

  const removeBlock = (id: string) => {
    setBlocks(blocks.filter(b => b.id !== id));
  };

  // --- HTML Compilation Engine ---
  const generateEmailHtml = () => {
    const htmlBlocks = blocks.map(b => {
      if (b.type === 'hero') {
        return b.content ? `<img src="${b.content}" alt="Hero Image" style="width: 100%; height: auto; border-radius: 8px; margin-bottom: 24px; display: block; border: 1px solid #27272a;" />` : '';
      }
      if (b.type === 'heading') {
        return `<h2 style="color: #f4f4f5; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; margin-top: 0; margin-bottom: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">${b.content}</h2>`;
      }
      if (b.type === 'paragraph') {
        const paragraphs = b.content.split(/\n\n+/);
        return paragraphs.map(p => {
          let html = p.replace(/\n/g, '<br/>');
          html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #ffffff;">$1</strong>');
          html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
          return `<p style="color: #a1a1aa; font-size: 15px; line-height: 1.6; margin-top: 0; margin-bottom: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">${html}</p>`;
        }).join('\n');
      }
      if (b.type === 'button') {
        return `<div style="margin: 32px 0; text-align: center;">
                  <a href="${b.url || '#'}" style="display: inline-block; padding: 12px 28px; background-color: #f4f4f5; color: #09090b; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">${b.content}</a>
                </div>`;
      }
      if (b.type === 'divider') {
        return `<hr style="border: 0; border-top: 1px solid #27272a; margin: 32px 0;" />`;
      }
      return '';
    }).join('\n');

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { margin: 0; padding: 0; background-color: #09090b; -webkit-font-smoothing: antialiased; }
        .wrapper { width: 100%; background-color: #09090b; padding: 40px 0; }
        .container { max-width: 600px; margin: 0 auto; background-color: #18181b; border: 1px solid #27272a; border-radius: 12px; overflow: hidden; }
        .header { padding: 32px 40px; border-bottom: 1px solid #27272a; text-align: center; background-color: #09090b; }
        .header-title { color: #f4f4f5; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        .header-subtitle { color: #a1a1aa; font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; margin-top: 8px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        .content { padding: 40px; }
        .footer { text-align: center; padding: 32px 40px; border-top: 1px solid #27272a; color: #52525b; font-size: 12px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="container">
            <div class="header">
                <img src="https://surge.basalthq.com/BasaltSurgeWideD.png" alt="BasaltSurge" style="height: 40px; width: auto; max-width: 100%; display: block; margin: 0 auto;" />
                <div class="header-subtitle">Partners Newsletter</div>
            </div>
            <div class="content">
                ${htmlBlocks}
            </div>
            <div class="footer">
                &copy; ${new Date().getFullYear()} BasaltSurge Platform. All rights reserved.
            </div>
        </div>
    </div>
</body>
</html>`;
  };

  const handleSendNewsletter = async () => {
    if (!newsEmails || !newsSubject || blocks.length === 0) {
      alert("Please fill in emails, subject, and add content blocks.");
      return;
    }
    setSendingNewsletter(true);
    setNewsResult(null);
    try {
      const url = brandKey ? `/api/admin/updates/newsletter?brandKey=${brandKey}` : "/api/admin/updates/newsletter";
      const compiledHtml = generateEmailHtml();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emails: newsEmails.split(",").map(e => e.trim()).filter(Boolean),
          subject: newsSubject,
          html: compiledHtml
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setNewsResult({ ok: true, msg: "Newsletter sent successfully!" });
      } else {
        setNewsResult({ ok: false, msg: data.error || "Failed to send newsletter." });
      }
    } catch (err: any) {
      setNewsResult({ ok: false, msg: err.message || "Failed to send." });
    }
    setSendingNewsletter(false);
  };

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">
      {/* Top Header */}
      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">Platform Communications</h2>
            <p className="text-sm text-muted-foreground mt-1">Manage System Roadmap and send sleek partner newsletters.</p>
          </div>

          {/* Tabs & Layout Controls */}
          <div className="flex items-center gap-4">
            <div className="flex gap-1">
              <button data-tour="updates.activeTab.system" data-tour-action="activate" data-tour-active={activeTab === "system"}
                onClick={() => setActiveTab("system")}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === "system" ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02]"}`}
              >
                System Updates
              </button>
              <button data-tour="updates.activeTab.newsletter" data-tour-action="activate" data-tour-active={activeTab === "newsletter"}
                onClick={() => setActiveTab("newsletter")}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === "newsletter" ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02]"}`}
              >
                Newsletter Studio
              </button>
            </div>
        
            {activeTab === "newsletter" && (
              <div className="flex items-center gap-1 bg-foreground/[0.02] rounded-lg p-1 border border-foreground/[0.05]">
                <button 
                  onClick={() => setLayoutMode("split")} 
                  className={`p-1.5 rounded-md transition-colors flex items-center gap-2 text-xs font-medium ${layoutMode === 'split' ? 'bg-emerald-500/10 text-emerald-500' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <LayoutTemplate className="w-3.5 h-3.5" /> Split
                </button>
                <button 
                  onClick={() => setLayoutMode("stacked")} 
                  className={`p-1.5 rounded-md transition-colors flex items-center gap-2 text-xs font-medium ${layoutMode === 'stacked' ? 'bg-emerald-500/10 text-emerald-500' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Rows className="w-3.5 h-3.5" /> Stacked
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SYSTEM UPDATES TAB */}
      {activeTab === "system" && (
        <div data-tour="updates.activeTab.system.content" className="space-y-6">
          {!isEditing ? (
            <>
              <div className="flex justify-end">
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary px-4 py-2 rounded-lg border border-primary/20 transition-all shadow-[0_0_15px_rgba(var(--primary),0.2)]"
                >
                  <Plus className="w-4 h-4" />
                  Post New Update
                </button>
              </div>

              {loading ? (
                <div className="h-32 flex items-center justify-center text-muted-foreground">Loading updates...</div>
              ) : error ? (
                <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg">{error}</div>
              ) : updates.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center border border-foreground/[0.05] bg-foreground/[0.02] rounded-2xl text-muted-foreground">
                  No updates posted yet.
                </div>
              ) : (
                <div className="grid gap-4">
                  {updates.map((u) => (
                    <div key={u.id} className="relative group p-5 rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md shadow-sm overflow-hidden">
                      <div className="absolute top-0 left-0 w-1 h-full bg-primary/30" />
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${u.category === 'FEATURE' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : u.category === 'BUGFIX' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-blue-500/10 border-blue-500/30 text-blue-400'}`}>
                              {u.category}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(u.createdAt).toLocaleDateString()}
                            </span>
                            <span className="text-xs text-muted-foreground opacity-50">•</span>
                            <span className="text-xs text-muted-foreground">Target: {u.target === 'ALL' ? 'All Partners' : u.partnerId}</span>
                          </div>
                          <h3 className="text-lg font-semibold text-foreground">{u.title}</h3>
                          <div className="text-sm text-muted-foreground mt-2 line-clamp-3 prose prose-sm prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{u.content}</ReactMarkdown>
                          </div>
                        </div>
                        <div className="flex gap-2 opacity-100 transition-opacity">
                          <button
                            onClick={() => { setCurrentUpdate(u); setIsEditing(true); }}
                            className="p-2 hover:bg-white/10 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(u.id)}
                            className="p-2 hover:bg-red-500/20 rounded-md text-muted-foreground hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="p-6 rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md shadow-sm space-y-6">
              <h3 className="text-lg font-medium">{currentUpdate.id ? 'Edit Update' : 'New Roadmap Update'}</h3>
              
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Title</label>
                  <input
                    type="text"
                    value={currentUpdate.title || ""}
                    onChange={(e) => setCurrentUpdate({ ...currentUpdate, title: e.target.value })}
                    className="w-full bg-background border border-foreground/[0.05] rounded-lg p-3 text-sm focus:border-foreground/30 focus:outline-none transition-colors"
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Category</label>
                  <select
                    value={currentUpdate.category}
                    onChange={(e) => setCurrentUpdate({ ...currentUpdate, category: e.target.value as UpdateCategory })}
                    className="w-full bg-background border border-foreground/[0.05] rounded-lg p-3 text-sm focus:border-foreground/30 focus:outline-none transition-colors"
                  >
                    <option value="FEATURE">Feature</option>
                    <option value="IMPROVEMENT">Improvement</option>
                    <option value="BUGFIX">Bugfix</option>
                    <option value="ANNOUNCEMENT">Announcement</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Target</label>
                  <select
                    value={currentUpdate.target}
                    onChange={(e) => setCurrentUpdate({ ...currentUpdate, target: e.target.value as UpdateTarget })}
                    className="w-full bg-background border border-foreground/[0.05] rounded-lg p-3 text-sm focus:border-foreground/30 focus:outline-none transition-colors"
                  >
                    <option value="ALL">All Partners</option>
                    <option value="SPECIFIC_PARTNER">Specific Partner</option>
                  </select>
                </div>

                {currentUpdate.target === "SPECIFIC_PARTNER" && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Partner Wallet/Slug</label>
                    <input
                      type="text"
                      value={currentUpdate.partnerId || ""}
                      onChange={(e) => setCurrentUpdate({ ...currentUpdate, partnerId: e.target.value })}
                      className="w-full bg-background border border-foreground/[0.05] rounded-lg p-3 text-sm focus:border-foreground/30 focus:outline-none transition-colors"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Content (Markdown supported)</label>
                <textarea
                  value={currentUpdate.content || ""}
                  onChange={(e) => setCurrentUpdate({ ...currentUpdate, content: e.target.value })}
                  className="w-full h-48 bg-background border border-foreground/[0.05] rounded-lg p-3 text-sm focus:border-foreground/30 focus:outline-none transition-colors font-mono resize-y"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-foreground/[0.05]">
                <button onClick={() => setIsEditing(false)} className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-white/5 transition-colors">Cancel</button>
                <button onClick={handleSaveUpdate} className="px-6 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-[0_0_15px_rgba(var(--primary),0.3)]">Publish Update</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* NEWSLETTER STUDIO TAB */}
      {activeTab === "newsletter" && (
        <div data-tour="updates.activeTab.newsletter.content" className={layoutMode === "split" ? "grid 2xl:grid-cols-[1fr_600px] xl:grid-cols-[1fr_500px] gap-8 items-start" : "flex flex-col gap-8"}>
          
          {/* Left Column: Editor & Builder */}
          <div className="space-y-6">
            
            {/* Meta Data Panel */}
            <div className="p-6 rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md shadow-sm space-y-4">
              <h3 className="text-sm font-semibold flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
                <Send className="w-4 h-4 text-primary" /> Broadcast Setup
              </h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Recipients</label>
                  <input
                    type="text"
                    value={newsEmails}
                    onChange={(e) => setNewsEmails(e.target.value)}
                    className="w-full bg-background border border-foreground/[0.05] rounded-lg p-2.5 text-sm focus:border-foreground/30 focus:outline-none transition-colors"
                    placeholder="partner@example.com, ..."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Subject Line</label>
                  <input
                    type="text"
                    value={newsSubject}
                    onChange={(e) => setNewsSubject(e.target.value)}
                    className="w-full bg-background border border-foreground/[0.05] rounded-lg p-2.5 text-sm focus:border-foreground/30 focus:outline-none transition-colors"
                    placeholder="BasaltSurge Q3 Updates"
                  />
                </div>
              </div>
            </div>

            {/* Drag & Drop Builder */}
            <div className="p-6 rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md shadow-sm flex flex-col min-h-[500px]">
              
              {/* Component Palette */}
              <div className="flex flex-wrap gap-2 mb-6 p-3 bg-foreground/[0.02] border border-foreground/[0.05] rounded-xl">
                <button onClick={() => addBlock('hero')} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-background border border-foreground/[0.05] rounded-lg hover:border-foreground/20 hover:bg-foreground/[0.02] transition-colors">
                  <ImageIcon className="w-3 h-3" /> Hero Image
                </button>
                <button onClick={() => addBlock('heading')} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-background border border-foreground/[0.05] rounded-lg hover:border-foreground/20 hover:bg-foreground/[0.02] transition-colors">
                  <Type className="w-3 h-3" /> Heading
                </button>
                <button onClick={() => addBlock('paragraph')} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-background border border-foreground/[0.05] rounded-lg hover:border-foreground/20 hover:bg-foreground/[0.02] transition-colors">
                  <Type className="w-3 h-3" /> Paragraph
                </button>
                <button onClick={() => addBlock('button')} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-background border border-foreground/[0.05] rounded-lg hover:border-foreground/20 hover:bg-foreground/[0.02] transition-colors">
                  <LinkIcon className="w-3 h-3" /> CTA Button
                </button>
                <button onClick={() => addBlock('divider')} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-background border border-foreground/[0.05] rounded-lg hover:border-foreground/20 hover:bg-foreground/[0.02] transition-colors">
                  <Minus className="w-3 h-3" /> Divider
                </button>
              </div>

              {/* DnD Canvas */}
              <div className="flex-1 bg-foreground/[0.01] rounded-xl p-4 border border-foreground/[0.05] overflow-y-auto">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                    {blocks.map(block => (
                      <SortableBlock key={block.id} block={block} onUpdate={updateBlock} onRemove={removeBlock} />
                    ))}
                  </SortableContext>
                </DndContext>
                {blocks.length === 0 && (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    Drag and drop or click a component above to build your newsletter.
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="mt-6 pt-6 border-t border-foreground/[0.05] flex items-center justify-between">
                <div className="flex-1">
                  {newsResult && (
                    <div className={`flex items-center gap-2 text-sm ${newsResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {newsResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      {newsResult.msg}
                    </div>
                  )}
                </div>
                <button
                  onClick={handleSendNewsletter}
                  disabled={sendingNewsletter}
                  className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-[0_0_20px_rgba(var(--primary),0.3)] disabled:opacity-50"
                >
                  {sendingNewsletter ? "Sending..." : "Dispatch via SES"}
                  <Send className="w-4 h-4" />
                </button>
              </div>

            </div>
          </div>

          {/* Right Column: Live Dark Mode HTML Preview */}
          <div className={isPreviewExpanded ? "fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl p-4 md:p-8 flex flex-col" : `rounded-2xl border border-foreground/[0.05] bg-[#09090b] shadow-sm overflow-hidden h-[800px] flex flex-col ${layoutMode === "split" ? "sticky top-6" : "w-full"}`}>
            <div className="bg-foreground/[0.02] border border-foreground/[0.05] px-4 py-3 flex items-center justify-between shadow-sm z-10 rounded-t-2xl shrink-0">
              <div className="flex items-center gap-4">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Live HTML Render</span>
                <div className="flex items-center bg-foreground/[0.02] rounded-lg p-1 border border-foreground/[0.05]">
                  <button onClick={() => setPreviewMode("mobile")} className={`p-1.5 rounded-md transition-colors ${previewMode === 'mobile' ? 'bg-emerald-500/10 text-emerald-500' : 'text-muted-foreground hover:text-foreground'}`}><Smartphone className="w-4 h-4" /></button>
                  <button onClick={() => setPreviewMode("desktop")} className={`p-1.5 rounded-md transition-colors ${previewMode === 'desktop' ? 'bg-emerald-500/10 text-emerald-500' : 'text-muted-foreground hover:text-foreground'}`}><Monitor className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setIsPreviewExpanded(!isPreviewExpanded)} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors bg-foreground/[0.02] rounded-md border border-foreground/[0.05]">
                  {isPreviewExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
            
            {/* Embedded Iframe Preview to guarantee isolation of styles */}
            <div className="flex-1 w-full bg-[#09090b] flex justify-center overflow-hidden border border-t-0 border-foreground/[0.05] rounded-b-2xl">
              <div className={`transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${previewMode === 'mobile' ? 'w-[375px] border-x border-foreground/[0.05] shadow-lg' : 'w-full'} h-full bg-[#09090b] overflow-hidden relative`}>
                <iframe 
                  srcDoc={generateEmailHtml()} 
                  className="w-full h-full border-none bg-[#09090b]"
                  title="Email Preview"
                />
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
