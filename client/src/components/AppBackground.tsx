/**
 * Fixed, page-independent backdrop: a dark gradient plus slow-drifting glow
 * blobs. Mounted once above the router so every screen — including the
 * Child Portal — shares the same cinematic base rather than each page
 * carrying its own background.
 */
export default function AppBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950">
      <div className="absolute -left-32 -top-32 h-96 w-96 animate-blob rounded-full bg-brand-500/20 blur-3xl" />
      <div
        className="absolute -bottom-32 right-0 h-[28rem] w-[28rem] animate-blob rounded-full bg-amber-400/10 blur-3xl"
        style={{ animationDelay: "4s" }}
      />
      <div
        className="absolute right-1/3 top-1/4 h-72 w-72 animate-blob rounded-full bg-fuchsia-500/10 blur-3xl"
        style={{ animationDelay: "8s" }}
      />
    </div>
  );
}
