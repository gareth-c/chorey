import path from "node:path";

export const env = {
  port: Number(process.env.PORT ?? 5152),
  dataDir: process.env.DATA_DIR ?? path.join(__dirname, "..", "..", "data"),
  sessionSecret: process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me",
  rpId: process.env.RP_ID ?? "localhost",
  rpName: process.env.RP_NAME ?? "Chorey",
  origin: process.env.ORIGIN ?? `http://localhost:${process.env.PORT ?? 5152}`,
};
