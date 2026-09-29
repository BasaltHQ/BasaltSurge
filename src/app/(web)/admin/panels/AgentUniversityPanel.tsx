"use client";

import React, { useState, useEffect, useRef } from "react";
import { useActiveAccount } from "thirdweb/react";
import { Loader2, Video, Plus, Trash2, Link as LinkIcon, RefreshCcw, UploadCloud, Star, FileVideo, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";

export interface AgentVideo {
    _id: string;
    id?: string;
    title: string;
    description: string;
    category: string;
    url: string;
    duration: number;
    isPrimary?: boolean;
    createdAt: string;
}

export default function AgentUniversityPanelExt() {
    const account = useActiveAccount();
    const [videos, setVideos] = useState<AgentVideo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("General");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadVideos = async () => {
        try {
            setLoading(true);
            setError("");
            const res = await fetch("/api/admin/agent-videos", {
                headers: { "x-wallet": account?.address || "" }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to load videos");
            
            // Clean arrays ensuring validity 
            setVideos(Array.isArray(data.videos) ? data.videos : []);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (account?.address) {
            loadVideos();
        }
    }, [account?.address]);

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this agent training video?")) return;
        try {
            const res = await fetch(`/api/admin/agent-videos?id=${encodeURIComponent(id)}`, {
                method: "DELETE",
                headers: { "x-wallet": account?.address || "" }
            });
            if (!res.ok) throw new Error("Failed to delete video");
            
            // Re-render local array actively
            setVideos(prev => prev.filter(v => v._id !== id && v.id !== id));
        } catch (e: any) {
            alert(e.message);
        }
    };

    const handleSetPrimary = async (id: string) => {
        try {
            const res = await fetch(`/api/admin/agent-videos`, {
                method: "PUT",
                headers: { "x-wallet": account?.address || "", "Content-Type": "application/json" },
                body: JSON.stringify({ id })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Failed to set primary video");
            }
            
            setVideos(prev => prev.map(v => 
                (v._id === id || v.id === id) ? { ...v, isPrimary: true } : { ...v, isPrimary: false }
            ));
        } catch (e: any) {
            alert(e.message);
        }
    };

    const handleUploadSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedFile || !title) return;

        setUploadProgress(0);
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", selectedFile);
            formData.append("title", title);
            formData.append("description", description);
            formData.append("category", category);
            
            const dbData = await new Promise<any>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', '/api/admin/agent-videos', true);
                xhr.setRequestHeader('x-wallet', account?.address || "");

                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        setUploadProgress((event.loaded / event.total) * 100);
                    }
                };

                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            resolve(JSON.parse(xhr.responseText));
                        } catch (e) {
                            reject(new Error("Failed to parse server response"));
                        }
                    } else {
                        try {
                            const errResp = JSON.parse(xhr.responseText);
                            reject(new Error(errResp.error || "Failed to syndicate video protocol"));
                        } catch (e) {
                            reject(new Error(`Upload failed with status: ${xhr.status}`));
                        }
                    }
                };

                xhr.onerror = () => reject(new Error("Network Error occurred during upload."));
                xhr.send(formData);
            });

            // Sync visual UI
            setVideos(prev => [dbData.video, ...prev]);
            
            // Reset wizard
            setIsUploadModalOpen(false);
            setTitle("");
            setDescription("");
            setCategory("General");
            setSelectedFile(null);
            setUploadProgress(0);
            
        } catch (e: any) {
            alert(e.message);
        } finally {
            setUploading(false);
        }
    };

    if (loading && videos.length === 0) {
        return (
            <div className="py-20 flex flex-col items-center gap-3 text-muted-foreground w-full">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span>Loading Agent University Repository...</span>
            </div>
        );
    }

    return (
        <div className="w-full space-y-6 pb-24 px-4 sm:px-6 lg:px-8">
            {/* Header Toolbar */}
            <div className="glass-pane rounded-xl border p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div data-tour="agentUniversity.training-library">
                    <h2 className="text-xl font-semibold tracking-tight">Agent University</h2>
                    <p className="text-xs text-muted-foreground/70 mt-1 max-w-2xl">
                        S3-backed global training pipelines. Videos uploaded here instantly syndicate out to all active agent dashboards over the platform namespace.
                    </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <button 
                        onClick={loadVideos} 
                        className="p-2.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors disabled:opacity-50"
                        title="Refresh Repository"
                    >
                        <RefreshCcw className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <button data-tour="agentUniversity.training-uploads"
                        onClick={() => setIsUploadModalOpen(true)}
                        className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 shadow-lg shadow-primary/20 transition flex items-center gap-2"
                    >
                        <UploadCloud className="h-4 w-4" />
                        Upload Video
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
                    {error}
                </div>
            )}

            {/* Global Matrix Render */}
            {videos.length === 0 ? (
                <div className="py-20 text-center glass-pane border border-dashed border-foreground/20 rounded-xl">
                    <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-foreground/5 shadow-inner mb-4 border border-foreground/10">
                        <Video className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-base font-semibold">No Training Protocols Embedded</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto mt-2">
                        You have not uploaded any agent training videos to the decentralized repository yet.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {videos.map((vid) => (
                        <div key={vid._id || vid.id} className={`glass-pane rounded-xl border overflow-hidden shadow-sm group relative ${vid.isPrimary ? 'border-primary/50 ring-1 ring-primary/20 bg-primary/5' : 'border-foreground/10'}`}>
                            {vid.isPrimary && (
                                <div className="absolute top-3 right-3 z-20 bg-primary text-black text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full shadow-lg flex items-center gap-1">
                                    <Star className="w-3 h-3 fill-black" /> Primary
                                </div>
                            )}
                            {/* Player Wrapper */}
                            <div className="aspect-video bg-black/50 relative border-b border-foreground/5">
                                <video 
                                    src={vid.url} 
                                    controls 
                                    className="w-full h-full object-contain"
                                    preload="metadata"
                                >
                                    Your browser does not natively support HTML5 standard tracking.
                                </video>
                            </div>
                            
                            {/* Meta Data Panel */}
                            <div className="p-5 z-10 space-y-3 bg-foreground/[0.01]">
                                <div>
                                    <h4 className="font-semibold text-sm line-clamp-1" title={vid.title}>{vid.title}</h4>
                                    {vid.description && (
                                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1" title={vid.description}>
                                            {vid.description}
                                        </p>
                                    )}
                                </div>
                                <div className="pt-3 flex items-center justify-between border-t border-foreground/5">
                                    <span className="text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                                        {vid.category || "General"}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                        <button 
                                            onClick={() => handleSetPrimary(vid._id || vid.id as string)}
                                            className={`p-1.5 rounded-md transition ${vid.isPrimary ? 'text-amber-400 bg-amber-400/10' : 'text-muted-foreground hover:text-amber-400 hover:bg-amber-400/10'}`}
                                            title="Set as Hero Video"
                                        >
                                            <Star className={`h-3.5 w-3.5 ${vid.isPrimary ? 'fill-amber-400' : ''}`} />
                                        </button>
                                        <button 
                                            onClick={() => handleDelete(vid._id || vid.id as string)}
                                            className="text-red-500 hover:text-red-400 p-1.5 rounded-md hover:bg-red-500/10 transition"
                                            title="Delete Training Segment"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Upload Modal Binding */}
            <Modal 
                open={isUploadModalOpen} 
                onClose={() => !uploading && setIsUploadModalOpen(false)}
                title="New Agent Video"
                description="Connect long-form mp4/webm HD content directly to the AWS Media Pipeline."
            >
                <form onSubmit={handleUploadSubmit} className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold mb-2 uppercase tracking-wider text-muted-foreground/70">Video Package (Max 250MB)</label>
                            
                            {!selectedFile ? (
                                <div 
                                    className={`relative border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all duration-200 cursor-pointer ${isDragging ? 'border-primary bg-primary/5' : 'border-foreground/10 hover:border-foreground/20 hover:bg-foreground/[0.02]'}`}
                                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                    onDragLeave={() => setIsDragging(false)}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        setIsDragging(false);
                                        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                                            setSelectedFile(e.dataTransfer.files[0]);
                                        }
                                    }}
                                    onClick={() => !uploading && fileInputRef.current?.click()}
                                >
                                    <div className={`p-4 rounded-full mb-4 transition-colors ${isDragging ? 'bg-primary/20 text-primary' : 'bg-foreground/5 text-muted-foreground'}`}>
                                        <UploadCloud className="w-8 h-8" />
                                    </div>
                                    <h4 className="text-sm font-semibold mb-1">Drag and drop your video here</h4>
                                    <p className="text-xs text-muted-foreground">or click to browse from your computer</p>
                                    <p className="text-[10px] text-muted-foreground/60 mt-4 uppercase tracking-widest font-semibold">Supports MP4, WebM, QuickTime</p>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="video/mp4,video/webm,video/quicktime,video/*"
                                        className="hidden"
                                        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                        disabled={uploading}
                                    />
                                </div>
                            ) : (
                                <div className="border border-primary/30 bg-primary/5 rounded-xl p-4 flex items-center justify-between relative overflow-hidden group">
                                    <div className="flex items-center gap-3 relative z-10">
                                        <div className="p-2.5 rounded-lg bg-primary/20 text-primary">
                                            <FileVideo className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-semibold line-clamp-1">{selectedFile.name}</h4>
                                            <p className="text-xs text-muted-foreground">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                                        </div>
                                    </div>
                                    <button 
                                        type="button"
                                        onClick={() => setSelectedFile(null)}
                                        disabled={uploading}
                                        className="p-2 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors relative z-10 disabled:opacity-50"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider text-muted-foreground/70">Course Title</label>
                            <input 
                                type="text"
                                placeholder="E.g. Objection Handling 101"
                                className="w-full px-3 py-2 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                disabled={uploading}
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider text-muted-foreground/70">Category</label>
                            <select
                                className="w-full px-3 py-2 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                disabled={uploading}
                            >
                                <option value="General">General</option>
                                <option value="Sales Strategies">Sales Strategies</option>
                                <option value="Product Walkthroughs">Product Walkthroughs</option>
                                <option value="Technical Setup">Technical Setup</option>
                                <option value="Compliance">Compliance</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider text-muted-foreground/70">Course Details (Optional)</label>
                            <textarea 
                                placeholder="Brief summary to display underneath video block..."
                                className="w-full px-3 py-2 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm min-h-[80px] focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors resize-none"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                disabled={uploading}
                            />
                        </div>

                        {uploading && (
                            <div className="pt-2">
                                <div className="flex justify-between items-center text-xs font-semibold mb-1 text-muted-foreground uppercase tracking-wider">
                                    <span>Syndicating to Container...</span>
                                    <span className="text-primary">{Math.round(uploadProgress)}%</span>
                                </div>
                                <div className="w-full h-2 bg-muted/50 rounded-full overflow-hidden border border-white/5">
                                    <div 
                                        className="h-full bg-gradient-to-r from-primary to-blue-500 transition-all duration-300 ease-out"
                                        style={{ width: `${uploadProgress}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="pt-4 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setIsUploadModalOpen(false)}
                                disabled={uploading}
                                className="px-4 py-2 text-sm font-semibold rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={uploading || !selectedFile || !title}
                                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:brightness-110 transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                                {uploading ? "Syndicating to S3..." : "Upload Protocol"}
                            </button>
                        </div>
                    </form>
            </Modal>
        </div>
    );
}
