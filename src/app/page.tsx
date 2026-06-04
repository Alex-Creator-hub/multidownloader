"use client";

import { useRef, useState, useCallback } from "react";
import {
  Search,
  X,
  PlaySquare,
  Music2,
  MessageCircle,
  MessageSquare,
  Film,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Download,
  ChevronDown,
  Image,
} from "lucide-react";

/* ─── types ─── */
interface Format {
  quality: string;
  url: string;
}

interface MediaItem {
  type: "video" | "image";
  title: string;
  previewUrl: string;
  formats: Format[];
}

type Status = "idle" | "parsing" | "success" | "error";

/* ─── per-card download state ─── */
interface DownloadState {
  status: "idle" | "downloading" | "done" | "error";
  progress: number; // 0–100
}

/* ─── platforms ─── */
type Platform =
  | "youtube"
  | "douyin"
  | "xiaohongshu"
  | "kuaishou"
  | "twitter"
  | "unknown";

const platformIcons: Record<Platform, typeof PlaySquare> = {
  youtube: PlaySquare,
  douyin: Music2,
  xiaohongshu: MessageCircle,
  kuaishou: Film,
  twitter: MessageSquare,
  unknown: Search,
};

const platformColors: Record<Platform, string> = {
  youtube: "text-red-400",
  douyin: "text-pink-400",
  xiaohongshu: "text-red-300",
  kuaishou: "text-yellow-400",
  twitter: "text-sky-400",
  unknown: "text-zinc-400",
};

const platformLabels: Record<Platform, string> = {
  youtube: "YouTube",
  douyin: "抖音",
  xiaohongshu: "小红书",
  kuaishou: "快手",
  twitter: "X (Twitter)",
  unknown: "未知平台",
};

function detectPlatform(url: string): Platform | null {
  if (!url.trim()) return null;
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/douyin\.com/i.test(url)) return "douyin";
  if (/xiaohongshu\.com|xhslink\.com/i.test(url)) return "xiaohongshu";
  if (/kuaishou\.com/i.test(url)) return "kuaishou";
  if (/twitter\.com|x\.com/i.test(url)) return "twitter";
  return "unknown";
}

/* ─── helpers ─── */
function qualityRank(q: string): number {
  if (q.includes("4K")) return 2160;
  if (q.includes("2K")) return 1440;
  const n = parseInt(q, 10);
  return isNaN(n) ? 0 : n;
}

/** Extract the first valid http/https URL from arbitrary text */
function extractUrl(text: string): string {
  const m = text.match(/https?:\/\/[^\s，。、,]+/);
  return m ? m[0] : text;
}

/* ════════════════════════════════════════════
   Page
   ════════════════════════════════════════════ */
export default function Home() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [detected, setDetected] = useState<Platform | null>(null);
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  // per-card download states keyed by index
  const [dlStates, setDlStates] = useState<DownloadState[]>([]);
  // per-card selected quality index
  const [qualityIdx, setQualityIdx] = useState<number[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRefs = useRef<Map<number, XMLHttpRequest>>(new Map());

  /* ── parse ── */
  const handleParse = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!url.trim()) {
        inputRef.current?.focus();
        return;
      }
      setStatus("parsing");
      setErrorMsg("");
      setMediaList([]);
      setDlStates([]);
      setQualityIdx([]);

      try {
        const cleanUrl = extractUrl(url);
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: cleanUrl }),
        });
        const json = await res.json();
        if (!res.ok || json.error) {
          throw new Error(json.error ?? "解析失败");
        }
        const list: MediaItem[] = json.data ?? [];
        if (list.length === 0) {
          throw new Error("未解析到任何媒体");
        }
        setMediaList(list);
        setDlStates(list.map(() => ({ status: "idle", progress: 0 })));
        setQualityIdx(list.map((m) => 0)); // default: highest quality
        setStatus("success");
      } catch (err: any) {
        setErrorMsg(err.message);
        setStatus("error");
      }
    },
    [url],
  );

  const handleClear = useCallback(() => {
    setUrl("");
    setDetected(null);
    setStatus("idle");
    setMediaList([]);
    setDlStates([]);
    setQualityIdx([]);
    setErrorMsg("");
    inputRef.current?.focus();
  }, []);

  const handleInputChange = useCallback((value: string) => {
    setUrl(value);
    setDetected(detectPlatform(value));
    if (value.trim()) setStatus("idle");
  }, []);

  /* ── quality change ── */
  const handleQualityChange = useCallback(
    (mediaIdx: number, fmtIdx: number) => {
      setQualityIdx((prev) => {
        const next = [...prev];
        next[mediaIdx] = fmtIdx;
        return next;
      });
    },
    [],
  );

  /* ── download single file via XHR with progress ── */
  const downloadSingle = useCallback(
    (idx: number) => {
      const item = mediaList[idx];
      if (!item) return;
      const fmt = item.formats[qualityIdx[idx]];
      if (!fmt?.url) {
        setErrorMsg("下载链接为空，请检查解析结果");
        setStatus("error");
        return;
      }

      // update state to downloading
      setDlStates((prev) => {
        const next = [...prev];
        next[idx] = { status: "downloading", progress: 0 };
        return next;
      });

      const xhr = new XMLHttpRequest();
      xhrRefs.current.set(idx, xhr);

      // Use direct download for YouTube (faster, no Vercel proxy)
      // Only use proxy for platforms that need CORS bypass
      const useProxy = !fmt.url.includes("googlevideo.com");
      const downloadUrl = useProxy
        ? `/api/download?url=${encodeURIComponent(fmt.url)}`
        : fmt.url;

      xhr.open("GET", downloadUrl);
      xhr.responseType = "blob";

      xhr.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setDlStates((prev) => {
            const next = [...prev];
            if (next[idx]?.status === "downloading") {
              next[idx].progress = pct;
            }
            return next;
          });
        }
      };

      xhr.onload = () => {
        xhrRefs.current.delete(idx);
        if (xhr.status !== 200) {
          setDlStates((prev) => {
            const next = [...prev];
            next[idx] = { status: "error", progress: 0 };
            return next;
          });
          return;
        }
        const blob = xhr.response as Blob;
        triggerDownload(blob, item.title || `video_${idx}`);
        setDlStates((prev) => {
          const next = [...prev];
          next[idx] = { status: "done", progress: 100 };
          return next;
        });
      };

      xhr.onerror = () => {
        xhrRefs.current.delete(idx);
        setDlStates((prev) => {
          const next = [...prev];
          next[idx] = { status: "error", progress: 0 };
          return next;
        });
      };

      xhr.send();
    },
    [mediaList, qualityIdx],
  );

  /* ── save all ── */
  const handleSaveAll = useCallback(() => {
    for (let i = 0; i < mediaList.length; i++) {
      const st = dlStates[i];
      if (st?.status === "idle" || st?.status === "error") {
        downloadSingle(i);
      }
    }
  }, [mediaList, dlStates, downloadSingle]);

  /* ── helpers ── */
  const hasDownloads =
    dlStates.some((s) => s.status === "downloading" || s.status === "done");
  const allDone = dlStates.every((s) => s.status === "done");

  const PlatformIcon = detected ? platformIcons[detected] : null;

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-10 sm:py-16">
      {/* ─── Hero ─── */}
      <section className="flex flex-col items-center gap-6 mb-10 text-center">
        {/* Abstract modern icon — layered arcs + dot */}
        <div className="relative size-20 flowing-border rounded-2xl p-[2px]">
          <div className="size-full rounded-2xl bg-slate-950 flex items-center justify-center overflow-hidden">
            <svg
              viewBox="0 0 64 64"
              className="size-10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {/* outer arc */}
              <path d="M18 44C12 38 12 26 18 20" className="text-violet-400" />
              {/* middle arc */}
              <path d="M26 48C18 42 18 22 26 16" className="text-violet-300" />
              {/* inner arc */}
              <path d="M34 44C28 38 28 26 34 20" className="text-sky-400" />
              {/* floating dot */}
              <circle cx="46" cy="18" r="3" className="text-sky-300" fill="currentColor" />
              {/* diagonal accent */}
              <line x1="40" y1="48" x2="52" y2="36" className="text-violet-200/60" />
            </svg>
          </div>
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gradient font-display leading-tight">
          M<span className="text-zinc-100/80">ultidownloader</span>
        </h1>
        <p className="text-base sm:text-lg text-zinc-400 max-w-md">
          粘贴链接，一键下载全网视频与图片
        </p>
      </section>

      {/* ─── Input ─── */}
      <div className="w-full max-w-xl">
        <form onSubmit={handleParse}>
          <div
            className={`glass-strong flex items-center gap-2 rounded-2xl px-4 py-3 transition-all duration-300 ${
              status === "error"
                ? "border-red-500/50 shadow-red-500/10"
                : "focus-within:border-violet-500/40"
            }`}
          >
            <Search className="size-5 shrink-0 text-zinc-500" />
            <input
              ref={inputRef}
              type="text"
              inputMode="url"
              value={url}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder="粘贴视频或图片链接..."
              autoFocus
              className="flex-1 bg-transparent text-base outline-none placeholder:text-zinc-600 min-w-0"
            />
            {url && (
              <button
                type="button"
                onClick={handleClear}
                className="shrink-0 p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors"
              >
                <X className="size-4" />
              </button>
            )}
            <button
              type="submit"
              disabled={status === "parsing"}
              className="btn-primary shrink-0 h-10 px-5 rounded-xl text-white text-sm font-medium disabled:opacity-40 disabled:pointer-events-none transition-all"
            >
              {status === "parsing" ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  解析中
                </span>
              ) : (
                "解析"
              )}
            </button>
          </div>
        </form>

        {/* platform hint */}
        {detected && status === "idle" && PlatformIcon && (
          <div className="mt-3 flex items-center gap-2 text-sm text-zinc-400 animate-fade-in-up">
            <PlatformIcon className={`size-4 ${platformColors[detected]}`} />
            <span>
              检测到{" "}
              <strong className="text-zinc-200">
                {platformLabels[detected]}
              </strong>{" "}
              链接
            </span>
          </div>
        )}

        {/* error feedback */}
        {status === "error" && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-400 animate-fade-in-up">
            <AlertCircle className="size-4 shrink-0" />
            <span>{errorMsg || "解析失败，请检查链接是否正确"}</span>
          </div>
        )}
        {status === "success" && (
          <div className="mt-3 flex items-center gap-2 text-sm text-emerald-400 animate-fade-in-up">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>
              解析成功，共 {mediaList.length} 个媒体
            </span>
          </div>
        )}
      </div>

      {/* ─── Media Grid ─── */}
      {mediaList.length > 0 && (
        <section className="w-full max-w-3xl mt-10 space-y-4">
          {/* toolbar */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-400">
              共 {mediaList.length} 项
            </h2>
            <button
              onClick={handleSaveAll}
              disabled={allDone}
              className="btn-primary inline-flex items-center gap-2 h-9 px-4 rounded-xl text-white text-xs font-medium disabled:opacity-40 disabled:pointer-events-none transition-all"
            >
              <Download className="size-4" />
              {allDone ? "全部已下载" : "全部保存"}
            </button>
          </div>

          {/* cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {mediaList.map((item, idx) => (
              <MediaCard
                key={idx}
                item={item}
                idx={idx}
                dlState={dlStates[idx]}
                selectedQualityIdx={qualityIdx[idx] ?? 0}
                onQualityChange={handleQualityChange}
                onDownload={downloadSingle}
              />
            ))}
          </div>
        </section>
      )}

      {/* ─── Platform badges ─── */}
      {mediaList.length === 0 && (
        <section className="mt-16 w-full max-w-xl">
          <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-600 text-center mb-6">
            支持平台
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {(
              [
                ["youtube", "YouTube", PlaySquare, "text-red-400"],
                ["douyin", "抖音", Music2, "text-pink-400"],
                ["xiaohongshu", "小红书", MessageCircle, "text-red-300"],
                ["kuaishou", "快手", Film, "text-yellow-400"],
                ["twitter", "X (Twitter)", MessageSquare, "text-sky-400"],
              ] as const
            ).map(([id, label, Icon, color]) => (
              <div
                key={id}
                className="glass flex flex-col items-center gap-2 rounded-xl px-3 py-4 transition-all hover:bg-white/[0.07]"
              >
                <Icon className={`size-6 ${color}`} />
                <span className="text-xs text-zinc-500 font-medium">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── Footer ─── */}
      <footer className="mt-auto pt-16 pb-4 text-xs text-zinc-700 text-center">
        <p>粘贴即表示您同意遵守各平台的服务条款</p>
      </footer>
    </div>
  );
}

/* ════════════════════════════════════════════
   MediaCard
   ════════════════════════════════════════════ */
function MediaCard({
  item,
  idx,
  dlState,
  selectedQualityIdx,
  onQualityChange,
  onDownload,
}: {
  item: MediaItem;
  idx: number;
  dlState?: DownloadState;
  selectedQualityIdx: number;
  onQualityChange: (mediaIdx: number, fmtIdx: number) => void;
  onDownload: (idx: number) => void;
}) {
  const isVideo = item.type === "video";
  const state = dlState ?? { status: "idle", progress: 0 };

  const handleDL = () => onDownload(idx);

  return (
    <div className="glass rounded-2xl overflow-hidden transition-all duration-300 hover:bg-white/[0.06] group animate-fade-in-up">
      {/* preview */}
      <div className="relative aspect-video bg-slate-900 overflow-hidden">
        {item.previewUrl ? (
          <img
            src={item.previewUrl}
            alt={item.title}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="size-full flex items-center justify-center">
            {isVideo ? (
              <PlaySquare className="size-10 text-zinc-700" />
            ) : (
              <Image className="size-10 text-zinc-700" />
            )}
          </div>
        )}
        {/* type badge */}
        <span className="absolute top-2 left-2 glass text-[10px] px-2 py-0.5 rounded-full text-zinc-400 uppercase tracking-wider">
          {isVideo ? "Video" : "Image"}
        </span>
        {/* download state overlay */}
        {state.status === "done" && (
          <div className="absolute inset-0 bg-emerald-500/10 flex items-center justify-center backdrop-blur-sm">
            <CheckCircle2 className="size-8 text-emerald-400" />
          </div>
        )}
      </div>

      {/* body */}
      <div className="p-3 space-y-3">
        {/* title */}
        <p className="text-xs text-zinc-300 leading-relaxed line-clamp-1">
          {item.title || "未命名"}
        </p>

        {/* quality selector + download button */}
        <div className="flex items-center gap-2">
          {/* quality dropdown */}
          {isVideo && item.formats.length > 1 && (
            <div className="relative flex-1">
              <select
                value={selectedQualityIdx}
                onChange={(e) =>
                  onQualityChange(idx, Number(e.target.value))
                }
                className="w-full glass text-xs text-zinc-300 rounded-lg px-3 py-2 pr-8 outline-none cursor-pointer transition-colors hover:bg-white/[0.08]"
              >
                {item.formats.map((fmt, fi) => (
                  <option key={fi} value={fi} className="bg-slate-900">
                    {fmt.quality}
                    {fi === 0 ? " (最高)" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-500 pointer-events-none" />
            </div>
          )}
          {isVideo && item.formats.length <= 1 && (
            <div className="flex-1 text-xs text-zinc-600 px-1">
              {item.formats[0]?.quality ?? "原画"}
            </div>
          )}

          {/* download button */}
          <button
            onClick={handleDL}
            disabled={state.status === "downloading" || state.status === "done"}
            className="shrink-0 btn-primary inline-flex items-center justify-center size-9 rounded-xl text-white disabled:opacity-40 disabled:pointer-events-none transition-all"
            title="保存到手机"
          >
            {state.status === "done" ? (
              <CheckCircle2 className="size-4" />
            ) : state.status === "downloading" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
          </button>
        </div>

        {/* progress bar */}
        {state.status === "downloading" && (
          <div className="space-y-1 animate-fade-in-up">
            <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-sky-500 progress-active transition-all duration-300 ease-out"
                style={{ width: `${state.progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-zinc-500">
              <span>下载中...</span>
              <span className="tabular-nums">{state.progress}%</span>
            </div>
          </div>
        )}

        {state.status === "error" && (
          <p className="text-[10px] text-red-400 animate-fade-in-up">
            下载失败，请重试
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── trigger browser download ─── */
function triggerDownload(blob: Blob, filename: string) {
  const ext = blob.type.includes("mp4")
    ? ".mp4"
    : blob.type.includes("png")
      ? ".png"
      : blob.type.includes("webp")
        ? ".webp"
        : "";
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
