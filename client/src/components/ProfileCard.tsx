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
          ? "border-amber-400 bg-amber-400/10"
          : "border-transparent bg-white/5 hover:border-white/20 hover:bg-white/10"
      }`}
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-3xl">
        {profile.avatarEmoji}
      </span>
      <span className="text-sm font-medium text-white">{profile.name}</span>
      <span className="text-xs capitalize text-slate-400">{profile.role}</span>
    </button>
  );
}
