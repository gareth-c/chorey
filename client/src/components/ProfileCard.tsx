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
      className={`flex w-36 flex-col items-center gap-3 rounded-2xl border-2 p-5 transition-all ${
        selected
          ? "border-brand-500 bg-brand-50"
          : "border-transparent bg-white hover:border-brand-200 hover:shadow-md"
      }`}
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-3xl">
        {profile.avatarEmoji}
      </span>
      <span className="text-sm font-medium text-slate-900">{profile.name}</span>
      <span className="text-xs capitalize text-slate-400">{profile.role}</span>
    </button>
  );
}
