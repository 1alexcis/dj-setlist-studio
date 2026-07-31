import {
  BadgeCheck,
  Check,
  Cloud,
  Download,
  Gauge,
  KeyRound,
  ListMusic,
  Loader2,
  Music2,
  Radio,
  RefreshCw,
  Route,
  SlidersHorizontal,
  Timer,
  Wand2,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  CrowdContext,
  EnergyArc,
  Genre,
  HarmonicPolicy,
  SetlistPlan,
  SetlistRequest,
  TransitionModel,
  TransitionSpeed
} from "./types";
import { genres } from "./lib/demoCatalog";
import { djProfiles } from "./lib/djProfiles";
import { trainTransitionModel } from "./lib/features";
import { generateSetlist } from "./lib/optimizer";
import { defaultRequest, inferRequest, requestDisplayText } from "./lib/prompt";
import { secondsToClock } from "./lib/math";

interface ApiGenerateResponse {
  plan: SetlistPlan;
  model: TransitionModel;
}

interface SoundCloudStatus {
  configured: boolean;
  connected: boolean;
  expiresInSec: number | null;
}

const transitionSpeeds: TransitionSpeed[] = ["fast", "balanced", "long blends"];
const harmonicPolicies: HarmonicPolicy[] = ["strict", "guided", "adventurous"];
const energyArcs: EnergyArc[] = ["late peak", "steady climb", "waves", "warmup", "peak-time"];
const crowdContexts: CrowdContext[] = [
  "frat party",
  "club",
  "afterhours",
  "festival",
  "sunset",
  "warmup",
  "warehouse"
];

const initialModel = trainTransitionModel(defaultRequest);
const initialPlan = generateSetlist(defaultRequest, undefined, initialModel);

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function exportCsv(plan: SetlistPlan) {
  const rows = [
    [
      "position",
      "title",
      "artist",
      "genre",
      "bpm",
      "camelot",
      "start",
      "play_time",
      "energy",
      "transition_recipe",
      "transition_score",
      "soundcloud_id"
    ],
    ...plan.tracks.map((planned, index) => [
      String(index + 1),
      planned.track.title,
      planned.track.artist,
      planned.track.genre,
      String(planned.track.bpm),
      planned.track.camelot,
      secondsToClock(planned.startSec),
      secondsToClock(planned.playSec),
      planned.track.energy.toFixed(2),
      planned.transitionToNext?.recipe ?? "",
      planned.transitionToNext?.score.toFixed(3) ?? "",
      planned.track.soundcloudId ?? ""
    ])
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "dj-setlist-studio.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "hot" | "cool" | "warn" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function IconButton({
  children,
  onClick,
  title,
  disabled = false,
  primary = false
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title: string;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      className={`icon-button ${primary ? "icon-button-primary" : ""}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      type="button"
    >
      {children}
    </button>
  );
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange
}: {
  options: T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option}
          className={value === option ? "active" : ""}
          onClick={() => onChange(option)}
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function Waveform({ values, energy }: { values: number[]; energy: number }) {
  return (
    <div className="waveform" aria-label="energy waveform">
      {values.map((value, index) => (
        <span
          key={`${value}-${index}`}
          style={{
            height: `${22 + value * 54}%`,
            background: `linear-gradient(180deg, hsl(${185 - energy * 110}, 82%, 44%), hsl(${315 - energy * 120}, 70%, 52%))`
          }}
        />
      ))}
    </div>
  );
}

function EnergyRail({ plan }: { plan: SetlistPlan }) {
  return (
    <div className="energy-rail">
      {plan.tracks.map((planned) => (
        <div
          key={planned.track.id}
          className="energy-segment"
          style={{
            flexGrow: planned.playSec,
            background: `linear-gradient(90deg, hsl(${178 - planned.track.energy * 82}, 75%, 46%), hsl(${46 + planned.track.energy * 18}, 88%, 55%))`,
            opacity: 0.74 + planned.track.energy * 0.26
          }}
          title={`${planned.track.title}: ${percent(planned.track.energy)}`}
        />
      ))}
    </div>
  );
}

function FeatureBars({ transition }: { transition: NonNullable<SetlistPlan["tracks"][number]["transitionToNext"]> }) {
  const entries = Object.entries(transition.features);
  return (
    <div className="feature-grid">
      {entries.map(([name, value]) => (
        <div className="feature" key={name}>
          <span>{name}</span>
          <div>
            <i style={{ width: percent(value) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TrackTimeline({ plan }: { plan: SetlistPlan }) {
  return (
    <section className="timeline">
      <div className="timeline-top">
        <div>
          <p className="kicker">Optimized timeline</p>
          <h2>{plan.summary}</h2>
        </div>
        <div className="metric-row compact">
          <Metric icon={<Timer size={17} />} label="Duration" value={secondsToClock(plan.totalDurationSec)} />
          <Metric icon={<BadgeCheck size={17} />} label="Confidence" value={percent(plan.confidence)} />
        </div>
      </div>

      <EnergyRail plan={plan} />

      <div className="track-list">
        {plan.tracks.map((planned, index) => (
          <div className="track-stack" key={planned.track.id}>
            <article className="track-row">
              <div className="track-index">{String(index + 1).padStart(2, "0")}</div>
              <Waveform values={planned.track.waveform.slice(0, 18)} energy={planned.track.energy} />
              <div className="track-main">
                <div className="track-title-line">
                  <h3>{planned.track.title}</h3>
                  <Badge tone={planned.track.energy > 0.8 ? "hot" : planned.track.energy < 0.56 ? "cool" : "neutral"}>
                    {percent(planned.track.energy)}
                  </Badge>
                </div>
                <p>{planned.track.artist}</p>
                <div className="chip-row">
                  <Badge>{planned.track.genre}</Badge>
                  <Badge tone="cool">{planned.track.bpm} BPM</Badge>
                  <Badge tone="warn">{planned.track.camelot}</Badge>
                  <Badge>{secondsToClock(planned.playSec)}</Badge>
                </div>
              </div>
              <div className="track-stats">
                <span>{secondsToClock(planned.startSec)}</span>
                <small>fit {percent(planned.trackFit)}</small>
              </div>
            </article>

            {planned.transitionToNext ? (
              <div className="transition-row">
                <div className="transition-meta">
                  <Route size={16} />
                  <strong>{planned.transitionToNext.harmonicMove}</strong>
                  <span>{planned.transitionToNext.phraseBeats} beats</span>
                  <span>
                    {planned.transitionToNext.incomingPitchPct >= 0 ? "+" : ""}
                    {planned.transitionToNext.incomingPitchPct.toFixed(1)}%
                  </span>
                </div>
                <p>{planned.transitionToNext.recipe}</p>
                <FeatureBars transition={planned.transitionToNext} />
                <div className="transition-reasons">
                  {planned.transitionToNext.reasons.map((reason) => (
                    <Badge key={reason} tone="cool">
                      {reason}
                    </Badge>
                  ))}
                  {planned.transitionToNext.warnings.map((warning) => (
                    <Badge key={warning} tone="warn">
                      {warning}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      {icon}
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function ModelPanel({ model, plan }: { model: TransitionModel; plan: SetlistPlan }) {
  const weights = Object.entries(model.weights).sort(([, a], [, b]) => b - a);
  return (
    <section className="side-panel">
      <div className="panel-title">
        <SlidersHorizontal size={18} />
        <h2>Model</h2>
      </div>
      <div className="metric-grid">
        <Metric icon={<ListMusic size={17} />} label="Tracks" value={String(plan.tracks.length)} />
        <Metric icon={<Zap size={17} />} label="Switches" value={String(plan.tracks.filter((track) => track.transitionToNext && track.transitionToNext.features.genre < 1).length)} />
        <Metric icon={<KeyRound size={17} />} label="Key Policy" value={plan.request.harmonicPolicy} />
        <Metric icon={<Gauge size={17} />} label="Pairs" value={String(model.trainingPairs)} />
      </div>
      <div className="weights">
        {weights.map(([name, value]) => (
          <div className="weight-row" key={name}>
            <span>{name}</span>
            <div>
              <i style={{ width: `${Math.min(100, Math.max(8, value * 44))}%` }} />
            </div>
            <small>{value.toFixed(2)}</small>
          </div>
        ))}
      </div>
      <div className="note-list">
        {plan.optimizerNotes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>
    </section>
  );
}

function SoundCloudPanel({ plan }: { plan: SetlistPlan }) {
  const [status, setStatus] = useState<SoundCloudStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const soundCloudTrackIds = useMemo(
    () => plan.tracks.map((planned) => planned.track.soundcloudId).filter((id): id is string => Boolean(id)),
    [plan]
  );

  const refresh = async () => {
    try {
      const response = await fetch("/api/soundcloud/status", { credentials: "include" });
      setStatus((await response.json()) as SoundCloudStatus);
    } catch {
      setStatus({ configured: false, connected: false, expiresInSec: null });
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const connect = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/soundcloud/auth-url", { credentials: "include" });
      const data = (await response.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        setMessage(data.error ?? "SoundCloud connection failed");
      }
    } catch {
      setMessage("SoundCloud connection failed");
    } finally {
      setBusy(false);
    }
  };

  const createPlaylist = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/soundcloud/playlists", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `DJ Setlist Studio - ${plan.request.genres.join(" + ")}`,
          description: requestDisplayText(plan.request),
          trackIds: soundCloudTrackIds,
          sharing: "private"
        })
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Playlist creation failed");
        return;
      }
      setMessage(`Created: ${data.permalink_url ?? data.title ?? "SoundCloud playlist"}`);
    } catch {
      setMessage("Playlist creation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="side-panel">
      <div className="panel-title">
        <Cloud size={18} />
        <h2>SoundCloud</h2>
        <IconButton title="Refresh SoundCloud status" onClick={refresh}>
          <RefreshCw size={16} />
        </IconButton>
      </div>
      <div className="soundcloud-state">
        <Badge tone={status?.configured ? "cool" : "warn"}>
          {status?.configured ? "configured" : "env needed"}
        </Badge>
        <Badge tone={status?.connected ? "cool" : "neutral"}>
          {status?.connected ? "connected" : "not connected"}
        </Badge>
        <Badge>{soundCloudTrackIds.length} IDs</Badge>
      </div>
      <div className="button-row">
        <button className="action" type="button" onClick={connect} disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <Cloud size={16} />}
          Connect
        </button>
        <button
          className="action primary-action"
          type="button"
          onClick={createPlaylist}
          disabled={busy || !status?.connected || soundCloudTrackIds.length === 0}
        >
          <Music2 size={16} />
          Create Playlist
        </button>
      </div>
      {message ? <p className="panel-message">{message}</p> : null}
      <button className="action full" type="button" onClick={() => exportCsv(plan)}>
        <Download size={16} />
        Export CSV
      </button>
    </section>
  );
}

function PromptPanel({
  request,
  setRequest,
  onInfer,
  onGenerate,
  generating
}: {
  request: SetlistRequest;
  setRequest: (request: SetlistRequest) => void;
  onInfer: () => void;
  onGenerate: () => void;
  generating: boolean;
}) {
  return (
    <aside className="control-panel">
      <div className="brand">
        <div className="brand-mark">
          <Radio size={22} />
        </div>
        <div>
          <h1>DJ Setlist Studio</h1>
          <p>Sequence engine for EDM sets</p>
        </div>
      </div>

      <label className="field">
        <span>Brief</span>
        <textarea
          value={request.prompt}
          onChange={(event) => setRequest({ ...request, prompt: event.target.value })}
          rows={7}
        />
      </label>

      <div className="button-row">
        <button className="action" type="button" onClick={onInfer}>
          <Wand2 size={16} />
          Infer
        </button>
        <button className="action primary-action" type="button" onClick={onGenerate} disabled={generating}>
          {generating ? <Loader2 size={16} className="spin" /> : <Zap size={16} />}
          Generate
        </button>
      </div>

      <div className="field two-col">
        <label>
          <span>Minutes</span>
          <input
            type="number"
            min={20}
            max={180}
            value={request.durationMin}
            onChange={(event) =>
              setRequest({ ...request, durationMin: Math.max(20, Math.min(180, Number(event.target.value))) })
            }
          />
        </label>
        <label>
          <span>Tempo shift</span>
          <input
            type="number"
            min={2}
            max={12}
            value={request.maxTempoShiftPct}
            onChange={(event) =>
              setRequest({ ...request, maxTempoShiftPct: Math.max(2, Math.min(12, Number(event.target.value))) })
            }
          />
        </label>
      </div>

      <label className="field">
        <span>Transitions</span>
        <SegmentedControl
          options={transitionSpeeds}
          value={request.transitionSpeed}
          onChange={(transitionSpeed) => setRequest({ ...request, transitionSpeed })}
        />
      </label>

      <label className="field">
        <span>Camelot</span>
        <SegmentedControl
          options={harmonicPolicies}
          value={request.harmonicPolicy}
          onChange={(harmonicPolicy) => setRequest({ ...request, harmonicPolicy })}
        />
      </label>

      <label className="field">
        <span>Energy</span>
        <select
          value={request.energyArc}
          onChange={(event) => setRequest({ ...request, energyArc: event.target.value as EnergyArc })}
        >
          {energyArcs.map((arc) => (
            <option key={arc}>{arc}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Crowd</span>
        <select
          value={request.crowdContext}
          onChange={(event) => setRequest({ ...request, crowdContext: event.target.value as CrowdContext })}
        >
          {crowdContexts.map((context) => (
            <option key={context}>{context}</option>
          ))}
        </select>
      </label>

      <label className="toggle">
        <input
          type="checkbox"
          checked={request.allowGenreChanges}
          onChange={(event) => setRequest({ ...request, allowGenreChanges: event.target.checked })}
        />
        <span>Allow genre changes</span>
      </label>

      <div className="field">
        <span>Genres</span>
        <div className="pill-grid">
          {genres.map((genre) => {
            const selected = request.genres.includes(genre);
            return (
              <button
                key={genre}
                className={selected ? "pill selected" : "pill"}
                type="button"
                onClick={() => {
                  const next = toggleValue(request.genres, genre);
                  setRequest({ ...request, genres: next.length ? next : [genre] });
                }}
              >
                {selected ? <Check size={13} /> : null}
                {genre}
              </button>
            );
          })}
        </div>
      </div>

      <div className="field">
        <span>Similar DJs</span>
        <div className="pill-grid">
          {djProfiles.map((profile) => {
            const selected = request.similarDjs.includes(profile.id);
            return (
              <button
                key={profile.id}
                className={selected ? "pill selected" : "pill"}
                type="button"
                title={profile.setNotes}
                onClick={() => setRequest({ ...request, similarDjs: toggleValue(request.similarDjs, profile.id) })}
              >
                {selected ? <Check size={13} /> : null}
                {profile.name}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

export default function App() {
  const [request, setRequest] = useState<SetlistRequest>(defaultRequest);
  const [plan, setPlan] = useState<SetlistPlan>(initialPlan);
  const [model, setModel] = useState<TransitionModel>(initialModel);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("soundcloud")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const infer = async () => {
    try {
      const response = await fetch("/api/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: request.prompt, previous: request })
      });
      const data = (await response.json()) as { request: SetlistRequest };
      setRequest(data.request);
    } catch {
      setRequest(inferRequest(request.prompt, request));
    }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request })
      });
      const data = (await response.json()) as ApiGenerateResponse;
      setPlan(data.plan);
      setModel(data.model);
    } catch {
      const localModel = trainTransitionModel(request);
      setModel(localModel);
      setPlan(generateSetlist(request, undefined, localModel));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="app-shell">
      <PromptPanel
        request={request}
        setRequest={setRequest}
        onInfer={infer}
        onGenerate={generate}
        generating={generating}
      />
      <main className="main-stage">
        <div className="summary-band">
          <Metric icon={<Music2 size={17} />} label="Brief" value={requestDisplayText(plan.request)} />
          <Metric icon={<Timer size={17} />} label="Total" value={secondsToClock(plan.totalDurationSec)} />
          <Metric icon={<KeyRound size={17} />} label="Average Key Fit" value={percent(plan.tracks.reduce((sum, track) => sum + (track.transitionToNext?.features.harmonic ?? 0.86), 0) / plan.tracks.length)} />
          <IconButton title="Regenerate setlist" onClick={generate} primary disabled={generating}>
            {generating ? <Loader2 size={17} className="spin" /> : <RefreshCw size={17} />}
          </IconButton>
        </div>
        <TrackTimeline plan={plan} />
      </main>
      <aside className="right-rail">
        <ModelPanel model={model} plan={plan} />
        <SoundCloudPanel plan={plan} />
      </aside>
    </div>
  );
}
