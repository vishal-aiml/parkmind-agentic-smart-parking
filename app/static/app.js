const $ = (id) => document.getElementById(id);
const chat = $("chat");
const trace = $("trace");
const routeStrip = $("route-strip");
const requestState = $("request-state");

// Frontend build marker. If the browser loads an older cached bundle, this
// becomes immediately visible in the trace instead of failing silently.
const UI_BUILD = "20261002-19";

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]));

const ICONS = {
  car:`<svg viewBox="0 0 24 24"><path d="M5 17h14l-1-6.2a2 2 0 0 0-2-1.8H8a2 2 0 0 0-2 1.8L5 17Z"/><path d="M7.5 9 9 5.5h6L16.5 9M5 13H3.5M20.5 13H19"/><circle cx="7" cy="16.5" r="1"/><circle cx="17" cy="16.5" r="1"/></svg>`,
  brain:`<svg viewBox="0 0 24 24"><path d="M9 4.8A3.8 3.8 0 0 0 5.8 8a3.4 3.4 0 0 0 .3 7 3.8 3.8 0 0 0 6.9 2.1A3.8 3.8 0 0 0 20 15a3.4 3.4 0 0 0 .2-7A3.8 3.8 0 0 0 16.8 4.8 3.7 3.7 0 0 0 13 6.2 3.7 3.7 0 0 0 9 4.8Z"/><path d="M12 6v12M8.1 10.5H11M13 10h3M8.8 14H11M13 15h2.6"/></svg>`,
  route:`<svg viewBox="0 0 24 24"><path d="M6 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM18 15a2 2 0 1 0 0 4 2 2 0 0 0-4 0ZM7.2 8.5c1.5 3.8 2.5 4.7 5.4 4.7 2.1 0 3.6.4 4.4 1.8"/><path d="m15.5 14.5 1.5 0 0 1.5"/></svg>`,
  database:`<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5.5" rx="7" ry="3"/><path d="M5 5.5v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6M5 11.5v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>`,
  chart:`<svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16"/><path d="m7 15 3.2-3.5 2.5 2 4.3-6"/><path d="M17 7h2v2"/></svg>`,
  shield:`<svg viewBox="0 0 24 24"><path d="M12 3 19 6v5c0 4.4-2.7 8-7 10-4.3-2-7-5.6-7-10V6l7-3Z"/><path d="m8.7 12 2.1 2.1 4.5-4.6"/></svg>`,
  spark:`<svg viewBox="0 0 24 24"><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z"/><path d="M19 16v6M16 19h6M5 15v4M3 17h4"/></svg>`,
  eye:`<svg viewBox="0 0 24 24"><path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>`,
  bolt:`<svg viewBox="0 0 24 24"><path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z"/></svg>`,
  signal:`<svg viewBox="0 0 24 24"><path d="M5 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM9 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM13 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM17 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM8 15c2-2 6-2 8 0M6 11c3-3 9-3 12 0M4 7c4-4 12-4 16 0"/></svg>`
};
const iconSvg = name => ICONS[name] || ICONS.spark;

function addMessage(text, role) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.innerHTML = escapeHtml(text);
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}

function addTrace(agent, message, system = false) {
  const el = document.createElement("div");
  el.className = `trace-item${system ? " system" : ""}`;
  el.innerHTML = `<span class="agent">${escapeHtml(agent)}</span><span class="body">${escapeHtml(message)}</span>`;
  trace.prepend(el);
  trace.scrollTop = 0;
}

function setAgent(agent, state) {
  document.querySelectorAll(`[data-agent="${agent}"], [data-detail-key="${agent}"]`).forEach(el => {
    el.classList.remove("active", "done");
    if (state === "active") el.classList.add("active");
    if (state === "done") el.classList.add("done");
  });
}

function resetAgentStates() {
  document.querySelectorAll("[data-agent], [data-detail-key]").forEach(el => el.classList.remove("active", "done"));
}

let currentSnapshot = null;
let selectedFloor = null;

function render(snapshot) {
  currentSnapshot = snapshot;
  $("total").textContent = snapshot.total;
  $("available").textContent = snapshot.available;
  $("occupied").textContent = snapshot.occupied;
  $("occupancy").textContent = `${snapshot.occupancy_pct}%`;
  $("updated").textContent = `Updated ${new Date(snapshot.updated_at).toLocaleTimeString()}`;
  $("lot-name").textContent = snapshot.lot_name;
  const grid = $("spot-grid");
  grid.innerHTML = "";
  const visibleSpots = selectedFloor ? snapshot.spots.filter(spot => spot.zone === selectedFloor) : snapshot.spots;
  const changedMap = new Map((snapshot.changed_spots || []).map(item => [item.spot_id, item]));
  visibleSpots.forEach(spot => {
    const el = document.createElement("div");
    const liveChange = changedMap.get(spot.spot_id);
    el.className = `spot ${spot.status}${liveChange ? " live-changed" : ""}`;
    el.dataset.spotId = spot.spot_id;
    el.dataset.detailKey = `spot-${spot.spot_id}`;
    el.dataset.spotType = spot.spot_type;
    el.dataset.distance = `${Math.round(spot.distance_to_entrance_m)}m from gate`;
    if (liveChange) {
      el.dataset.liveFrom = liveChange.from;
      el.dataset.liveTo = liveChange.to;
      el.title = `Live update: ${liveChange.from} → ${liveChange.to}`;
    }
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    const statusLabel = spot.status === "maintenance" ? "MAINTENANCE" : spot.status.toUpperCase();
    const typeLabel = spot.spot_type === "ev" ? "EV CHARGING" : spot.spot_type === "accessible" ? "ACCESSIBLE" : "STANDARD";
    el.innerHTML = `<div class="spot-icon-panel"><span class="spot-car">${iconSvg("car")}</span></div><div class="spot-main"><div class="spot-id-row"><b>${escapeHtml(spot.spot_id)}</b><span class="spot-type-pill">${typeLabel}</span></div><div class="spot-meta"><span>${Math.round(spot.distance_to_entrance_m)}m from gate</span><span>Floor ${escapeHtml(spot.zone)}</span></div><div class="spot-status-label">${statusLabel}</div></div>${liveChange ? '<em class="spot-live-badge">LIVE UPDATE</em>' : ''}`;
    grid.appendChild(el);
  });
}


function money(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {maximumFractionDigits: 0})}`;
}

function renderLineChart(targetId, series, valueKeys, labels) {
  const host = $(targetId);
  if (!host || !series?.length) return;
  const width = 720, height = 230, left = 42, right = 18, top = 22, bottom = 34;
  const plotW = width - left - right, plotH = height - top - bottom;
  const values = valueKeys.flatMap(k => series.map(p => Number(p[k] || 0)));
  const maxValue = Math.max(1, ...values) * 1.15;
  const x = i => left + (series.length === 1 ? 0 : i * plotW / (series.length - 1));
  const y = v => top + plotH - (v / maxValue) * plotH;
  const pointsFor = key => series.map((p, i) => `${x(i).toFixed(1)},${y(Number(p[key] || 0)).toFixed(1)}`).join(" ");
  const grids = [0, .25, .5, .75, 1].map(r => {
    const yy = top + plotH * r;
    const label = Math.round(maxValue * (1-r));
    return `<line x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}" class="chart-grid-line"/><text x="6" y="${yy+3}" class="chart-axis-label">${label > 999 ? `${Math.round(label/1000)}k` : label}</text>`;
  }).join("");
  const xLabels = [0, Math.floor(series.length/2), series.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(i => `<text x="${x(i)}" y="${height-8}" text-anchor="middle" class="chart-axis-label">${escapeHtml(series[i].label || "")}</text>`).join("");
  const lines = valueKeys.map((key, idx) => `<polyline points="${pointsFor(key)}" class="chart-line chart-line-${idx}"/>`).join("");
  const circles = valueKeys.map((key, idx) => series.map((p,i)=>`<circle cx="${x(i)}" cy="${y(Number(p[key]||0))}" r="2.7" class="chart-point chart-line-${idx}"/>`).join("")).join("");
  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(labels.join(" versus "))}">${grids}${xLabels}${lines}${circles}</svg>`;
}

function renderOperations(data) {
  if (!data) return;
  const entriesText = Number(data.entries_today || 0).toLocaleString("en-IN");
  const exitsText = Number(data.exits_today || 0).toLocaleString("en-IN");
  const feesText = money(data.fees_today);
  const dueText = money(data.due_today);
  $("entries-today").textContent = entriesText;
  $("exits-today").textContent = exitsText;
  $("fees-today").textContent = feesText;
  $("due-today").textContent = dueText;
  if ($("entries-today-top")) $("entries-today-top").textContent = entriesText;
  if ($("exits-today-top")) $("exits-today-top").textContent = exitsText;
  if ($("fees-today-top")) $("fees-today-top").textContent = feesText;
  if ($("due-today-top")) $("due-today-top").textContent = dueText;
  $("avg-stay").textContent = `${Math.round(data.avg_stay_minutes || 0)} min`;
  $("net-flow").textContent = `${data.net_entries >= 0 ? "+" : ""}${Number(data.net_entries || 0).toLocaleString("en-IN")}`;
  $("entries-interval").textContent = `+${data.last_interval?.entries || 0}`;
  $("exits-interval").textContent = `+${data.last_interval?.exits || 0}`;
  $("revenue-state").textContent = `Updated ${new Date(data.updated_at).toLocaleTimeString()}`;
  const series = data.series || [];
  renderLineChart("flow-chart", series, ["entries", "exits"], ["Entries", "Exits"]);
  renderLineChart("money-chart", series, ["fees", "due"], ["Fees", "Due charges"]);
  const feed = $("activity-feed");
  if (feed) {
    feed.innerHTML = (data.activities || []).slice(0, 10).map(item => {
      const cls = item.icon === "due" ? "alert" : item.icon === "payment" ? "payment" : item.icon === "departure" ? "exit" : "entry";
      const activityIcon = item.icon === "due" ? "shield" : item.icon === "payment" ? "chart" : item.icon === "departure" ? "route" : item.kind === "EV" ? "bolt" : item.kind === "RESERVATION" ? "shield" : "car";
      return `<div class="activity-item ${cls}"><div class="activity-badge"><span class="activity-icon">${iconSvg(activityIcon)}</span>${escapeHtml(item.kind)}</div><div class="activity-main"><b>${escapeHtml(item.message)}</b><span>${escapeHtml(item.location)} · ${escapeHtml(item.label)}</span></div><span class="activity-arrow">↗</span></div>`;
    }).join("") || `<div class="activity-empty">Waiting for parking events…</div>`;
    $("activity-count").textContent = `${(data.activities || []).length} events`;
  }
}

async function loadOperations() {
  try {
    renderOperations(await fetch("/api/operations/metrics").then(r => r.json()));
  } catch (e) {
    addTrace("system", "Operations telemetry unavailable", true);
  }
}

async function loadHealth() {
  try {
    const health = await fetch("/health").then(r => r.json());
    $("mode-pill").textContent = health.openai_enabled ? "OPENAI AI MODE" : "DEMO AI MODE";
    $("mode-pill").title = health.openai_enabled ? "OpenAI is connected. Responses are model-generated." : "No OPENAI_API_KEY detected. The full agent workflow still runs with deterministic demo answers.";
    addTrace("system", health.openai_enabled ? "OpenAI services enabled" : "Running with local deterministic fallbacks", true);
  } catch (e) {
    addTrace("system", "Health endpoint unavailable", true);
  }
}

async function loadStatus() {
  try { render(await fetch("/api/parking/status").then(r => r.json())); }
  catch (e) { addTrace("system", "Parking API unavailable", true); }
}

let liveSocket = null;
let liveReconnectTimer = null;
let livePollingTimer = null;
let liveState = "connecting";

function setLiveState(state, message) {
  liveState = state;
  document.querySelectorAll(".live-pill, .chart-live, .live-mini").forEach(el => {
    el.classList.toggle("is-offline", state === "offline");
    el.classList.toggle("is-connecting", state === "connecting");
    el.classList.toggle("is-live", state === "live");
    if (message) el.dataset.liveMessage = message;
  });
  addTrace("live", message || state.toUpperCase(), true);
}

async function pollLiveSnapshot() {
  try {
    const [parkingResponse, opsResponse] = await Promise.all([
      fetch(`/api/parking/status?ts=${Date.now()}`, {cache: "no-store"}),
      fetch(`/api/operations/metrics?ts=${Date.now()}`, {cache: "no-store"})
    ]);
    if (!parkingResponse.ok || !opsResponse.ok) throw new Error("Live API request failed");
    const [parking, operations] = await Promise.all([parkingResponse.json(), opsResponse.json()]);
    render(parking);
    renderOperations(operations);
    if (liveState !== "live") setLiveState("live", "Live telemetry connected");
  } catch (error) {
    if (liveState !== "offline") setLiveState("offline", "Live telemetry temporarily unavailable — retrying");
  }
}

function startLivePolling() {
  if (livePollingTimer) return;
  pollLiveSnapshot();
  livePollingTimer = setInterval(pollLiveSnapshot, 2000);
}

function connectLive() {
  clearTimeout(liveReconnectTimer);
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  try {
    setLiveState("connecting", "Connecting live telemetry…");
    const socket = new WebSocket(`${protocol}://${location.host}/ws/live`);
    liveSocket = socket;
    socket.onopen = () => {
      setLiveState("live", "WebSocket live telemetry connected");
    };
    socket.onmessage = event => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "parking_update") render(payload.data);
        if (payload.type === "operations_update") renderOperations(payload.data);
      } catch (error) {
        addTrace("live", `Invalid telemetry message: ${error.message}`, true);
      }
    };
    socket.onerror = () => {
      startLivePolling();
    };
    socket.onclose = () => {
      if (liveSocket === socket) liveSocket = null;
      startLivePolling();
      liveReconnectTimer = setTimeout(connectLive, 1500);
    };
  } catch (error) {
    startLivePolling();
    liveReconnectTimer = setTimeout(connectLive, 1500);
  }
}

function showRoutes(routes) {
  if (!routes || !routes.length) {
    routeStrip.classList.add("hidden");
    return;
  }
  routeStrip.classList.remove("hidden");
  const routeItems = routes.map(r => `<b>${escapeHtml(r.agent)}</b>`).join(' <span class="route-arrow">→</span> ');
  routeStrip.innerHTML = `<span class="route-label">ROUTE</span>${routeItems}`;
}

async function ask(query) {
  if (!query.trim()) return;
  addMessage(query, "user");
  resetAgentStates();
  routeStrip.classList.add("hidden");
  requestState.textContent = "Running…";
  addTrace("supervisor", "Starting orchestration…");

  try {
    const response = await fetch(`/api/chat/stream?query=${encodeURIComponent(query)}`, {headers: {"Accept":"text/event-stream"}});
    if (!response.ok) {
      addMessage(`Request failed (${response.status})`, "ai");
      requestState.textContent = "Error";
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream:true});
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop();
      for (const chunk of chunks) {
        if (!chunk.startsWith("data:")) continue;
        const payload = JSON.parse(chunk.slice(5).trim());
        if (payload.type === "agent_started") { setAgent(payload.data.agent, "active"); addTrace(payload.data.agent, payload.data.message); }
        if (payload.type === "agent_completed") { setAgent(payload.data.agent, "done"); addTrace(payload.data.agent, "Completed"); }
        if (payload.type === "final") {
          showRoutes(payload.data.routes || []);
          addMessage(payload.data.answer, "ai");
          requestState.textContent = "Completed";
        }
        if (payload.type === "error") { addMessage(`AI error: ${payload.data.message}`, "ai"); requestState.textContent = "Error"; }
        if (payload.type === "done" && requestState.textContent !== "Error") requestState.textContent = "Ready";
      }
    }
    await loadStatus();
  } catch (error) {
    addMessage(`Connection error: ${error.message}`, "ai");
    requestState.textContent = "Error";
  }
}

$("chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("query");
  const query = input.value;
  input.value = "";
  await ask(query);
});

document.querySelectorAll(".chips button").forEach(button => {
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    document.querySelectorAll(".chips button").forEach(item => item.classList.remove("is-running"));
    button.classList.add("is-running");
    button.blur();
    try {
      await ask(button.dataset.q);
    } finally {
      button.classList.remove("is-running");
    }
  });
});
document.querySelectorAll(".floor-tabs button").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll(".floor-tabs button").forEach(item => item.classList.remove("active"));
  button.classList.add("active");
  selectedFloor = button.textContent === "All" ? null : button.textContent;
  if (currentSnapshot) render(currentSnapshot);
}));

$("clear-trace").addEventListener("click", () => { trace.innerHTML = ""; });

$("vision-btn").addEventListener("click", async () => {
  const file = $("image-file").files[0];
  if (!file) { addTrace("vision", "Select a parking image first", true); return; }
  const formData = new FormData();
  formData.append("image", file);
  requestState.textContent = "Vision…";
  resetAgentStates();
  setAgent("vision", "active");
  addTrace("vision", "Uploading parking image…");
  try {
    const result = await fetch("/api/vision/upload", {method:"POST", body:formData}).then(r => r.json());
    addMessage(result.report || result.message || JSON.stringify(result), "ai");
    setAgent("vision", "done");
    addTrace("vision", "Completed");
  } catch (e) {
    addTrace("vision", `Vision request failed: ${e.message}`, true);
  } finally {
    requestState.textContent = "Ready";
  }
});

const codeSnippets = {
  supervisor: {
    context: "The Supervisor chooses specialists instead of trying to answer every part itself.",
    code: `routes = supervisor.plan(user_query)\n\n# Example output\n[\n  {"agent": "occupancy", "reason": "need live EV availability"},\n  {"agent": "knowledge", "reason": "need current pricing policy"},\n  {"agent": "navigation", "reason": "need indoor route"}\n]`
  },
  fanout: {
    context: "LangGraph fans one request into specialist nodes. This is the key multi-agent orchestration pattern in the POC.",
    code: `def fan_out(state):\n    return [\n        Send(f"{route['agent']}_node", {\n            "request_id": state["request_id"],\n            "query": state["query"],\n            "task": route\n        })\n        for route in state["plan"]["routes"]\n    ]`
  },
  rag: {
    context: "RAG is kept separate from live parking state. Documents answer policy and pricing questions; the parking database answers current occupancy.",
    code: `chunks = await vector_store.search(query)\nreranked = rerank(query, chunks)\ncontext = "\\n".join(\n    f"[{c.source}] {c.text}"\n    for c in reranked[:4]\n)\nanswer = await llm.text(prompt, context)`
  },
  tool: {
    context: "The model can request an action, but the application validates the write target and current state before changing the database.",
    code: `spot = await repo.get_spot(spot_id)\nif spot.status != "available":\n    raise ValueError("Spot is not available")\n\nreservation = await repo.reserve(\n    user_id=user_id,\n    spot_id=spot_id,\n    duration_hours=hours\n)`
  }
};

function setCode(name) {
  const item = codeSnippets[name];
  $("code-context").textContent = item.context;
  $("code-snippet").textContent = item.code;
  document.querySelectorAll(".code-tabs button").forEach(btn => btn.classList.toggle("active", btn.dataset.code === name));
}

document.querySelectorAll(".code-tabs button").forEach(button => button.addEventListener("click", () => setCode(button.dataset.code)));
setCode("supervisor");

function setupSectionNavigation() {
  const links = [...document.querySelectorAll(".page-nav a")];
  const sections = links
    .map(link => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  const setActive = (id) => {
    links.forEach(link => link.classList.toggle("active", link.getAttribute("href") === `#${id}`));
  };

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter(entry => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
    if (visible[0]) setActive(visible[0].target.id);
  }, { rootMargin: "-18% 0px -68% 0px", threshold: [0, 0.2, 0.5, 0.8] });

  sections.forEach(section => observer.observe(section));

  links.forEach(link => link.addEventListener("click", () => {
    const target = document.querySelector(link.getAttribute("href"));
    if (target) setTimeout(() => setActive(target.id), 50);
  }));
}

setupSectionNavigation();


addMessage("Hello — I am ParkMind AI. Ask me a parking question and watch the Supervisor route it across live state, RAG, navigation, analytics, reservation or vision.", "ai");
addTrace("system", `UI build ${UI_BUILD} loaded`, true);
loadHealth();
loadStatus();
loadOperations();
connectLive();

window.addEventListener("error", (event) => {
  const message = event?.error?.message || event?.message || "Unknown browser error";
  try { addTrace("system", `UI error: ${message}`, true); } catch (_) {}
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event?.reason?.message || String(event?.reason || "Unhandled promise rejection");
  try { addTrace("system", `UI promise error: ${reason}`, true); } catch (_) {}
});

/* --------------------------------------------------------------------------
   Deep-detail interaction layer
   Every major box can explain itself without leaving the single-page POC.
---------------------------------------------------------------------------- */
const detailLibrary = {
  supervisor: {
    title: "Supervisor Agent", badge: "ORCHESTRATOR", summary: "The Supervisor is the traffic controller. It reads one natural-language request, identifies the jobs hidden inside it, and chooses the smallest useful set of specialist agents.",
    what: "It does not perform parking operations itself. It converts the request into explicit specialist tasks such as occupancy, knowledge, navigation or reservation.",
    why: "Without a coordinator, every agent may try to solve every request. The Supervisor makes routing intentional, observable and easier to extend.",
    flow: ["User request", "Supervisor", "Route plan", "Specialists", "Synthesis"],
    example: "“Find an EV space near the entrance, tell me today's price, and guide me there.” The Supervisor can route that to Occupancy + Knowledge/RAG + Navigation, then let Synthesis combine the results.",
    code: `plan = supervisor.plan(query)\n\n# Example\n[\n  {"agent": "occupancy", "task": "find available EV spots"},\n  {"agent": "knowledge", "task": "get current pricing policy"},\n  {"agent": "navigation", "task": "build route to best spot"}\n]`
  },
  parallel: {
    title: "Multi-Agent Parallelism", badge: "LANGGRAPH FAN-OUT", summary: "Independent work can happen at the same time instead of waiting for one agent to finish before another starts.",
    what: "LangGraph fans one state into several specialist tasks. Each specialist returns a focused result, and a reducer gathers them for synthesis.",
    why: "A composite parking request often contains unrelated jobs. Parallel execution reduces unnecessary waiting and keeps responsibilities isolated.",
    flow: ["Supervisor", "Fan-out", "Occupancy", "RAG", "Navigation", "Gather", "Synthesis"],
    example: "For an EV request, live availability, pricing policy and indoor route do not need each other to start. They can execute concurrently and converge later.",
    code: `from langgraph.constants import Send\n\ndef fan_out(state):\n    return [\n        Send("specialist", {"task": route, "query": state["query"]})\n        for route in state["plan"]["routes"]\n    ]`
  },
  rag: {
    title: "RAG + Re-ranking", badge: "GROUNDED KNOWLEDGE", summary: "Facility-specific facts such as prices, EV rules and accessibility policy come from controlled documents instead of the model guessing.",
    what: "Documents are chunked into searchable text, matched against the user question, reranked, and supplied to the response step as context.",
    why: "A model knows general language, but your parking facility has local rules. RAG connects the model to that controlled knowledge.",
    flow: ["Documents", "Chunks", "Vector search", "Re-rank", "Top context", "Answer"],
    example: "A user asks “Can I use the EV bay for 30 minutes without charging?” The Knowledge agent retrieves the facility EV policy and uses the highest-scoring passages for the answer.",
    code: `chunks = vector_store.search(query)\nranked = rerank(query, chunks)\ncontext = "\\n".join(c.text for c in ranked[:4])\nanswer = await llm.generate(query, context)`
  },
  openai: {
    title: "OpenAI Services", badge: "AI LAYER", summary: "OpenAI is used where model intelligence adds value: routing, answer synthesis, embeddings and image understanding.",
    what: "The POC keeps the model behind service boundaries. The application supplies structured context and tools rather than letting the model directly modify database state.",
    why: "This separation makes the architecture safer and easier to swap or scale. It also makes DEMO AI mode possible when a key is not available.",
    flow: ["Structured input", "OpenAI", "Reasoning / embedding / vision", "Validated app action"],
    example: "With an API key, the Supervisor uses the model to classify the request and Synthesis turns trusted specialist outputs into a natural answer. Without the key, deterministic demo answers use the same workflow.",
    code: `response = client.responses.create(\n    model=MODEL,\n    input=prompt\n)\ntext = response.output_text`
  },
  tools: {
    title: "Deterministic Tools", badge: "SAFETY BOUNDARY", summary: "Actions that change system state are normal application functions with explicit business rules.",
    what: "Availability, reservation, release and similar operations validate current state before writing. The model can recommend an action but cannot bypass those checks.",
    why: "LLM output is probabilistic. Parking inventory and reservations need deterministic rules such as “only available spots can be reserved.”",
    flow: ["Agent request", "Validate", "Database write", "Audit", "Result"],
    example: "The user asks to reserve P1-A01. The Reservation agent checks that the slot is available, creates the reservation, and returns the booking details only after the write succeeds.",
    code: `spot = repo.get_spot(spot_id)\nif spot.status != "available":\n    raise ValueError("Spot is not available")\nreservation = repo.reserve(spot_id, hours)`
  },
  occupancy: {
    title: "Live Occupancy", badge: "REAL-TIME STATE", summary: "The parking grid is backed by changing state, so the dashboard behaves like a live operations surface instead of a static mockup.",
    what: "A background simulator periodically changes selected spot states. The application emits a parking update and the browser redraws the grid.",
    why: "Real parking systems are event-driven. Showing state changes makes the POC demonstrate telemetry, not just AI chat.",
    flow: ["Simulator", "Parking state", "Event", "Browser", "Updated grid"],
    example: "P2-B04 changes from Available to Occupied. The metric counters and spot tile update in the UI without a page refresh.",
    code: `while True:\n    changed = simulator.tick()\n    await event_bus.publish({"type": "parking_update", "data": snapshot()})`
  },
  websocket: {
    title: "WebSocket Telemetry", badge: "LIVE UI", summary: "The browser keeps a live connection open so parking-state changes can arrive instantly.",
    what: "The server publishes parking snapshots over a WebSocket. The UI listens for `parking_update` events and renders the latest state.",
    why: "Polling every few seconds is simple but introduces delay. WebSockets make the dashboard feel more like an operational control room.",
    flow: ["Parking update", "WebSocket", "Browser listener", "Render"],
    example: "A spot becomes available while the user is looking at the dashboard. The green tile appears immediately and the available count changes at the same time.",
    code: `socket = new WebSocket(` + "`ws://${location.host}/ws/live`" + `)\nsocket.onmessage = (event) => render(JSON.parse(event.data))`
  },
  sse: {
    title: "SSE Agent Trace", badge: "OBSERVABILITY", summary: "The system streams agent lifecycle events so a reviewer can see what the Supervisor actually triggered.",
    what: "Server-Sent Events stream agent_started, agent_completed, final and error events to the dashboard trace.",
    why: "Multi-agent workflows are hard to trust when all reasoning is hidden. The trace gives a visible operational timeline without exposing private chain-of-thought.",
    flow: ["Request", "Agent start", "Agent complete", "Synthesis", "Final"],
    example: "Ask for EV + price + route and the trace shows Supervisor → Occupancy → Knowledge → Navigation → Synthesis as execution progresses.",
    code: `yield sse("agent_started", {"agent": "occupancy"})\nresult = await agent.run(task)\nyield sse("agent_completed", {"agent": "occupancy"})`
  },
  vision: {
    title: "Vision Agent", badge: "IMAGE UNDERSTANDING", summary: "A parking image can be analyzed to estimate visible occupancy and provide a simple visual report.",
    what: "The agent receives an uploaded image and, when OpenAI Vision is enabled, asks the model to identify visible cars, free-looking bays and uncertainty.",
    why: "Parking sensors are not the only data source. Cameras can add another signal for occupancy estimation and anomaly investigation.",
    flow: ["Image upload", "Vision model", "Visual estimate", "Operator report"],
    example: "Upload a lot snapshot. The Vision agent can report that the visible row appears mostly occupied and flag that the estimate is image-based rather than authoritative live inventory.",
    code: `response = client.responses.create(\n  model=VISION_MODEL,\n  input=[image, prompt]\n)`
  },
  audit: {
    title: "Audit Trail", badge: "TRACEABILITY", summary: "Important requests and outcomes are stored so the POC can explain what happened after an interaction.",
    what: "The application records useful operational metadata such as the request, route plan and outcome, rather than relying on the chat transcript alone.",
    why: "Production AI systems need traceability for debugging, support and operational review.",
    flow: ["Request", "Route", "Actions", "Outcome", "Audit record"],
    example: "After a reservation attempt, the record can show which spot was requested, whether validation passed and what outcome the tool returned.",
    code: `await audit.log({\n  request: query,\n  routes: plan["routes"],\n  result: result\n})`
  },
  local: {
    title: "Local-First Runtime", badge: "EASY DEMO", summary: "Everything needed for the POC can run directly from a Python virtual environment without Docker.",
    what: "SQLite stores local state, the RAG index is local, the cache is in-process, and `python run.py` starts FastAPI.",
    why: "A portfolio POC should be easy for another developer to clone, install and demo without provisioning infrastructure first.",
    flow: ["Clone", "venv", "pip install", "python run.py", "Dashboard"],
    example: "A reviewer can clone the repository, add an OpenAI key or stay in DEMO AI mode, run one command and immediately see the system.",
    code: `python3 -m venv venv\nsource venv/bin/activate\npip install -r requirements.txt\npython run.py`
  },
  production: {
    title: "Production Upgrade Path", badge: "EVOLUTION", summary: "The POC deliberately uses replaceable interfaces so production infrastructure can be introduced without redesigning the business flow.",
    what: "Local components can be swapped behind the same service boundaries: SQLite → Postgres, in-process cache → Redis, local vector index → managed vector database, simulator → real sensor events.",
    why: "The point is to demonstrate architecture, not pretend a local POC is already production infrastructure.",
    flow: ["POC interfaces", "Replace adapters", "Real telemetry", "Scalable storage", "Production"],
    example: "The Reservation Agent still calls a repository interface after the database moves from SQLite to Postgres. The Supervisor and UI do not need to know which database is behind it.",
    code: `class ParkingRepository: ...\n\n# POC\nSQLiteParkingRepository(...)\n\n# Production adapter\nPostgresParkingRepository(...)`
  },
  user: {
    title: "User / Operator", badge: "EXPERIENCE", summary: "One dashboard combines natural language, live parking state and operational visibility.",
    what: "The operator can ask questions, inspect the parking grid, watch agent execution and trigger image analysis from one surface.",
    why: "Good AI architecture should be understandable at the experience layer, not only in backend diagrams.",
    flow: ["Question / Image", "Dashboard", "API", "AI workflow", "Visible result"],
    example: "A driver asks for an EV spot and the same page shows the chosen route, current availability and the agents involved.",
    code: `fetch("/api/chat/stream?query=" + encodeURIComponent(query))`
  },
  fastapi: {
    title: "FastAPI", badge: "APPLICATION API", summary: "FastAPI is the thin application boundary between the browser and the AI/parking services.",
    what: "It serves the dashboard, exposes REST-style endpoints, streams agent progress through SSE and exposes the live WebSocket connection.",
    why: "Keeping the API layer thin makes the POC easier to test and lets the UI remain independent from agent internals.",
    flow: ["Browser", "FastAPI", "Services", "Agents", "Storage"],
    example: "The chat page calls `/api/chat/stream`, while the parking grid receives `/ws/live` updates through a separate connection.",
    code: `@app.get("/api/chat/stream")\nasync def chat_stream(query: str):\n    return StreamingResponse(...)`
  },
  langgraph: {
    title: "LangGraph", badge: "WORKFLOW STATE", summary: "LangGraph provides the stateful workflow that connects Supervisor routing, specialist execution, reduction and synthesis.",
    what: "The graph stores state and uses `Send` to create dynamic specialist work items. A reducer collects the results into shared graph state.",
    why: "Multi-agent execution needs more than a list of function calls. The graph makes transitions and shared state explicit.",
    flow: ["State", "Supervisor", "Send", "Specialists", "Reducer", "Synthesis"],
    example: "One request can dynamically create three specialist work items today and potentially five tomorrow without rewriting a fixed linear pipeline.",
    code: `graph.add_conditional_edges(\n  "supervisor", fan_out\n)\ngraph.add_edge("specialist", "synthesis")`
  },
  reservation: {
    title: "Reservation Agent", badge: "ACTION AGENT", summary: "The Reservation Agent turns a validated user intent into a safe booking or release operation.",
    what: "It gathers booking details, checks current availability and delegates the actual write to deterministic repository logic.",
    why: "Reservation is a state-changing action, so it needs stronger controls than a read-only answer.",
    flow: ["Request", "Identify spot", "Validate", "Reserve", "Confirm"],
    example: "“Reserve P1-A01 for two hours.” The agent checks the current state before creating the reservation.",
    code: `result = await reservation_service.reserve(\n  spot_id=spot_id,\n  duration_hours=hours\n)`
  },
  navigation: {
    title: "Navigation Agent", badge: "ROUTE PLANNER", summary: "Navigation converts a selected parking location into a simple indoor route a person can follow.",
    what: "It uses lot metadata such as entrance, floor, row and spot to generate a concise path.",
    why: "Finding a spot is only useful when the driver can reach it. Navigation closes that gap.",
    flow: ["Entrance", "Floor", "Row", "Spot", "Driver"],
    example: "Gate A → Ramp P2 → Row C → C07 → EV charger. The POC uses structured lot metadata rather than GPS-level routing.",
    code: `steps = [\n  "Gate A", "Ramp P2", "Row C", "C07"\n]`
  },
  analytics: {
    title: "Analytics Agent", badge: "OPERATIONS", summary: "Analytics answers questions about occupancy levels, zones and simple operational KPIs.",
    what: "It reads current parking state and produces aggregated metrics such as occupancy percentage, availability by zone and trend snapshots.",
    why: "Parking AI is not only about drivers. Operators need a view of capacity and utilization.",
    flow: ["Live state", "Aggregate", "KPI", "Explain", "Operator"],
    example: "“Show occupancy by zone.” The agent can summarize which floors are busiest and which still have available capacity.",
    code: `occupancy = occupied / total * 100\nby_zone = group_by_zone(spots)`
  },
  storage: {
    title: "SQLite + Cache", badge: "LOCAL STATE", summary: "SQLite provides durable local state while a lightweight in-process cache speeds up repeat reads during the demo.",
    what: "Parking spots, reservations and useful history are persisted locally; frequently reused read results can be cached in memory.",
    why: "The POC needs real state without forcing a reviewer to provision Postgres or Redis just to start the dashboard.",
    flow: ["Agent", "Service", "Cache", "SQLite", "Result"],
    example: "A repeated availability request can reuse a fresh cached snapshot while background updates refresh the source of truth.",
    code: `cached = cache.get(key)\nif cached is None:\n    cached = await repo.snapshot()\n    cache.set(key, cached)`
  },
  synthesis: {
    title: "Synthesis Agent", badge: "FINAL ANSWER", summary: "Synthesis turns multiple specialist outputs into one user-friendly answer while preserving the distinction between live facts and retrieved knowledge.",
    what: "It receives the specialist result set, combines the useful facts, formats the response and avoids inventing missing information.",
    why: "Users should not have to read five agent responses. Synthesis gives them one coherent answer.",
    flow: ["Specialist results", "Grounding check", "Synthesis", "User answer"],
    example: "Occupancy says C07 is available, RAG says the EV fee is ₹40/hour, and Navigation provides Gate A → P2 → Row C → C07. Synthesis combines these into one answer.",
    code: `prompt = build_synthesis_prompt(results)\nanswer = await llm.generate(prompt)`
  },
  dashboard: {
    title: "Live Dashboard", badge: "CONTROL SURFACE", summary: "The dashboard is intentionally both a product demo and an architecture explainer.",
    what: "It shows live slots, agent lifecycle, AI responses, architecture, feature explanations and code patterns on one page.",
    why: "A reviewer can see the system work and understand how it is designed without opening separate documentation.",
    flow: ["Live state", "AI response", "Trace", "Architecture", "Deep details"],
    example: "Run “EV + price + route” while the parking state changes. The response, trace and grid update on the same page.",
    code: `document.querySelectorAll("[data-detail-key]")\n  .forEach(card => card.addEventListener("click", ...))`
  },
  "supervisor-why": {
    title: "Why use a Supervisor?", badge: "DESIGN DECISION", summary: "The point is not to make an LLM more complicated; it is to give different responsibilities to focused components.",
    what: "One coordinator decides who should work, while specialists remain narrow and testable.",
    why: "It reduces unnecessary agent calls and makes the system easier to observe, extend and reason about.",
    flow: ["One request", "Intent", "Selective routing", "Focused work", "One answer"],
    example: "A pure availability question does not need Navigation or Vision. The Supervisor can select only the Occupancy path.",
    code: `routes = [r for r in candidates if r["needed"]]`
  },
  "specialists-why": {
    title: "Why use specialists?", badge: "DESIGN DECISION", summary: "Each specialist owns one kind of work and can evolve independently.",
    what: "Occupancy owns live state; Knowledge owns facility documents; Navigation owns routes; Reservation owns bookings; Analytics owns KPIs; Vision owns images.",
    why: "A narrow contract makes testing and future replacement simpler than one huge agent with every responsibility.",
    flow: ["Contract", "Specialist", "Focused output", "Reducer", "Synthesis"],
    example: "You can improve the Navigation algorithm without rewriting the RAG or Reservation logic.",
    code: `class NavigationAgent(BaseAgent):\n    async def run(self, task): ...`
  },
  "tools-why": {
    title: "Why deterministic tools?", badge: "DESIGN DECISION", summary: "Business-critical writes belong to ordinary code with explicit checks.",
    what: "The model requests a tool-level action, but the service verifies state and rules before changing anything.",
    why: "That boundary makes the POC easier to trust than letting free-form model output directly update a database.",
    flow: ["Model intent", "Tool", "Validation", "Write", "Audit"],
    example: "The model cannot reserve an occupied space simply by saying it is available.",
    code: `assert spot.status == "available"\nrepo.reserve(spot.id)`
  },
  "rag-why": {
    title: "Why RAG?", badge: "DESIGN DECISION", summary: "Parking rules are facility-specific knowledge that should come from controlled documents.",
    what: "Retrieval supplies policy and pricing context to the answer generation step.",
    why: "The system needs current, local truth instead of relying on general model knowledge.",
    flow: ["Question", "Retrieve", "Re-rank", "Ground", "Answer"],
    example: "If the facility changes its EV pricing policy, update the knowledge document and re-index it rather than changing the model.",
    code: `context = rerank(query, retrieve(query))[:4]`
  },
  scenario: {
    title: "Real-time request flow", badge: "END-TO-END", summary: "This is the canonical ParkMind demo: one sentence contains several different jobs.",
    what: "The system extracts availability, policy and navigation tasks and executes them through separate boundaries.",
    why: "This demonstrates why orchestration matters beyond a simple chatbot or task queue.",
    flow: ["User", "Supervisor", "3 agents", "Gather", "Synthesis"],
    example: "“Find an EV charging spot near the entrance, tell me the current price and guide me there.”",
    code: `occupancy + knowledge + navigation\n            →\n        synthesis`
  },
  timeline1: {
    title: "Step 1 — Supervisor reads the request", badge: "STEP 01", summary: "The sentence is decomposed into three concrete jobs.",
    what: "The request is interpreted into live availability, pricing policy and route-building needs.", why: "Explicit tasks create clean boundaries for the next stage.", flow: ["Natural language", "Intent", "3 tasks"], example: "Need an EV spot + price + route.", code: `tasks = ["availability", "pricing", "navigation"]`
  },
  timeline2: {
    title: "Step 2 — LangGraph fans out", badge: "STEP 02", summary: "Specialists start from the shared request context.", what: "Dynamic `Send` items invoke the async specialist node for each selected route.", why: "Parallel fan-out keeps independent work independent.", flow: ["Plan", "Send", "Parallel tasks"], example: "Occupancy, RAG and Navigation can all start without waiting for one another.", code: `Send("specialist", {"task": route})`
  },
  timeline3: {
    title: "Step 3 — Occupancy reads live state", badge: "STEP 03", summary: "Current inventory comes from the parking state layer.", what: "The agent filters available EV spots and ranks them by a simple distance signal.", why: "Live state should not come from language-model memory.", flow: ["SQLite", "Filter", "Rank", "Best candidates"], example: "P2-C07 is available and closer than P2-C11.", code: `spot.status == "available" and spot.spot_type == "ev"`
  },
  timeline4: {
    title: "Step 4 — Knowledge agent uses RAG", badge: "STEP 04", summary: "Facility policy is retrieved rather than guessed.", what: "Relevant chunks are retrieved and reranked before being used for the answer.", why: "Pricing and rules are local business knowledge.", flow: ["Docs", "Vector match", "Re-rank", "Policy"], example: "The answer can say the EV rate is based on the facility pricing document.", code: `ranked = rerank(query, retrieve(query))`
  },
  timeline5: {
    title: "Step 5 — Navigation builds the route", badge: "STEP 05", summary: "A selected space becomes a human-readable indoor route.", what: "The agent maps entrance, floor, row and spot into ordered steps.", why: "A recommendation is more useful when the driver knows how to get there.", flow: ["Gate", "Ramp", "Row", "Spot"], example: "Gate A → Ramp P2 → Row C → C07.", code: `route = [entrance, floor, row, spot]`
  },
  timeline6: {
    title: "Step 6 — Synthesis explains the result", badge: "STEP 06", summary: "The final answer is produced from the specialist result set.", what: "Synthesis merges live state, grounded policy and route information into one concise response.", why: "Users need one coherent answer, not a list of internal agent outputs.", flow: ["Results", "Ground", "Synthesize", "Answer"], example: "“C07 is available. EV charging is ₹40/hour. Take Gate A → P2 → Row C → C07.”", code: `answer = synthesize(results)`
  }
};



detailLibrary["architect-profile"] = { title:"Vishal Upadhyay · AI Architect", badge:"PORTFOLIO PROFILE", summary:"Professional contact and portfolio identity for the ParkMind AI architecture showcase.", what:"Connects the POC to Vishal Upadhyay with direct contact details plus scannable LinkedIn and GitHub QR codes.", why:"A technical portfolio should make both the engineering story and its architect easy to discover.", flow:["ParkMind AI","Architecture Demo","Vishal Upadhyay","LinkedIn / GitHub"], example:"During a review, a viewer can scan LinkedIn or GitHub directly from the dashboard after exploring the architecture.", code:`name = "Vishal Upadhyay"\nrole = "AI Architect"\nlinkedin = "https://www.linkedin.com/in/vishal-aiml/"\ngithub = "https://github.com/vishal-aiml"` };

Object.assign(detailLibrary, {
  "ops-entries": {title:"Entry Count", badge:"LIVE OPERATIONS", summary:"Vehicles recorded entering the demo lot today.", what:"Each simulated gate event increments the daily entry counter and adds an activity record.", why:"Entry volume helps operators understand demand and arrival patterns.", flow:["Gate event","Validate","Count","Event feed"], example:"A new vehicle arrives at Gate A. The entry KPI increments and the event stream shows the arrival with a timestamp.", code:`entries_today += entry_event.count\noperations.publish({"type": "ENTRY"})`},
  "ops-exits": {title:"Exit Count", badge:"LIVE OPERATIONS", summary:"Vehicles recorded leaving the demo lot today.", what:"Exit events reduce active vehicle flow and create a live operational trail.", why:"Entry and exit counts together show whether the facility is filling or draining.", flow:["Exit event","Count","Net flow","Dashboard"], example:"Three vehicles leave during the latest interval; the exit KPI changes and the chart updates without refresh.", code:`exits_today += exit_event.count\nnet_flow = entries_today - exits_today`},
  "ops-fees": {title:"Parking Fees Collected", badge:"REVENUE", summary:"Simulated parking revenue collected by the lot today.", what:"Payment events add collected fees to the revenue counter and latest revenue series.", why:"A parking platform should expose commercial telemetry alongside occupancy.", flow:["Payment","Validate","Collect","Revenue"], example:"A driver exits after a 90-minute stay and ₹120 is collected. The revenue KPI and chart move upward on the next telemetry update.", code:`fees_today += payment.amount\nrecord_metric("fees", payment.amount)`},
  "ops-due": {title:"Parking Due / Overstay Charges", badge:"RISK + REVENUE", summary:"Outstanding or simulated overstay charges visible to operators.", what:"The demo occasionally creates a due event to show how exception handling can appear beside normal payments.", why:"Operational dashboards need to surface exceptions, not only successful payments.", flow:["Exit check","Overstay","Due event","Operator alert"], example:"A vehicle stays past the grace period. The system posts ₹80 due and exposes it in the alert stream.", code:`if stay_minutes > grace_period:\n    due_today += penalty\n    emit("OVERSTAY_DUE")`},
  "ops-stay": {title:"Average Stay", badge:"OPERATIONS KPI", summary:"Moving average of parking duration in the demo lot.", what:"The simulator gently changes this KPI to represent shifts in parking behavior.", why:"Average stay affects capacity planning, pricing and turnover decisions.", flow:["Sessions","Duration","Average","Planning"], example:"A longer average stay can explain why occupancy remains high even when entries slow down.", code:`avg_stay = total_parked_minutes / completed_sessions`},
  "ops-net": {title:"Net Vehicle Flow", badge:"OPERATIONS KPI", summary:"Entries minus exits for the day.", what:"A positive value means more vehicles entered than exited in the simulated day window.", why:"It is a simple signal for whether active demand is accumulating.", flow:["Entries","Exits","Difference","Capacity context"], example:"1,320 entries and 1,240 exits produce a net flow of +80.", code:`net_flow = entries_today - exits_today`},
  "chart-flow": {title:"Entries vs Exits Chart", badge:"REAL-TIME CHART", summary:"A rolling view of incoming and outgoing vehicle events.", what:"Each telemetry interval contributes entry and exit values. The UI redraws the SVG chart as new points arrive.", why:"Operators can spot bursts, quiet periods and imbalance without inspecting raw events.", flow:["Events","Intervals","Series","Chart"], example:"A morning arrival burst appears as a higher entry line, while the exit line catches up around lunchtime.", code:`series.append({"entries": entries, "exits": exits})\nrender_line_chart(series)`},
  "chart-money": {title:"Fees vs Due Charges", badge:"COMMERCIAL CHART", summary:"A rolling financial view that separates normal revenue from exception exposure.", what:"Collected fees and overdue amounts are tracked separately so the business view does not hide operational problems.", why:"Revenue alone is incomplete; operators also need to see unpaid or penalty-related amounts.", flow:["Payment events","Due events","Aggregate","Chart"], example:"Fees climb steadily while a few overstay events create small due-charge spikes.", code:`revenue_series.append(payment.amount)\ndue_series.append(overstay.amount)`},
  "activity-feed": {title:"Parking Event Stream", badge:"EVENT MONITOR", summary:"A live timeline of operational activities.", what:"Entries, exits, payments, reservations, EV sessions and due events appear as timestamped items.", why:"An event stream makes the system observable and helps operators explain why a KPI moved.", flow:["Event","Timestamp","Classify","Feed"], example:"“Vehicle exited · Gate C · 13:24:12” appears just before the exit counter increases.", code:`events.appendleft({"kind": event.type, "time": now})`},
  "ops-event-driven": {title:"Event-driven Operations", badge:"ARCHITECTURE PRINCIPLE", summary:"The operational dashboard is fed by small events instead of a single monolithic refresh cycle.", what:"Gate, payment and parking-state changes can be produced independently and then consumed by the dashboard.", why:"Real parking systems naturally produce events; the POC mirrors that mental model.", flow:["Source event","Event bus","Metric update","UI"], example:"A gate event updates traffic flow while a payment event updates revenue; both can arrive independently.", code:`await events.emit("live", "operations_update", telemetry)`},
  "ops-ai-layer": {title:"AI + Operations", badge:"AI SYSTEM DESIGN", summary:"The AI assistant and operational telemetry answer different classes of questions and meet in one interface.", what:"Telemetry describes current facts, while agents interpret requests, retrieve knowledge and explain actions.", why:"This separation prevents the LLM from becoming the source of truth for live operational numbers.", flow:["Live facts","AI request","Agent tools","Grounded answer"], example:"“Where should I park?” uses live occupancy. “What is the EV policy?” uses RAG. The final answer can combine both.", code:`live_state = repo.snapshot()\nanswer = agent.answer(query, live_state)`},
  "ops-production": {title:"Production Replacement Points", badge:"EVOLUTION PATH", summary:"The local simulator is a demo adapter, not the architecture endpoint.", what:"The telemetry interface can later be backed by real gate controllers, ANPR, payment events and billing services.", why:"Keeping an adapter boundary makes the POC portable to a production event pipeline.", flow:["POC simulator","Adapter contract","Real sensors","Production stream"], example:"Replace `OperationsSimulator.tick()` with a Kafka/event-stream consumer without changing the dashboard contract.", code:`class OperationsSource:\n    async def next_event(self) -> dict: ...\n\n# POC: simulator\n# Prod: sensor/event stream`},
  "storage": {title:"SQLite + Cache", badge:"LOCAL STATE", summary:"Local persistence for the parking POC.", what:"SQLite stores durable state while a small cache avoids repeated reads during the demo.", why:"It keeps setup simple and fast while retaining a replaceable repository boundary.", flow:["Service","Cache","SQLite","Result"], example:"Live parking state is read from SQLite and cached briefly for repeat status requests.", code:`cached = cache.get(key)\nif cached is None:\n    cached = await repo.snapshot()\n    cache.set(key, cached)`},
  "local": {title:"Local-First Runtime", badge:"DEVELOPER EXPERIENCE", summary:"Everything needed for the POC can run directly from a Python virtual environment.", what:"No Docker or external infrastructure is required for the core demo.", why:"A reviewer can clone, install dependencies and start the UI quickly.", flow:["Clone","venv","Install","run.py","Browser"], example:"A GitHub reviewer can start ParkMind locally without provisioning a database cluster or cache server.", code:`python3 -m venv venv\nsource venv/bin/activate\npip install -r requirements.txt\npython run.py`}
});

function openDetails(key, sourceEl=null, override=null) {
  const modal = $("detail-modal");
  if (!modal) return;
  const detail = override || detailLibrary[key];
  if (!detail) return;
  $("modal-eyebrow").textContent = detail.eyebrow || (detail.badge ? "PARKMIND ARCHITECTURE" : "PARKMIND DETAIL");
  $("modal-title").textContent = detail.title;
  $("modal-badge").textContent = detail.badge || "DETAIL";
  $("modal-summary").textContent = detail.summary || "";
  $("modal-what").textContent = detail.what || "";
  $("modal-why").textContent = detail.why || "";
  $("modal-example").textContent = detail.example || "";
  $("modal-code").textContent = detail.code || "";
  const flow = $("modal-flow");
  flow.innerHTML = "";
  (detail.flow || []).forEach((part, index) => {
    const pill = document.createElement("span");
    pill.className = "flow-pill";
    pill.textContent = part;
    flow.appendChild(pill);
    if (index < detail.flow.length - 1) {
      const arrow = document.createElement("span");
      arrow.className = "flow-arrow";
      arrow.textContent = "→";
      flow.appendChild(arrow);
    }
  });
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  modal.dataset.sourceId = sourceEl?.dataset?.detailKey || key;
  modal.removeAttribute("inert");
  setTimeout(() => $("modal-close")?.focus(), 0);
}

function closeDetails() {
  const modal = $("detail-modal");
  if (!modal) return;
  const sourceKey = modal.dataset.sourceId || "";
  const source = sourceKey ? [...document.querySelectorAll("[data-detail-key]")].find(el => el.dataset.detailKey === sourceKey) : null;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  if (source) setTimeout(() => source.focus(), 0);
}


function activateDetails(el) {
  if (!el || !el.dataset.detailKey) return;
  el.classList.add("interactive-card");
  el.setAttribute("role", "button");
  if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
}

function updateLiveUrl() {
  const link = $("live-url");
  if (!link) return;
  const localHost = ["127.0.0.1", "localhost"].includes(location.hostname);
  const host = localHost ? "parking.localhost" : location.hostname;
  const port = location.port ? `:${location.port}` : "";
  const target = `${location.protocol}//${host}${port}/parking/`;
  link.href = target;
  try {
    const u = new URL(target);
    link.textContent = u.host;
    link.title = `Open ParkMind at ${target}`;
  } catch (_) {
    link.textContent = target;
  }
}

function setupDeepInteractions() {
  const controlKeys = ["openai", "langgraph", "rag", "storage", "sse", "vision"];
  document.querySelectorAll(".control-item").forEach((el, index) => {
    if (controlKeys[index]) el.dataset.detailKey = controlKeys[index];
  });
  const calloutKeys = {"Why Supervisor?":"supervisor-why", "Why specialists?":"specialists-why", "Why deterministic tools?":"tools-why", "Why RAG?":"rag-why"};
  document.querySelectorAll(".architecture-callouts > div").forEach((el) => {
    const key = calloutKeys[el.querySelector("b")?.textContent.trim()];
    if (key) el.dataset.detailKey = key;
  });
  document.querySelectorAll(".timeline-step").forEach((el, index) => { el.dataset.detailKey = `timeline${index+1}`; });
  document.querySelectorAll(".plain-english > div").forEach((el, index) => { el.dataset.detailKey = ["supervisor", "rag", "tools"][index] || "dashboard"; });
  const signal = document.querySelector(".signal-card"); if (signal) signal.dataset.detailKey = "scenario";
  const heroNote = document.querySelector(".hero-note"); if (heroNote) heroNote.dataset.detailKey = "dashboard";
  document.querySelectorAll(".flow-node").forEach((el) => {
    const key = {Supervisor:"supervisor", Synthesis:"synthesis"}[el.querySelector("b")?.textContent.trim()];
    if (key) el.dataset.detailKey = key;
  });
  document.querySelectorAll(".mini-node").forEach((el) => {
    const key = {occupancy:"occupancy", rag:"rag", navigation:"navigation"}[el.querySelector("b")?.textContent.trim().toLowerCase()];
    if (key) el.dataset.detailKey = key;
  });
  document.querySelectorAll("[data-detail-key]").forEach(activateDetails);

  // Give dynamic and static cards the same interaction behavior. Event delegation
  // keeps this reliable even when the parking grid or activity feed is re-rendered.
  if (!document.body.dataset.detailDelegationReady) {
    document.body.addEventListener("click", (event) => {
      const card = event.target.closest("[data-detail-key]");
      if (!card) return;
      if (event.target.closest("button,a,input,textarea,select") && !event.target.closest(".feature-card,.arch-card,.metric,.ops-kpi,.chart-card,.activity-card,.insight-card,.spot")) return;
      const key = card.dataset.detailKey;
      if (key.startsWith("spot-")) {
        const spotId = key.slice(5);
        const status = [...card.classList].find(c => ["available","occupied","reserved","maintenance"].includes(c)) || "unknown";
        const type = card.dataset.spotType || "standard";
        const distance = card.dataset.distance || "near the entrance";
        if (!detailLibrary[key]) detailLibrary[key] = {
          title: `${spotId} · Parking Spot`, badge: status.toUpperCase(),
          summary: `${type} parking space in the live demo lot.`,
          what: `Current state is ${status}. It is ${distance} from the gate.`,
          why: "Spot-level details connect the real-time grid to the same architecture explanation layer.",
          flow: ["Sensor", "Parking state", "Agent/tool", "Dashboard"],
          example: `${spotId} is currently ${status}. The Occupancy agent can consider it when the user asks for parking.` ,
          code: `spot = await repo.get_spot("${spotId}")\nprint(spot.status)`
        };
      }
      openDetails(key, card);
    });
    document.body.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target.closest("[data-detail-key]")) {
        const card = event.target.closest("[data-detail-key]");
        event.preventDefault();
        card.click();
      }
    });
    document.body.dataset.detailDelegationReady = "true";
  }

  $("detail-modal")?.querySelectorAll("[data-modal-close]").forEach((el) => el.addEventListener("click", closeDetails));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDetails(); });

  // Metric definitions used by the top capacity row.
  const metricDetails = {
    "total-metric": {title:"Total Parking Spaces",badge:"LIVE METRIC",summary:"Current number of configured parking spaces.",what:"Counts every simulated space across the demo floors.",why:"This is the denominator used by occupancy calculations.",flow:["Lot config","All spaces","Total"],example:"54 spaces remain the configured capacity even while their status changes.",code:`total = len(spots)`},
    "available-metric": {title:"Available Spaces",badge:"LIVE METRIC",summary:"Spaces currently available for allocation.",what:"Counts spaces with the current status `available`.",why:"It is the immediate supply signal for drivers and allocation agents.",flow:["Live state","Filter","Count"],example:"When a car exits, an available slot may appear immediately in this KPI.",code:`available = count(s.status == "available")`},
    "occupied-metric": {title:"Occupied Spaces",badge:"LIVE METRIC",summary:"Spaces currently in use.",what:"Counts currently occupied spaces from the live parking state.",why:"Occupancy is the simplest capacity-utilization signal.",flow:["Sensors","State","Count"],example:"An entry event can move a spot to occupied and raise this number.",code:`occupied = count(s.status == "occupied")`},
    "occupancy-metric": {title:"Occupancy Percentage",badge:"LIVE METRIC",summary:"How much of the lot is occupied right now.",what:"Calculated as occupied spaces divided by total spaces.",why:"It compresses the lot into one easy-to-read capacity signal.",flow:["Occupied","Total","Percentage"],example:"27 occupied out of 54 total spaces means 50% occupancy.",code:`occupancy = occupied / total * 100`},
    "ops-entries": {title:"Entry Count",badge:"LIVE METRIC",summary:"Vehicles recorded entering the facility today.",what:"Gate events are added to the daily entry counter and latest interval series.",why:"Entry traffic helps operators understand demand and arrival patterns.",flow:["Gate","Event","Count","Dashboard"],example:"A new vehicle crosses Gate A, so the count rises and the chart receives a new point.",code:`entries_today += entry_event.count`},
    "ops-exits": {title:"Exit Count",badge:"LIVE METRIC",summary:"Vehicles recorded leaving the facility today.",what:"Exit events update the daily exit count and change the net vehicle flow.",why:"Entry and exit movement explains whether the facility is filling or draining.",flow:["Exit","Event","Count","Net flow"],example:"Two vehicles leave in the latest interval, reducing the current net flow.",code:`net_flow = entries_today - exits_today`},
    "ops-fees": {title:"Fees Collected",badge:"LIVE REVENUE",summary:"Parking revenue recorded by payment events.",what:"Successful payment events add their amount to the daily fees total.",why:"Commercial telemetry gives the operator a second business view beyond occupancy.",flow:["Payment","Validate","Collect","Revenue"],example:"A ₹120 payment increases the revenue total and the commercial chart.",code:`fees_today += payment.amount`},
    "ops-due": {title:"Due / Overstay",badge:"LIVE EXCEPTION",summary:"Outstanding or simulated overstay charges.",what:"Exception events add due amounts when a stay exceeds the configured allowance.",why:"Operators need visibility into revenue exposure and customer exceptions.",flow:["Stay check","Overstay","Due","Alert"],example:"An overstay creates an ₹80 due event that appears in the KPI and activity feed.",code:`if stay_minutes > grace_period:
    due_today += charge`}
  };
  document.querySelectorAll(".metric").forEach((el, index) => {
    const key = Object.keys(metricDetails)[index];
    if (key && !detailLibrary[key]) detailLibrary[key] = metricDetails[key];
    if (key) { el.dataset.detailKey = key; activateDetails(el); }
  });
}

// Spot tiles are wired directly during render so live state and interactions stay in sync.

function syncStickyOffsets() {
  const topbar = document.querySelector(".topbar");
  const nav = document.querySelector(".page-nav");
  if (!topbar) return;
  document.documentElement.style.setProperty("--topbar-height", `${topbar.getBoundingClientRect().height}px`);
  if (nav) document.documentElement.style.setProperty("--nav-height", `${nav.getBoundingClientRect().height}px`);
}


function decorateUiIcons() {
  const map={supervisor:"brain",parallel:"spark",rag:"database",openai:"spark",tools:"shield",occupancy:"car",websocket:"signal",sse:"signal",vision:"eye",audit:"shield",local:"bolt",production:"route",navigation:"route",reservation:"shield",analytics:"chart",storage:"database",synthesis:"brain",dashboard:"chart",langgraph:"spark","ops-entries":"car","ops-exits":"route","ops-fees":"chart","ops-due":"shield","ops-stay":"signal","ops-net":"route","chart-flow":"chart","chart-money":"chart","activity-feed":"signal","ops-event-driven":"signal","ops-ai-layer":"brain","ops-production":"route",user:"spark",fastapi:"signal",scenario:"car","supervisor-why":"brain","specialists-why":"spark","tools-why":"shield","rag-why":"database",timeline1:"brain",timeline2:"spark",timeline3:"car",timeline4:"database",timeline5:"route",timeline6:"brain","total-metric":"chart","available-metric":"car","occupied-metric":"car","occupancy-metric":"signal","architect-profile":"brain"};
  document.querySelectorAll("[data-detail-key]").forEach(el=>{
    if (el.classList.contains("spot")) return;
    if(el.querySelector(":scope > .ui-card-icon"))return;
    const name=map[el.dataset.detailKey];
    if(!name)return;
    const icon=document.createElement("span");
    icon.className="ui-card-icon";
    icon.innerHTML=iconSvg(name);
    icon.setAttribute("aria-hidden","true");
    el.prepend(icon);
    el.classList.add("has-ui-icon");
  });
  const brand=document.querySelector(".brand-mark");if(brand&&!brand.dataset.iconized){brand.innerHTML=iconSvg("car");brand.dataset.iconized="true";}
}

setupDeepInteractions();
decorateUiIcons();
updateLiveUrl();
syncStickyOffsets();
window.addEventListener("resize", syncStickyOffsets);
