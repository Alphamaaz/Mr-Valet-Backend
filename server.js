import dotenv from "dotenv";
import { createApp } from "./app.js";
import { connectDatabase } from "./utils/database.js";

dotenv.config();

const PORT = Number(process.env.PORT || 5000);
const app = createApp();

async function startServer() {
  try {
    await connectDatabase();
    app.listen(PORT, () => {
      console.log(`[MrValet] API listening on port ${PORT}`);
    });
  } catch (error) {
    console.error("[MrValet] Failed to start server", error);
    process.exit(1);
  }
}

startServer();
