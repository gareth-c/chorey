import { useEffect, useState } from "react";
import { api } from "../api/client";

interface VersionInfo {
  label: string;
  year: number;
  month: number;
  build: number;
}

/**
 * Small, unobtrusive build label pinned to the bottom-right corner. Reads the
 * baked-in version from `GET /api/version` so it reflects exactly what's
 * running. Renders nothing until it has a real label.
 */
export default function VersionBadge() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<VersionInfo>("/version")
      .then((v) => {
        if (active && v.label && v.label !== "unknown") setLabel(v.label);
      })
      .catch(() => {
        // A missing/broken version endpoint shouldn't surface to the user.
      });
    return () => {
      active = false;
    };
  }, []);

  if (!label) return null;

  return (
    <div className="pointer-events-none fixed bottom-2 right-2 z-50 select-none text-[10px] font-medium text-slate-500 dark:text-slate-400">
      {label}
    </div>
  );
}
