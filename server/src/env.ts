import path from "node:path";

export const env = {
  port: Number(process.env.PORT ?? 5152),
  dataDir: process.env.DATA_DIR ?? path.join(__dirname, "..", "..", "data"),
  sessionSecret: process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me",
  // Number of reverse-proxy hops in front of the app (Express "trust proxy").
  // The documented production setup is one HTTPS proxy, so default 1; set 0
  // only if clients connect to the Node process directly.
  trustProxy: Number(process.env.TRUST_PROXY ?? 1),
  rpId: process.env.RP_ID ?? "localhost",
  rpName: process.env.RP_NAME ?? "Chorey",
  origin: process.env.ORIGIN ?? `http://localhost:${process.env.PORT ?? 5152}`,
};
