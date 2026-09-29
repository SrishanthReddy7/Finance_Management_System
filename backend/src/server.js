import { app } from "./app.js";
import { env } from "./config/env.js";
import { startOverdueSweep } from "./jobs/overdueSweep.js";

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Finance Management System API running on port ${env.port} [${env.nodeEnv}]`);
  startOverdueSweep();
});
