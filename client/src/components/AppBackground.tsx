/**
 * Fixed, page-independent backdrop: a gradient plus slow-drifting glow
 * blobs. Mounted once above the router so every screen — including the
 * Child Portal — shares the same base rather than each page carrying its
 * own background. Pastel in light mode, cinematic in dark mode.
 */
export default function AppBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-gradient-to-br from-slate-50 via-indigo-50 to-slate-100 dark:from-slate-950 dark:via-indigo-950 dark:to-slate-950">
      <div className="absolute -left-32 -top-32 h-96 w-96 animate-blob rounded-full bg-brand-400/20 blur-3xl dark:bg-brand-500/20" />
      <div
        className="absolute -bottom-32 right-0 h-[28rem] w-[28rem] animate-blob rounded-full bg-amber-300/20 blur-3xl dark:bg-amber-400/10"
        style={{ animationDelay: "4s" }}
      />
      <div
        className="absolute right-1/3 top-1/4 h-72 w-72 animate-blob rounded-full bg-fuchsia-300/10 blur-3xl dark:bg-fuchsia-500/10"
        style={{ animationDelay: "8s" }}
      />
    </div>
  );
}
