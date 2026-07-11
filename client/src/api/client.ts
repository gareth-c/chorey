export type Role = "parent" | "child";

export interface SessionUser {
  id: string;
  name: string;
  avatar_emoji: string;
  role: Role;
}

export interface Profile {
  id: string;
  name: string;
  avatarEmoji: string;
  role: Role;
  hasPassword: boolean;
  hasPasskey: boolean;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const { error } = body;
    if (typeof error === "string") return error;
  }
  return fallback;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, extractErrorMessage(body, res.statusText || "Request failed"));
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}

export { ApiError };
