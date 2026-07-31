import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { demoCatalog } from "../src/lib/demoCatalog";
import { djProfiles } from "../src/lib/djProfiles";
import { trainTransitionModel } from "../src/lib/features";
import { generateSetlist } from "../src/lib/optimizer";
import { defaultRequest, inferRequest } from "../src/lib/prompt";
import type { SetlistRequest } from "../src/types";
import { soundCloudRouter } from "./soundcloud";

dotenv.config();

const app = express();
const port = Number.parseInt(process.env.PORT ?? "8787", 10);

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.SOUNDCLOUD_FRONTEND_REDIRECT ?? "http://localhost:5173",
    credentials: true
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/catalog", (_req, res) => {
  res.json({ tracks: demoCatalog });
});

app.get("/api/dj-profiles", (_req, res) => {
  res.json({ profiles: djProfiles });
});

app.post("/api/infer", (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : defaultRequest.prompt;
  const previous = req.body?.previous as SetlistRequest | undefined;
  res.json({ request: inferRequest(prompt, previous ?? defaultRequest) });
});

app.post("/api/generate", (req, res) => {
  const request = {
    ...defaultRequest,
    ...(req.body?.request ?? {}),
    prompt: req.body?.request?.prompt ?? defaultRequest.prompt
  } as SetlistRequest;
  const model = trainTransitionModel(request, demoCatalog);
  const plan = generateSetlist(request, demoCatalog, model);
  res.json({ plan, model });
});

app.use("/api/soundcloud", soundCloudRouter());

app.listen(port, () => {
  console.log(`DJ Setlist Studio API listening at http://localhost:${port}`);
});
