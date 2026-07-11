import { useTheme } from "../context/useTheme";

/**
 * Fixed top-right light/dark switch, present on every screen. Uses emoji
 * rather than an icon library, matching the avatar/emoji language already
 * used throughout the app.
 */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="fixed right-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-full
        border border-slate-200 bg-white text-lg text-slate-600 shadow-sm transition
        hover:bg-slate-50 dark:border-white/15 dark:bg-white/10 dark:text-slate-200
        dark:shadow-none dark:backdrop-blur dark:hover:bg-white/20"
    >
      {isDark ? "☀️" : "🌙"}
    </button>
  );
}
