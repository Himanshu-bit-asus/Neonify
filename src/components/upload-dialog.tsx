"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  FileAudio,
  Image as ImageIcon,
  Loader2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApiToken } from "@/components/auth-provider";

type Step = "pick" | "meta" | "uploading" | "processing";

interface Props {
  close: () => void;
  onPublished?: () => void;
}

const GENRES = [
  "Electronic", "Indie Pop", "Hip-Hop", "R&B", "Pop", "Folk",
  "Rock", "Jazz", "Alternative", "Chill", "Classical", "Country",
  "Dance", "Metal", "Soul",
];

const AUDIO_MIME = ["audio/mpeg", "audio/wav", "audio/flac", "audio/x-wav", "audio/aac", "audio/mp4", "audio/x-m4a"] as const;
const COVER_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api").replace(/\/$/, "");

function IconButton({ label, onClick, children }: { label: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white">
      {children}
    </button>
  );
}

export function UploadDialog({ close, onPublished }: Props) {
  const getApiToken = useApiToken();
  const [step, setStep] = useState<Step>("pick");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [audioDragOver, setAudioDragOver] = useState(false);
  const [coverDragOver, setCoverDragOver] = useState(false);

  const [title, setTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [album, setAlbum] = useState("");
  const [genre, setGenre] = useState("Electronic");
  const [tags, setTags] = useState("");
  const [metaError, setMetaError] = useState("");

  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [pollError, setPollError] = useState("");
  const [songId, setSongId] = useState<string | null>(null);
  const [songStatus, setSongStatus] = useState<"PROCESSING" | "READY" | "FAILED">("PROCESSING");
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollFailuresRef = useRef(0);
  const pollContextRef = useRef<{ songId: string; token: string | null } | null>(null);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  useEffect(() => () => stopPolling(), []);

  const pollStatus = async (id: string, token: string | null) => {
    try {
      const res = await fetch(`${API_URL}/songs/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Status check failed (${res.status})`);
      const data = await res.json() as { status: "PROCESSING" | "READY" | "FAILED"; isPublished?: boolean };
      pollFailuresRef.current = 0;
      setPollError("");
      setSongStatus(data.status);
      if (data.status === "READY" && data.isPublished) setPublished(true);
      if (data.status === "READY" || data.status === "FAILED") stopPolling();
    } catch {
      pollFailuresRef.current += 1;
      if (pollFailuresRef.current >= 5) {
        stopPolling();
        setPollError("Could not check processing status. Retry the status check.");
      }
    }
  };

  const startStatusPolling = (id: string, token: string | null) => {
    stopPolling();
    pollFailuresRef.current = 0;
    pollContextRef.current = { songId: id, token };
    setPollError("");
    void pollStatus(id, token);
    pollRef.current = setInterval(() => void pollStatus(id, token), 3000);
  };

  const pickAudio = (file: File) => {
    if (file.type && !AUDIO_MIME.includes(file.type as typeof AUDIO_MIME[number])) {
      alert("Choose an MP3, WAV, FLAC, or AAC audio file");
      return;
    }
    if (file.size > 250 * 1024 * 1024) { alert("Audio file must be under 250 MB"); return; }
    setAudioFile(file);
  };

  const pickCover = (file: File) => {
    if (!COVER_MIME.includes(file.type as typeof COVER_MIME[number])) return;
    if (file.size > 10 * 1024 * 1024) { alert("Cover image must be under 10 MB"); return; }
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const handleAudioDrop = (e: React.DragEvent) => {
    e.preventDefault(); setAudioDragOver(false);
    const file = e.dataTransfer.files[0]; if (file) pickAudio(file);
  };

  const handleCoverDrop = (e: React.DragEvent) => {
    e.preventDefault(); setCoverDragOver(false);
    const file = e.dataTransfer.files[0]; if (file) pickCover(file);
  };

  const validateAndNext = () => {
    setMetaError("");
    if (!title.trim()) return setMetaError("Title is required.");
    if (!artistName.trim()) return setMetaError("Artist name is required.");
    if (!genre) return setMetaError("Please select a genre.");
    startUpload();
  };

  const startUpload = async () => {
    setStep("uploading");
    setUploadProgress(0);
    setUploadError("");
    setPollError("");
    try {
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10);
      const audioMime = (audioFile!.type || "audio/mpeg") as typeof AUDIO_MIME[number];
      const token = await getApiToken();
      const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const intentRes = await fetch(`${API_URL}/creator/upload-intents`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), artistName: artistName.trim(), album: album.trim() || undefined, genre, tags: tagList, contentType: audioMime }),
      });
      if (!intentRes.ok) {
        const err = await intentRes.json().catch(() => ({})) as { message?: string };
        if (intentRes.status === 401) throw new Error("Please sign in before uploading a release.");
        if (intentRes.status === 403) throw new Error("Creator access is required to upload a release.");
        throw new Error(err.message ?? "Failed to create upload intent");
      }
      const intent = await intentRes.json() as { songId: string; uploadUrl: string };
      setSongId(intent.songId);

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", intent.uploadUrl);
        xhr.setRequestHeader("Content-Type", audioFile!.type || "audio/mpeg");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * (coverFile ? 80 : 100)));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`S3 upload failed: ${xhr.status}`)));
        xhr.onerror = () => reject(new Error("Network error during audio upload"));
        xhr.send(audioFile!);
      });

      if (coverFile) {
        setUploadProgress(82);
        const coverRes = await fetch(`${API_URL}/creator/songs/${intent.songId}/cover-art-intent`, {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: coverFile.type }),
        });
        if (!coverRes.ok) throw new Error("Could not create the cover art upload");
        const { uploadUrl: coverUploadUrl } = await coverRes.json() as { uploadUrl: string };
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", coverUploadUrl);
          xhr.setRequestHeader("Content-Type", coverFile.type);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setUploadProgress(82 + Math.round((e.loaded / e.total) * 18));
          };
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Cover upload failed: ${xhr.status}`)));
          xhr.onerror = () => reject(new Error("Network error during cover upload"));
          xhr.send(coverFile);
        });
      }

      setUploadProgress(100);
      const completeRes = await fetch(`${API_URL}/creator/songs/${intent.songId}/complete`, {
        method: "POST",
        headers: authHeaders,
      });
      if (!completeRes.ok) throw new Error("Upload finished, but processing could not be started");
      setStep("processing");
      setSongStatus("PROCESSING");
      startStatusPolling(intent.songId, token);
    } catch (err) {
      setUploadError(err instanceof TypeError
        ? "The upload service is unreachable. Start the API and configure audio storage, then try again."
        : err instanceof Error ? err.message : "Upload failed. Please try again.");
    }
  };

  const publish = async () => {
    if (!songId) return;
    setPublishing(true);
    try {
      const token = await getApiToken();
      const res = await fetch(`${API_URL}/creator/songs/${songId}`, {
        method: "PATCH",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ isPublished: true }),
      });
      if (!res.ok) throw new Error("Publish failed");
      setPublished(true);
      onPublished?.();
    } catch { alert("Could not publish the song. Please try again."); }
    finally { setPublishing(false); }
  };

  const STEPS: Step[] = ["pick", "meta", "uploading", "processing"];
  const stepIdx = STEPS.indexOf(step);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#171717] shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/[.07] px-6 pt-6 pb-5">
          <div>
            <h2 className="text-xl font-black">Upload a release</h2>
            <p className="mt-1 text-sm text-zinc-400">Audio is transcoded to HLS in the background before publishing.</p>
          </div>
          <IconButton label="Close upload dialog" onClick={close}><X className="h-5 w-5" /></IconButton>
        </div>

        {/* Step bar */}
        <div className="flex gap-1 px-6 pt-4">
          {STEPS.map((s, i) => (
            <div key={s} className={cn("h-1 flex-1 rounded-full transition-all duration-300",
              step === s ? "bg-lime-300" : stepIdx > i ? "bg-lime-300/40" : "bg-white/10")} />
          ))}
        </div>

        <div className="px-6 py-5">

          {/* STEP 1: Pick files */}
          {step === "pick" && (
            <div className="space-y-4">
              <label
                onDragOver={(e) => { e.preventDefault(); setAudioDragOver(true); }}
                onDragLeave={() => setAudioDragOver(false)}
                onDrop={handleAudioDrop}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition",
                  audioDragOver ? "border-lime-300 bg-lime-300/[.06]" : "border-white/20 hover:border-lime-300/60 hover:bg-lime-300/[.03]",
                  audioFile && "border-lime-300/60 bg-lime-300/[.04]"
                )}
              >
                {audioFile ? (
                  <>
                    <FileAudio className="h-8 w-8 text-lime-300" />
                    <p className="text-sm font-bold text-white">{audioFile.name}</p>
                    <p className="text-xs text-zinc-500">{(audioFile.size / 1024 / 1024).toFixed(1)} MB � Click to change</p>
                  </>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-lime-300" />
                    <p className="text-sm font-semibold text-white">Drop audio or browse</p>
                    <p className="text-xs text-zinc-500">WAV, FLAC, MP3, AAC, M4A � up to 250 MB</p>
                  </>
                )}
                <input className="sr-only" type="file" accept="audio/*" onChange={(e) => e.target.files?.[0] && pickAudio(e.target.files[0])} />
              </label>

              <label
                onDragOver={(e) => { e.preventDefault(); setCoverDragOver(true); }}
                onDragLeave={() => setCoverDragOver(false)}
                onDrop={handleCoverDrop}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 text-center transition",
                  coverDragOver ? "border-violet-400 bg-violet-400/[.06]" : "border-white/20 hover:border-violet-400/60 hover:bg-violet-400/[.03]",
                  coverFile && "border-violet-400/60 bg-violet-400/[.04]"
                )}
              >
                {coverPreview ? (
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={coverPreview} alt="Cover preview" className="h-14 w-14 rounded-md object-cover shadow" />
                    <div className="text-left">
                      <p className="text-sm font-bold text-white">{coverFile?.name}</p>
                      <p className="text-xs text-zinc-500">Click to change</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <ImageIcon className="h-6 w-6 text-violet-400" />
                    <p className="text-sm font-semibold text-white">Cover art <span className="text-zinc-500 font-normal">(optional)</span></p>
                    <p className="text-xs text-zinc-500">JPG, PNG, WEBP � up to 10 MB</p>
                  </>
                )}
                <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && pickCover(e.target.files[0])} />
              </label>

              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={close} className="rounded-full px-4 py-2 text-sm font-bold text-zinc-400 hover:text-white">Cancel</button>
                <button type="button" disabled={!audioFile} onClick={() => setStep("meta")}
                  className="rounded-full bg-lime-300 px-5 py-2 text-sm font-bold text-[#172000] transition hover:bg-lime-200 disabled:opacity-40 disabled:cursor-not-allowed">
                  Next � Add details
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Metadata */}
          {step === "meta" && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="col-span-2 flex flex-col gap-1.5 text-xs font-semibold text-zinc-300">
                  Release title *
                  <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Night Drive"
                    className="rounded-md border border-white/10 bg-white/[.06] px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300" />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-zinc-300">
                  Artist name *
                  <input value={artistName} onChange={(e) => setArtistName(e.target.value)} placeholder="e.g. Nova Lane"
                    className="rounded-md border border-white/10 bg-white/[.06] px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300" />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-zinc-300">
                  Album <span className="font-normal text-zinc-500">(optional)</span>
                  <input value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="e.g. Afterglow"
                    className="rounded-md border border-white/10 bg-white/[.06] px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300" />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-zinc-300">
                  Genre *
                  <select value={genre} onChange={(e) => setGenre(e.target.value)}
                    className="rounded-md border border-white/10 bg-[#1f1f1f] px-3 py-2.5 text-sm text-white outline-none focus:border-lime-300">
                    {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
                <label className="col-span-2 flex flex-col gap-1.5 text-xs font-semibold text-zinc-300">
                  Tags <span className="font-normal text-zinc-500">(comma-separated, up to 10)</span>
                  <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="dreamy, synthwave, late night"
                    className="rounded-md border border-white/10 bg-white/[.06] px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300" />
                </label>
              </div>
              {metaError && (
                <p className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 border border-red-500/20">
                  <XCircle className="h-3.5 w-3.5 shrink-0" /> {metaError}
                </p>
              )}
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setStep("pick")} className="rounded-full px-4 py-2 text-sm font-bold text-zinc-400 hover:text-white">Back</button>
                <button type="button" onClick={validateAndNext} className="rounded-full bg-lime-300 px-5 py-2 text-sm font-bold text-[#172000] transition hover:bg-lime-200">Upload track</button>
              </div>
            </div>
          )}

          {/* STEP 3: Uploading */}
          {step === "uploading" && (
            <div className="flex flex-col items-center gap-5 py-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-lime-300/30 bg-lime-300/10">
                <Loader2 className="h-7 w-7 animate-spin text-lime-300" />
              </div>
              <div className="w-full space-y-2 text-center">
                <p className="text-sm font-bold text-white">
                  {uploadProgress < 80 ? "Uploading audio to storage�" : uploadProgress < 100 ? "Uploading cover art�" : "Finalising�"}
                </p>
                <p className="text-xs text-zinc-500">{uploadProgress}% complete</p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-lime-300 transition-all duration-200" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
              {uploadError && (
                <div className="w-full rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-center">
                  <p className="text-sm font-bold text-red-400">{uploadError}</p>
                  <button type="button" onClick={() => { setStep("meta"); setUploadError(""); }}
                    className="mt-3 rounded-full bg-red-500/20 px-4 py-1.5 text-xs font-bold text-red-300 hover:bg-red-500/30">Try again</button>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: Processing / Done */}
          {step === "processing" && (
            <div className="flex flex-col items-center gap-5 py-6 text-center">
              {songStatus === "PROCESSING" && (
                <>
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-violet-400/30 bg-violet-400/10">
                    <Loader2 className="h-7 w-7 animate-spin text-violet-400" />
                    <span className="absolute -top-1 -right-1 flex h-4 w-4">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-30" />
                      <span className="relative inline-flex h-4 w-4 rounded-full bg-violet-400 opacity-60" />
                    </span>
                  </div>
                  <div>
                    <p className="text-base font-bold text-white">Transcoding your track�</p>
                    <p className="mt-1 text-xs text-zinc-400">Encoding to 160k &amp; 320k HLS streams. Usually under a minute.</p>
                  </div>
                  <div className="flex gap-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-1 w-1 rounded-full bg-violet-400/60 animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />
                    ))}
                  </div>
                </>
              )}
              {songStatus === "READY" && !published && (
                <>
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-lime-300/30 bg-lime-300/10">
                    <CheckCircle2 className="h-8 w-8 text-lime-300" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-white">Your track is ready! ??</p>
                    <p className="mt-1 text-xs text-zinc-400">Transcoding complete. Publish it when you are ready for listeners to discover it.</p>
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={close} className="rounded-full border border-white/15 px-5 py-2 text-sm font-bold text-zinc-300 hover:text-white">Save as draft</button>
                    <button type="button" onClick={publish} disabled={publishing}
                      className="inline-flex items-center gap-2 rounded-full bg-lime-300 px-5 py-2 text-sm font-bold text-[#172000] shadow-lg shadow-lime-300/20 transition hover:bg-lime-200 disabled:opacity-60">
                      {publishing && <Loader2 className="h-4 w-4 animate-spin" />}
                      {publishing ? "Publishing�" : "Publish now"}
                    </button>
                  </div>
                </>
              )}
              {songStatus === "READY" && published && (
                <>
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-lime-300/50 bg-lime-300/15">
                    <CheckCircle2 className="h-8 w-8 text-lime-300" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-lime-300">Published! ??</p>
                    <p className="mt-1 text-xs text-zinc-400">Your song is now live in the catalog for all listeners.</p>
                  </div>
                  <button type="button" onClick={close} className="rounded-full bg-white px-5 py-2 text-sm font-bold text-black transition hover:bg-zinc-100">Done</button>
                </>
              )}
              {songStatus === "FAILED" && (
                <>
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10">
                    <XCircle className="h-8 w-8 text-red-400" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-white">Transcoding failed</p>
                    <p className="mt-1 text-xs text-zinc-400">Something went wrong. Please try again with a different file.</p>
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={close} className="rounded-full border border-white/15 px-5 py-2 text-sm font-bold text-zinc-400 hover:text-white">Close</button>
                    <button type="button" onClick={() => { setStep("pick"); setAudioFile(null); setSongId(null); setSongStatus("PROCESSING"); }}
                      className="rounded-full bg-red-500/20 px-5 py-2 text-sm font-bold text-red-300 hover:bg-red-500/30">Try again</button>
                  </div>
                </>
              )}
              {pollError && (
                <div className="w-full rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-center">
                  <p className="text-sm font-bold text-amber-200">{pollError}</p>
                  <button type="button" onClick={() => {
                    const context = pollContextRef.current;
                    if (context) startStatusPolling(context.songId, context.token);
                  }} className="mt-3 rounded-full bg-amber-400/15 px-4 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-400/25">Retry status check</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
