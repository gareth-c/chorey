import type { Profile } from "../api/client";

export default function ProfileCard({
  profile,
  onClick,
  selected,
}: {
  profile: Profile;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-36 flex-col items-center gap-3 rounded-2xl border-2 p-5 backdrop-blur transition-all ${
        selected
          ? "border-amber-500 bg-amber-50 dark:border-amber-400 dark:bg-amber-400/10"
          : "border-transparent bg-white hover:border-slate-200 hover:shadow-md dark:bg-white/5 dark:hover:border-white/20 dark:hover:bg-white/10 dark:hover:shadow-none"
      }`}
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-3xl dark:bg-white/10">
        {profile.avatarEmoji}
      </span>
      <span className="text-sm font-medium text-slate-900 dark:text-white">{profile.name}</span>
      <span className="text-xs capitalize text-slate-400">{profile.role}</span>
    </button>
  );
}
