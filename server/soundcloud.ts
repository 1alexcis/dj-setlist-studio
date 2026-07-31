import crypto from "node:crypto";
import type { Request, Response, Router } from "express";
import express from "express";
import type { SoundCloudPlaylistPayload } from "../src/types";

interface SoundCloudToken {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  created_at: number;
}

const AUTH_URL = "https://secure.soundcloud.com/authorize";
const TOKEN_URL = "https://secure.soundcloud.com/oauth/token";
const API_URL = "https://api.soundcloud.com";

const pendingStates = new Map<string, string>();
const sessionTokens = new Map<string, SoundCloudToken>();

function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function codeChallenge(verifier: string): string {
  return base64Url(crypto.createHash("sha256").update(verifier).digest());
}

function config() {
  return {
    clientId: process.env.SOUNDCLOUD_CLIENT_ID,
    clientSecret: process.env.SOUNDCLOUD_CLIENT_SECRET,
    redirectUri:
      process.env.SOUNDCLOUD_REDIRECT_URI ?? "http://localhost:8787/api/soundcloud/callback",
    frontendRedirect: process.env.SOUNDCLOUD_FRONTEND_REDIRECT ?? "http://localhost:5173"
  };
}

function getSessionId(req: Request, res: Response): string {
  const existing = req.cookies?.sc_session;
  if (typeof existing === "string" && existing.length > 8) return existing;
  const sessionId = crypto.randomUUID();
  res.cookie("sc_session", sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 6
  });
  return sessionId;
}

function requireToken(req: Request, res: Response): SoundCloudToken | undefined {
  const sessionId = getSessionId(req, res);
  const token = sessionTokens.get(sessionId);
  if (!token) {
    res.status(401).json({
      error: "SoundCloud is not connected",
      hint: "Connect with /api/soundcloud/auth-url first."
    });
    return undefined;
  }
  return token;
}

async function exchangeCodeForToken(code: string, verifier: string): Promise<SoundCloudToken> {
  const { clientId, clientSecret, redirectUri } = config();
  if (!clientId || !clientSecret) {
    throw new Error("Missing SOUNDCLOUD_CLIENT_ID or SOUNDCLOUD_CLIENT_SECRET");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SoundCloud token exchange failed: ${response.status} ${text}`);
  }

  const token = (await response.json()) as Omit<SoundCloudToken, "created_at">;
  return { ...token, created_at: Date.now() };
}

async function soundCloudFetch(path: string, token: SoundCloudToken, init: RequestInit = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json; charset=utf-8",
      Authorization: `OAuth ${token.access_token}`,
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SoundCloud API failed: ${response.status} ${text}`);
  }

  return response.json();
}

export function soundCloudRouter(): Router {
  const router = express.Router();

  router.get("/status", (req, res) => {
    const { clientId } = config();
    const sessionId = getSessionId(req, res);
    const token = sessionTokens.get(sessionId);
    res.json({
      configured: Boolean(clientId),
      connected: Boolean(token),
      expiresInSec: token?.expires_in
        ? Math.max(0, Math.round(token.expires_in - (Date.now() - token.created_at) / 1000))
        : null
    });
  });

  router.get("/auth-url", (_req, res) => {
    const { clientId, redirectUri } = config();
    if (!clientId) {
      res.status(400).json({
        error: "Missing SOUNDCLOUD_CLIENT_ID",
        hint: "Copy .env.example to .env and register the redirect URI with SoundCloud."
      });
      return;
    }

    const verifier = base64Url(crypto.randomBytes(48));
    const state = crypto.randomUUID();
    pendingStates.set(state, verifier);

    const url = new URL(AUTH_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("code_challenge", codeChallenge(verifier));
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);

    res.json({ url: url.toString() });
  });

  router.get("/callback", async (req, res) => {
    const { code, state, error } = req.query;
    const { frontendRedirect } = config();

    if (error) {
      res.redirect(`${frontendRedirect}?soundcloud=error&message=${encodeURIComponent(String(error))}`);
      return;
    }

    if (typeof code !== "string" || typeof state !== "string") {
      res.redirect(`${frontendRedirect}?soundcloud=error&message=Missing%20code%20or%20state`);
      return;
    }

    const verifier = pendingStates.get(state);
    pendingStates.delete(state);

    if (!verifier) {
      res.redirect(`${frontendRedirect}?soundcloud=error&message=Expired%20SoundCloud%20state`);
      return;
    }

    try {
      const token = await exchangeCodeForToken(code, verifier);
      const sessionId = getSessionId(req, res);
      sessionTokens.set(sessionId, token);
      res.redirect(`${frontendRedirect}?soundcloud=connected`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "SoundCloud OAuth failed";
      res.redirect(`${frontendRedirect}?soundcloud=error&message=${encodeURIComponent(message)}`);
    }
  });

  router.get("/search", async (req, res) => {
    const token = requireToken(req, res);
    if (!token) return;
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const limit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 10;
    try {
      const params = new URLSearchParams({
        q: query,
        limit: String(Number.isFinite(limit) ? Math.min(50, Math.max(1, limit)) : 10),
        linked_partitioning: "true"
      });
      const data = await soundCloudFetch(`/tracks?${params.toString()}`, token);
      res.json(data);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "SoundCloud search failed";
      res.status(502).json({ error: message });
    }
  });

  router.post("/playlists", express.json(), async (req, res) => {
    const token = requireToken(req, res);
    if (!token) return;
    const payload = req.body as SoundCloudPlaylistPayload;
    if (!payload.title || !Array.isArray(payload.trackIds) || payload.trackIds.length === 0) {
      res.status(400).json({ error: "title and trackIds are required" });
      return;
    }

    try {
      const data = await soundCloudFetch("/playlists", token, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          playlist: {
            title: payload.title,
            description: payload.description,
            sharing: payload.sharing,
            tracks: payload.trackIds.map((id) => ({ id }))
          }
        })
      });
      res.json(data);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "SoundCloud playlist creation failed";
      res.status(502).json({ error: message });
    }
  });

  return router;
}
