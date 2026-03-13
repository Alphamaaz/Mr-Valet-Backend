import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { rateLimit } from "express-rate-limit";
import routes from "./routes/index.js";
import { errorHandler } from "./middleware/errorHandler.js";


export function createApp() {
  const app = express();
  const rawBodySaver = (req, _res, buf) => {
    if (buf?.length) {
      req.rawBody = buf.toString("utf8");
    }
  };
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.API_RATE_LIMIT_MAX || 500),
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ verify: rawBodySaver }));
  app.use(express.urlencoded({ extended: true, verify: rawBodySaver }));
  app.use(morgan("dev"));
  app.use("/public", express.static(path.join(process.cwd(), "public")));

  
  

  app.use("/api", apiLimiter, routes);
  app.use((_, res) => res.status(404).json({ message: "Not found" }));
  app.use(errorHandler);

  return app;
}
