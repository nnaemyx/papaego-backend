import app from "./app";
import { startJobs } from "./jobs/tradeExpiration.job";

const PORT = process.env.PORT || 5000;

startJobs();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
