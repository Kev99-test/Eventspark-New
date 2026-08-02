import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Flame, Users, Calendar, Plus, Check, MapPin, X, Sparkles, LogOut, Trash2 } from "lucide-react";
import { supabase } from "./lib/supabaseClient";


const INK = "#16171A";
const SURFACE = "#1F2124";
const SURFACE_2 = "#282A2E";
const BORDER = "#35373C";
const TEXT = "#F3F0E8";
const TEXT_DIM = "#9A988E";
const EMBER = "#E8871E";
const EMBER_LIGHT = "#FFB05C";
const TEAL = "#3FA796";
const REWARD_TIERS = [3, 6, 10];

function fmtGCalDate(dateStr, timeStr, durationMins = 60) {
  const start = new Date(`${dateStr}T${timeStr}`);
  const end = new Date(start.getTime() + durationMins * 60000);
  const pad = (n) => String(n).padStart(2, "0");
  const toUtc = (d) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(
      d.getUTCHours()
    )}${pad(d.getUTCMinutes())}00Z`;
  return `${toUtc(start)}/${toUtc(end)}`;
}

function buildGCalUrl(event) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: fmtGCalDate(event.event_date, event.event_time),
    details: `${event.description}\n\nHosted by ${event.host_name} on EventSpark.`,
    location: event.location || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export default function EventSpark() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [events, setEvents] = useState([]);
  const [log, setLog] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    date: "",
    time: "",
    location: "",
    capacity: 10,
  });

  // --- Auth -----------------------------------------------------------
  useEffect(() => {
  let active = true;

  const restoreSession = async () => {
    const code = new URLSearchParams(window.location.search).get("code");

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) console.error("OAuth session exchange failed:", error);
      window.history.replaceState({}, "", window.location.pathname);
    }

    const { data } = await supabase.auth.getSession();
    if (active) setSession(data.session);
  };

  restoreSession();

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, currentSession) => {
    if (active) setSession(currentSession);
  });

  return () => {
    active = false;
    subscription.unsubscribe();
  };
}, []);
  
  
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = () =>
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  const signOut = () => supabase.auth.signOut();

  // --- Data loading -----------------------------------------------------------
  const loadProfile = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
    setProfile(data);
  }, [session]);

  const loadEvents = useCallback(async () => {
    const { data } = await supabase
      .from("events")
      .select(
        "id, title, description, event_date, event_time, location, capacity, initiator_id, host:profiles!initiator_id(name), participants(user_id)"
      )
      .order("event_date", { ascending: true });
    if (data) {
      setEvents(
        data.map((e) => ({
          ...e,
          host_name: e.host?.name || "someone",
          attendee_ids: (e.participants || []).map((p) => p.user_id),
        }))
      );
    }
  }, []);

  const loadLog = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase
      .from("reward_log")
      .select("id, amount, reason, created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(6);
    setLog(data || []);
  }, [session]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (!session) return;
    loadProfile();
    loadLog();

    // Live updates: refresh sparks + log whenever a reward lands for this user
    const channel = supabase
      .channel("reward-log-changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reward_log", filter: `user_id=eq.${session.user.id}` },
        () => {
          loadProfile();
          loadLog();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "participants" },
        () => loadEvents()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events" },
        () => loadEvents()
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [session, loadProfile, loadLog, loadEvents]);

  // --- Actions -----------------------------------------------------------
  const handleCreate = async (e) => {
  e.preventDefault();

  if (!form.title.trim() || !form.date || !form.time) {
    alert("Please enter a title, date, and time.");
    return;
  }

  if (!form.title.trim() || !form.date || !form.time) {
    alert("Please enter a title, date, and time.");
    return;
  }

  if (!session) {
    alert("Please sign in first.");
    return;
  }

  const { error } = await supabase.from("events").insert({
    title: form.title.trim(),
    description: form.description.trim(),
    event_date: form.date,
    event_time: form.time,
    location: form.location.trim(),
    capacity: Number(form.capacity) || 10,
    initiator_id: session.user.id,
  });

  if (error) {
    console.error(error);
    alert(`Could not create event: ${error.message}`);
    return;
  }

  setForm({
    title: "",
    description: "",
    date: "",
    time: "",
    location: "",
    capacity: 10,
  });
  setShowForm(false);
  loadEvents();
};

  const handleJoin = async (eventId) => {
    if (!session) return;
    const { error } = await supabase
      .from("participants")
      .insert({ event_id: eventId, user_id: session.user.id });
    if (error) {
      console.error(error);
      alert(`Could not join: ${error.message}`);
      return;
    }
    loadEvents();
  };

  const handleLeave = async (eventId) => {
    if (!session) return;
    const { error } = await supabase
      .from("participants")
      .delete()
      .eq("event_id", eventId)
      .eq("user_id", session.user.id);
    if (error) {
      console.error(error);
      alert(`Could not leave event: ${error.message}`);
      return;
    }
    loadEvents();
  };

  const handleDelete = async (event) => {
    if (!window.confirm(`Delete "${event.title}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("events").delete().eq("id", event.id);
    if (error) {
      alert(`Could not delete event: ${error.message}`);
      return;
    }
    loadEvents();
  };

  const sorted = useMemo(
    () => [...events].sort((a, b) => new Date(`${a.event_date}T${a.event_time}`) - new Date(`${b.event_date}T${b.event_time}`)),
    [events]
  );

  if (!session) {
    return (
      <div style={{ background: INK, color: TEXT, minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <div style={{ textAlign: "center" }}>
          <Flame size={32} color={EMBER} style={{ marginBottom: 12 }} />
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>EventSpark</h1>
          <p style={{ color: TEXT_DIM, fontSize: 13.5, marginBottom: 20 }}>Sign in to start or join events.</p>
          <button
            onClick={signIn}
            style={{ background: EMBER, color: INK, border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: INK, color: TEXT, fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif", minHeight: "100%", padding: "28px 20px 48px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: `linear-gradient(155deg, ${EMBER_LIGHT}, ${EMBER})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Flame size={18} color={INK} strokeWidth={2.5} />
            </div>
            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>EventSpark</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 999, padding: "6px 14px 6px 10px" }}>
              <Sparkles size={15} color={EMBER_LIGHT} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>{profile?.sparks ?? 0}</span>
              <span style={{ fontSize: 12, color: TEXT_DIM }}>sparks</span>
            </div>
            <button onClick={signOut} title="Sign out" style={{ background: "none", border: "none", color: TEXT_DIM, cursor: "pointer" }}>
              <LogOut size={17} />
            </button>
          </div>
        </div>

        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: EMBER, color: INK, border: "none", borderRadius: 12, padding: "13px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 26 }}
          >
            <Plus size={17} strokeWidth={2.5} />
            Start an event, earn sparks
          </button>
        ) : (
          <form onSubmit={handleCreate} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18, marginBottom: 26 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>New event</span>
              <button type="button" onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: TEXT_DIM }}>
                <X size={18} />
              </button>
            </div>
            <Field label="Title">
              <input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Sunset picnic at the pier" style={inputStyle} />
            </Field>
            <Field label="Description">
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What should people expect?" rows={2} style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
            </Field>
            <div style={{ display: "flex", gap: 10 }}>
              <Field label="Date" style={{ flex: 1 }}>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={inputStyle} />
              </Field>
              <Field label="Time" style={{ flex: 1 }}>
                <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} style={inputStyle} />
              </Field>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <Field label="Location" style={{ flex: 2 }}>
                <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Optional" style={inputStyle} />
              </Field>
              <Field label="Capacity" style={{ flex: 1 }}>
                <input type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} style={inputStyle} />
              </Field>
            </div>
            <button type="submit" style={{ width: "100%", background: EMBER, color: INK, border: "none", borderRadius: 10, padding: "11px", fontWeight: 700, fontSize: 14, cursor: "pointer", marginTop: 6 }}>
              Create event · +10 sparks
            </button>
          </form>
        )}

        <div style={{ fontSize: 12.5, color: TEXT_DIM, marginBottom: 22, lineHeight: 1.6 }}>
          Hosts earn 10 sparks on creation, plus 15 more each time attendance passes {REWARD_TIERS.join(", ")}. Rewards are paid out server-side, so they can't be gamed from the app.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {sorted.map((event) => {
            const pct = Math.min(100, (event.attendee_ids.length / event.capacity) * 100);
            const youJoined = event.attendee_ids.includes(session.user.id);
            const youHost = event.initiator_id === session.user.id;
            const full = event.attendee_ids.length >= event.capacity;
            const nextTier = REWARD_TIERS.find((t) => t > event.attendee_ids.length);

            return (
              <div key={event.id} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 3 }}>{event.title}</div>
                    <div style={{ fontSize: 13, color: TEXT_DIM, marginBottom: 8 }}>hosted by {youHost ? "you" : event.host_name}</div>
                  </div>
                  {youHost && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: EMBER_LIGHT, background: "rgba(232,135,30,0.12)", border: `1px solid rgba(232,135,30,0.3)`, borderRadius: 999, padding: "3px 9px", height: "fit-content", whiteSpace: "nowrap" }}>
                      your event
                    </span>
                  )}
                </div>

                {event.description && <p style={{ fontSize: 13.5, color: "#C9C7BD", margin: "0 0 12px", lineHeight: 1.5 }}>{event.description}</p>}

                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 12.5, color: TEXT_DIM, marginBottom: 12 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <Calendar size={13} />
                    {formatDate(event.event_date)} · {formatTime(event.event_time)}
                  </span>
                  {event.location && (
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <MapPin size={13} />
                      {event.location}
                    </span>
                  )}
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: TEXT_DIM, marginBottom: 5 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <Users size={12} />
                      {event.attendee_ids.length}/{event.capacity} joined
                    </span>
                    {youHost && nextTier && <span>next reward at {nextTier}</span>}
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: SURFACE_2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${EMBER}, ${EMBER_LIGHT})`, transition: "width 0.4s ease" }} />
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => (youJoined ? handleLeave(event.id) : handleJoin(event.id))}
                    disabled={!youJoined && full}
                    title={youJoined ? "Click to leave this event" : undefined}
                    style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px", borderRadius: 9, fontSize: 13.5, fontWeight: 600, cursor: !youJoined && full ? "default" : "pointer", border: `1px solid ${youJoined ? TEAL : BORDER}`, background: youJoined ? "rgba(63,167,150,0.12)" : "transparent", color: youJoined ? TEAL : full ? TEXT_DIM : TEXT }}
                  >
                    {youJoined ? (<><Check size={14} /> Joined (leave)</>) : full ? "Full" : "Join event"}
                  </button>
                  <a
                    href={buildGCalUrl(event)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px", borderRadius: 9, fontSize: 13.5, fontWeight: 600, textDecoration: "none", border: `1px solid ${BORDER}`, color: TEXT }}
                  >
                    <Calendar size={14} />
                    Add to calendar
                  </a>
                  {youHost && (
                    <button
                      onClick={() => handleDelete(event)}
                      title="Delete event"
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "9px", borderRadius: 9, border: `1px solid ${BORDER}`, background: "transparent", color: TEXT_DIM, cursor: "pointer", flex: "0 0 auto" }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 30 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT_DIM, marginBottom: 10, letterSpacing: "0.02em" }}>RECENT ACTIVITY</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {log.length === 0 && <div style={{ fontSize: 13, color: TEXT_DIM }}>No rewards yet — start or fill up an event to earn sparks.</div>}
            {log.map((entry) => (
              <div key={entry.id} style={{ fontSize: 13, color: "#C9C7BD", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: EMBER, flexShrink: 0 }} />
                Earned {entry.amount} sparks — {entry.reason}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      <label style={{ display: "block", fontSize: 12, color: TEXT_DIM, marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  background: SURFACE_2,
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  padding: "9px 11px",
  color: TEXT,
  fontSize: 13.5,
  outline: "none",
};

function formatDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function formatTime(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
