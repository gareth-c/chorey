import { runMigrations } from "./db/migrate";
import { createApp } from "./app";
import { env } from "./env";

runMigrations();
const app = createApp();

app.listen(env.port, () => {
  console.log(`Chorey server listening on port ${env.port}`);
});
