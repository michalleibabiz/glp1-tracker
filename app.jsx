const { useState, useEffect, useMemo, useRef, useCallback, useId } = React;

/* ---------------------------------------------------------------------- */
/* Storage                                                                 */
/* ---------------------------------------------------------------------- */

const STORAGE_KEY = "glp1_tracker_v1";

const DEFAULT_DATA = {
  injections: [],   // { id, date, time, dose, site }
  weights: [],       // { id, date, weight, waist, hips, chest }
  sideEffects: [],   // { id, date, symptom, severity, note }
  nutrition: [],     // { id, date, water, protein, breakfast, lunch, dinner, snacks, note }
  notes: [],         // { id, date, text }
  photos: [],        // { id, date (YYYY-MM), note } — actual image lives in IndexedDB, keyed by id
  settings: { intervalDays: 7, reminderEnabled: false },
};

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredCloneSafe(DEFAULT_DATA);
    const parsed = JSON.parse(raw);
    return { ...structuredCloneSafe(DEFAULT_DATA), ...parsed, settings: { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) } };
  } catch (e) {
    console.error("Failed to load data", e);
    return structuredCloneSafe(DEFAULT_DATA);
  }
}

function structuredCloneSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save data", e);
  }
}

function uid() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

/* ---------------------------------------------------------------------- */
/* Photo storage (IndexedDB) — images are too large for localStorage       */
/* ---------------------------------------------------------------------- */

const PHOTO_DB_NAME = "glp1_tracker_photos_db";
const PHOTO_STORE = "photos";

function openPhotoDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTO_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(PHOTO_STORE)) {
        req.result.createObjectStore(PHOTO_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function savePhotoBlob(id, dataUrl) {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    tx.objectStore(PHOTO_STORE).put(dataUrl, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getPhotoBlob(id) {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readonly");
    const req = tx.objectStore(PHOTO_STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deletePhotoBlob(id) {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    tx.objectStore(PHOTO_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function clearAllPhotoBlobs() {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(PHOTO_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

/* Resize + re-encode an image file client-side before storing it, so a phone
   camera photo (often 4-8MB) doesn't balloon IndexedDB usage over months. */
function resizeImageFile(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round(height * (maxDim / width));
            width = maxDim;
          } else {
            width = Math.round(width * (maxDim / height));
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------------------------------------------------------------- */
/* Date helpers                                                            */
/* ---------------------------------------------------------------------- */

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function nowHM() {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}

function formatDateHe(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateShortHe(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
}

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + "T00:00:00");
  const b = new Date(isoB + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

function addDaysISO(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthHe(ym) {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("he-IL", { month: "long", year: "numeric" });
}

/* ---------------------------------------------------------------------- */
/* Constants                                                               */
/* ---------------------------------------------------------------------- */

const INJECTION_SITES = ["בטן", "ירך ימין", "ירך שמאל", "זרוע ימין", "זרוע שמאל"];

const MOTIVATIONAL_QUOTES = [
  "כל צעד קטן הוא עדיין צעד קדימה.",
  "את לא צריכה להיות מושלמת, רק עקבית.",
  "היום זה עוד יום שבו את בוחרת בעצמך.",
  "תני לעצמך קרדיט על כל מה שכבר עברת.",
  "הגוף שלך מקשיב לך — תמשיכי לתת לו סבלנות.",
  "התקדמות היא לא תמיד גלויה לעין, אבל היא קיימת.",
  "כל יום שאת מתעדת הוא יום שבו את דואגת לעצמך.",
  "את בונה הרגל, לא רודפת אחרי שלמות.",
  "נשימה עמוקה, צעד אחד בכל פעם.",
  "השינוי האמיתי קורה לאט ולאורך זמן — תני לו זמן.",
  "היי סבלנית עם עצמך, את בתהליך של ריפוי.",
  "כל תופעת לוואי שאת עוברת מלמדת אותך משהו על הגוף שלך.",
  "הדרך שלך היא שלך בלבד — אין צורך להשוות.",
  "מגיע לך להרגיש טוב יותר, ואת בדרך לשם.",
  "תזכרי למה התחלת, וזה יזכיר לך למה להמשיך.",
];

function getDailyQuote() {
  const start = new Date(new Date().getFullYear(), 0, 0);
  const now = new Date();
  const diff = now - start;
  const dayOfYear = Math.floor(diff / 86400000);
  return MOTIVATIONAL_QUOTES[dayOfYear % MOTIVATIONAL_QUOTES.length];
}

const NONE_SYMPTOM = "אין";

const COMMON_SYMPTOMS = ["בחילה", "עייפות", "כאב ראש", "עצירות", "שלשול", "צרבת", "סחרחורת", "כאב בטן", "ירידה בתיאבון"];

const SEVERITY_COLORS = { 1: "#7fc7dc", 2: "#3fabc7", 3: "#1a9cb8", 4: "#16336e", 5: "#c0392b" };

const TABS = [
  { key: "dashboard", label: "בית", icon: "🏠" },
  { key: "injections", label: "זריקות", icon: "💉" },
  { key: "weight", label: "משקל", icon: "⚖️" },
  { key: "photos", label: "תמונות", icon: "📷" },
  { key: "sideEffects", label: "תופעות", icon: "📋" },
  { key: "nutrition", label: "תזונה", icon: "🥤" },
  { key: "notes", label: "הערות", icon: "📝" },
  { key: "settings", label: "הגדרות", icon: "⚙️" },
];

/* ---------------------------------------------------------------------- */
/* Small shared UI                                                         */
/* ---------------------------------------------------------------------- */

function Toast({ message }) {
  if (!message) return null;
  return <div className="toast">{message}</div>;
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

/* Loads its image lazily from IndexedDB by id */
function PhotoImage({ id, alt, className }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let active = true;
    setSrc(null);
    getPhotoBlob(id).then((dataUrl) => {
      if (active) setSrc(dataUrl || null);
    }).catch(() => {});
    return () => { active = false; };
  }, [id]);

  if (!src) return <div className={`${className} photo-loading`} />;
  return <img className={className} src={src} alt={alt} />;
}

function ConfirmDelete({ onConfirm, children }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <button
        className="del-btn"
        onClick={() => { setConfirming(false); onConfirm(); }}
        onBlur={() => setConfirming(false)}
        style={{ color: "#dc2626", fontWeight: 700 }}
      >
        למחוק?
      </button>
    );
  }
  return (
    <button className="del-btn" onClick={() => setConfirming(true)}>
      {children}
    </button>
  );
}

/* Decorative wavy divider, used to cut colored blocks into the page background */
function WaveDivider({ fill = "var(--bg)" }) {
  return (
    <svg className="wave-divider" viewBox="0 0 1440 60" preserveAspectRatio="none">
      <path d="M0,32 C240,58 480,4 720,22 C960,40 1200,8 1440,28 L1440,60 L0,60 Z" style={{ fill }} />
    </svg>
  );
}

/* Simple inline SVG line chart, no external deps */
function LineChart({ points, unit, from = "#2eb5d6", to = "#16336e", height = 160 }) {
  const rawId = useId();
  const gradId = "chart-grad-" + rawId.replace(/[^a-zA-Z0-9]/g, "");
  const padding = { top: 14, right: 14, bottom: 24, left: 36 };
  const width = Math.max(280, points.length * 56);
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  if (points.length === 0) return <EmptyState text="אין עדיין נתונים להצגה" />;

  const values = points.map((p) => p.y);
  let minY = Math.min(...values);
  let maxY = Math.max(...values);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const pad = (maxY - minY) * 0.15;
  minY -= pad;
  maxY += pad;

  const xStep = points.length > 1 ? innerW / (points.length - 1) : 0;
  const yFor = (v) => padding.top + innerH - ((v - minY) / (maxY - minY)) * innerH;
  const xFor = (i) => padding.left + i * xStep;

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(p.y).toFixed(1)}`).join(" ");
  const areaD = `${pathD} L ${xFor(points.length - 1).toFixed(1)} ${(padding.top + innerH).toFixed(1)} L ${xFor(0).toFixed(1)} ${(padding.top + innerH).toFixed(1)} Z`;

  const gridLines = 3;

  return (
    <div className="chart-wrap">
      <svg className="chart-svg" width={width} height={height}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        {Array.from({ length: gridLines + 1 }).map((_, i) => {
          const v = minY + ((maxY - minY) * i) / gridLines;
          const y = yFor(v);
          return (
            <g key={i}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" />
              <text x={padding.left - 6} y={y + 3} textAnchor="end">{v.toFixed(1)}</text>
            </g>
          );
        })}
        <path d={areaD} fill={`url(#${gradId})`} opacity="0.12" stroke="none" />
        <path d={pathD} fill="none" stroke={`url(#${gradId})`} strokeWidth="2.75" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={xFor(i)} cy={yFor(p.y)} r="3.5" fill={to} />
            <text x={xFor(i)} y={height - 6} textAnchor="middle">{p.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Dashboard                                                               */
/* ---------------------------------------------------------------------- */

function QuoteBanner() {
  const quote = useMemo(getDailyQuote, []);
  return (
    <div className="quote-banner">
      <span className="quote-mark">”</span>
      <span>{quote}</span>
    </div>
  );
}

function Dashboard({ data, showToast, onNavigate }) {
  const lastInjection = data.injections[data.injections.length - 1];
  const intervalDays = data.settings.intervalDays;
  const today = todayISO();

  let nextDueISO = null;
  let daysLeft = null;
  if (lastInjection) {
    nextDueISO = addDaysISO(lastInjection.date, intervalDays);
    daysLeft = daysBetween(today, nextDueISO);
  }

  let bannerClass = "ok";
  let bannerBig = "אין עדיין זריקות רשומות";
  let bannerSmall = "עברי ללשונית זריקות כדי להוסיף רישום ראשון";

  if (lastInjection) {
    if (daysLeft > 1) {
      bannerClass = "ok";
      bannerBig = `הזריקה הבאה בעוד ${daysLeft} ימים`;
      bannerSmall = `מתוכננת ל-${formatDateHe(nextDueISO)}`;
    } else if (daysLeft === 1) {
      bannerClass = "due";
      bannerBig = "הזריקה הבאה מחר";
      bannerSmall = `מתוכננת ל-${formatDateHe(nextDueISO)}`;
    } else if (daysLeft === 0) {
      bannerClass = "due";
      bannerBig = "הזריקה הבאה היום";
      bannerSmall = "אל תשכחי לתעד אחרי ההזרקה";
    } else {
      bannerClass = "overdue";
      bannerBig = `איחור של ${Math.abs(daysLeft)} ימים`;
      bannerSmall = `היעד היה ${formatDateHe(nextDueISO)}`;
    }
  }

  const recentWeights = [...data.weights].sort((a, b) => a.date.localeCompare(b.date)).slice(-6);
  const lastWeight = recentWeights[recentWeights.length - 1];
  const firstWeightOverall = [...data.weights].sort((a, b) => a.date.localeCompare(b.date))[0];
  const weightDelta = lastWeight && firstWeightOverall && lastWeight.id !== firstWeightOverall.id
    ? (lastWeight.weight - firstWeightOverall.weight)
    : null;

  const recentSideEffects = [...data.sideEffects].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);

  const hasPhotoThisMonth = data.photos.some((p) => p.date === currentYearMonth());

  return (
    <div className="screen">
      <QuoteBanner />

      {!hasPhotoThisMonth && (
        <div className="photo-nudge" onClick={() => onNavigate && onNavigate("photos")}>
          <span>📷 עוד לא העלית תמונת התקדמות החודש</span>
          <span className="photo-nudge-arrow">←</span>
        </div>
      )}

      <div className={`reminder-banner ${bannerClass}`}>
        <div className="banner-content">
          <div>
            <div className="big">{bannerBig}</div>
            <div className="small">{bannerSmall}</div>
          </div>
          <div style={{ fontSize: "1.6rem" }}>💉</div>
        </div>
        <WaveDivider fill="var(--bg)" />
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="value">{lastWeight ? lastWeight.weight : "—"}</div>
          <div className="label">משקל אחרון (ק"ג)</div>
        </div>
        <div className="stat-card">
          <div className="value">{weightDelta !== null ? (weightDelta > 0 ? "+" : "") + weightDelta.toFixed(1) : "—"}</div>
          <div className="label">שינוי כולל (ק"ג)</div>
        </div>
      </div>

      <div className="card">
        <h2>משקל <span className="muted">— 6 מדידות אחרונות</span></h2>
        <LineChart
          points={recentWeights.map((w) => ({ y: w.weight, label: formatDateShortHe(w.date) }))}
        />
      </div>

      <div className="card">
        <h2>תופעות לוואי אחרונות</h2>
        {recentSideEffects.length === 0 ? (
          <EmptyState text="לא דווחו תופעות לוואי לאחרונה" />
        ) : (
          <div className="entry-list">
            {recentSideEffects.map((s) => (
              <div className="entry" key={s.id}>
                <div className="meta">
                  <span className="main">{s.symptom}</span>
                  <span className="sub">{formatDateHe(s.date)}</span>
                </div>
                {s.symptom === NONE_SYMPTOM ? (
                  <span className="severity-badge none-badge">✓</span>
                ) : (
                  <span className="severity-badge" style={{ background: SEVERITY_COLORS[s.severity] }}>{s.severity}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Injections                                                              */
/* ---------------------------------------------------------------------- */

function recommendedSite(injections) {
  if (injections.length === 0) return INJECTION_SITES[0];
  const sorted = [...injections].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const lastSites = sorted.slice(-INJECTION_SITES.length).map((i) => i.site);
  for (const site of INJECTION_SITES) {
    if (!lastSites.includes(site)) return site;
  }
  // all sites used recently -> pick the least-recently-used one
  const lastUsedIndex = {};
  sorted.forEach((inj, idx) => { lastUsedIndex[inj.site] = idx; });
  let oldest = INJECTION_SITES[0];
  let oldestIdx = Infinity;
  for (const site of INJECTION_SITES) {
    const idx = lastUsedIndex[site] ?? -1;
    if (idx < oldestIdx) { oldestIdx = idx; oldest = site; }
  }
  return oldest;
}

function InjectionsTab({ data, updateData, showToast }) {
  const rec = useMemo(() => recommendedSite(data.injections), [data.injections]);
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState(nowHM());
  const [dose, setDose] = useState("");
  const [site, setSite] = useState(rec);

  useEffect(() => { setSite(rec); }, [rec]);

  const sorted = [...data.injections].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

  function handleAdd() {
    if (!date || !dose) { showToast("נא למלא תאריך ומינון"); return; }
    const entry = { id: uid(), date, time, dose: parseFloat(dose), site };
    updateData((d) => ({ ...d, injections: [...d.injections, entry] }));
    setDose("");
    showToast("הזריקה נשמרה");
  }

  function handleDelete(id) {
    updateData((d) => ({ ...d, injections: d.injections.filter((i) => i.id !== id) }));
  }

  return (
    <div className="screen">
      <div className="card">
        <h2>רישום זריקה חדשה</h2>
        <div className="grid-2">
          <div className="field">
            <label>תאריך</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>שעה</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>מינון (מ"ג)</label>
          <input type="number" inputMode="decimal" step="0.05" placeholder="לדוגמה 0.25" value={dose} onChange={(e) => setDose(e.target.value)} />
        </div>
        <div className="field">
          <label>אזור הזרקה — מומלץ: {rec}</label>
          <div className="chip-row">
            {INJECTION_SITES.map((s) => (
              <button
                key={s}
                className={`chip ${site === s ? "selected" : ""} ${rec === s ? "recommended" : ""}`}
                onClick={() => setSite(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <button className="btn-primary" onClick={handleAdd}>שמירת זריקה</button>
      </div>

      <div className="section-title">היסטוריית זריקות ({sorted.length})</div>
      {sorted.length === 0 ? (
        <div className="card"><EmptyState text="עדיין לא נרשמו זריקות" /></div>
      ) : (
        <div className="card">
          <div className="entry-list">
            {sorted.map((i) => (
              <div className="entry" key={i.id}>
                <div className="meta">
                  <span className="main">{i.dose} מ"ג · {i.site}</span>
                  <span className="sub">{formatDateHe(i.date)} · {i.time}</span>
                </div>
                <ConfirmDelete onConfirm={() => handleDelete(i.id)}>✕</ConfirmDelete>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Weight                                                                   */
/* ---------------------------------------------------------------------- */

const MEASUREMENT_FIELDS = [
  { key: "weight", label: "משקל", unit: "ק\"ג", step: "0.1" },
  { key: "waist", label: "בטן", unit: "ס\"מ", step: "0.5" },
  { key: "hips", label: "ישבן", unit: "ס\"מ", step: "0.5" },
  { key: "chest", label: "חזה", unit: "ס\"מ", step: "0.5" },
];

function WeightTab({ data, updateData, showToast }) {
  const [date, setDate] = useState(todayISO());
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [hips, setHips] = useState("");
  const [chest, setChest] = useState("");
  const [metric, setMetric] = useState("weight");

  const sorted = [...data.weights].sort((a, b) => a.date.localeCompare(b.date));
  const sortedDesc = [...sorted].reverse();

  function handleAdd() {
    if (!weight) { showToast("נא להזין משקל"); return; }
    const existing = data.weights.find((w) => w.date === date);
    const entry = {
      id: existing ? existing.id : uid(),
      date,
      weight: parseFloat(weight),
      waist: waist === "" ? null : parseFloat(waist),
      hips: hips === "" ? null : parseFloat(hips),
      chest: chest === "" ? null : parseFloat(chest),
    };
    updateData((d) => ({ ...d, weights: [...d.weights.filter((w) => w.date !== date), entry] }));
    setWeight("");
    setWaist("");
    setHips("");
    setChest("");
    showToast("המדידה נשמרה");
  }

  function handleDelete(id) {
    updateData((d) => ({ ...d, weights: d.weights.filter((w) => w.id !== id) }));
  }

  const chartField = MEASUREMENT_FIELDS.find((f) => f.key === metric);
  const chartPoints = sorted
    .filter((w) => w[metric] !== null && w[metric] !== undefined && w[metric] !== "")
    .map((w) => ({ y: w[metric], label: formatDateShortHe(w.date) }));

  return (
    <div className="screen">
      <div className="card">
        <h2>רישום משקל והיקפים</h2>
        <div className="field">
          <label>תאריך</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>משקל (ק"ג)</label>
          <input type="number" inputMode="decimal" step="0.1" placeholder="לדוגמה 78.5" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </div>
        <div className="field">
          <label>היקפים (ס"מ) — לא חובה</label>
          <div className="grid-3">
            <input type="number" inputMode="decimal" step="0.5" placeholder="בטן" value={waist} onChange={(e) => setWaist(e.target.value)} />
            <input type="number" inputMode="decimal" step="0.5" placeholder="ישבן" value={hips} onChange={(e) => setHips(e.target.value)} />
            <input type="number" inputMode="decimal" step="0.5" placeholder="חזה" value={chest} onChange={(e) => setChest(e.target.value)} />
          </div>
        </div>
        <button className="btn-primary" onClick={handleAdd}>שמירת מדידה</button>
      </div>

      <div className="card">
        <h2>גרף התקדמות</h2>
        <div className="chip-row" style={{ marginBottom: 12 }}>
          {MEASUREMENT_FIELDS.map((f) => (
            <button
              key={f.key}
              className={`chip ${metric === f.key ? "selected" : ""}`}
              onClick={() => setMetric(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <LineChart points={chartPoints} />
      </div>

      <div className="section-title">היסטוריה ({sortedDesc.length})</div>
      {sortedDesc.length === 0 ? (
        <div className="card"><EmptyState text="עדיין אין מדידות" /></div>
      ) : (
        <div className="card">
          <div className="entry-list">
            {sortedDesc.map((w) => {
              const parts = [`${w.weight} ק"ג`];
              if (w.waist) parts.push(`בטן ${w.waist}`);
              if (w.hips) parts.push(`ישבן ${w.hips}`);
              if (w.chest) parts.push(`חזה ${w.chest}`);
              return (
                <div className="entry" key={w.id}>
                  <div className="meta">
                    <span className="main">{parts.join(" · ")}</span>
                    <span className="sub">{formatDateHe(w.date)}</span>
                  </div>
                  <ConfirmDelete onConfirm={() => handleDelete(w.id)}>✕</ConfirmDelete>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Progress photos                                                         */
/* ---------------------------------------------------------------------- */

function PhotosTab({ data, updateData, showToast }) {
  const [month, setMonth] = useState(currentYearMonth());
  const [note, setNote] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [saving, setSaving] = useState(false);
  const [lightboxId, setLightboxId] = useState(null);
  const fileInputRef = useRef(null);

  const sortedAsc = [...data.photos].sort((a, b) => a.date.localeCompare(b.date));
  const sortedDesc = [...sortedAsc].reverse();

  const [compareFrom, setCompareFrom] = useState(null);
  const [compareTo, setCompareTo] = useState(null);

  const firstPhoto = sortedAsc[0];
  const lastPhoto = sortedAsc[sortedAsc.length - 1];
  const fromPhoto = sortedAsc.find((p) => p.date === compareFrom) || firstPhoto;
  const toPhoto = sortedAsc.find((p) => p.date === compareTo) || lastPhoto;

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function handleSave() {
    if (!selectedFile) { showToast("נא לבחור תמונה"); return; }
    setSaving(true);
    try {
      const dataUrl = await resizeImageFile(selectedFile);
      const existing = data.photos.find((p) => p.date === month);
      const id = existing ? existing.id : uid();
      await savePhotoBlob(id, dataUrl);
      const entry = { id, date: month, note: note.trim() };
      updateData((d) => ({ ...d, photos: [...d.photos.filter((p) => p.date !== month), entry] }));
      setSelectedFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setNote("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      showToast(`התמונה של ${formatMonthHe(month)} נשמרה`);
    } catch (err) {
      showToast("שגיאה בשמירת התמונה");
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(id) {
    deletePhotoBlob(id).catch(() => {});
    updateData((d) => ({ ...d, photos: d.photos.filter((p) => p.id !== id) }));
  }

  return (
    <div className="screen">
      <div className="card">
        <h2>לפני / אחרי</h2>
        {sortedAsc.length === 0 ? (
          <EmptyState text="עדיין אין תמונות — התחילי עם התמונה הראשונה למטה" />
        ) : sortedAsc.length === 1 ? (
          <div className="before-after-single">
            <PhotoImage id={firstPhoto.id} alt={formatMonthHe(firstPhoto.date)} className="before-after-img" />
            <div className="label">{formatMonthHe(firstPhoto.date)}</div>
            <div className="empty-state">הוסיפי עוד תמונה חודשית כדי לראות השוואה</div>
          </div>
        ) : (
          <React.Fragment>
            <div className="grid-2" style={{ marginBottom: 10 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>לפני</label>
                <select value={fromPhoto.date} onChange={(e) => setCompareFrom(e.target.value)}>
                  {sortedAsc.map((p) => (
                    <option key={p.id} value={p.date}>{formatMonthHe(p.date)}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>אחרי</label>
                <select value={toPhoto.date} onChange={(e) => setCompareTo(e.target.value)}>
                  {sortedAsc.map((p) => (
                    <option key={p.id} value={p.date}>{formatMonthHe(p.date)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="before-after-grid">
              <div className="before-after-item">
                <PhotoImage id={fromPhoto.id} alt={formatMonthHe(fromPhoto.date)} className="before-after-img" />
                <div className="label">{formatMonthHe(fromPhoto.date)}</div>
              </div>
              <div className="before-after-arrow">←</div>
              <div className="before-after-item">
                <PhotoImage id={toPhoto.id} alt={formatMonthHe(toPhoto.date)} className="before-after-img" />
                <div className="label">{formatMonthHe(toPhoto.date)}</div>
              </div>
            </div>
          </React.Fragment>
        )}
      </div>

      <div className="card">
        <h2>העלאת תמונה חודשית</h2>
        <div className="field">
          <label>חודש</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div className="field">
          <label>תמונה</label>
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileSelect} />
        </div>
        {previewUrl && (
          <div className="field">
            <img src={previewUrl} alt="תצוגה מקדימה" className="photo-file-preview" />
          </div>
        )}
        <div className="field">
          <label>הערה (לא חובה)</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="איך את מרגישה החודש..." />
        </div>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "שומר..." : "שמירת תמונה"}
        </button>
        <div className="empty-state" style={{ padding: "8px 0 0" }}>
          התמונות נשמרות רק במכשיר הזה (לא כלולות בייצוא JSON בגלל הגודל).
        </div>
      </div>

      <div className="section-title">כל התמונות ({sortedDesc.length})</div>
      {sortedDesc.length === 0 ? (
        <div className="card"><EmptyState text="עדיין אין תמונות שמורות" /></div>
      ) : (
        <div className="card">
          <div className="photo-grid">
            {sortedDesc.map((p) => (
              <div className="photo-grid-item" key={p.id} onClick={() => setLightboxId(p.id)}>
                <button
                  className="del-btn-overlay"
                  onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                >
                  ✕
                </button>
                <PhotoImage id={p.id} alt={formatMonthHe(p.date)} className="" />
                <div className="month-tag">{formatMonthHe(p.date)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {lightboxId && (
        <div className="lightbox-overlay" onClick={() => setLightboxId(null)}>
          <button className="lightbox-close" onClick={() => setLightboxId(null)}>✕</button>
          <PhotoImage id={lightboxId} alt="" className="lightbox-img" />
          <div className="lightbox-caption">
            {formatMonthHe((data.photos.find((p) => p.id === lightboxId) || {}).date)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Side effects                                                            */
/* ---------------------------------------------------------------------- */

function SideEffectsTab({ data, updateData, showToast }) {
  const [date, setDate] = useState(todayISO());
  const [symptom, setSymptom] = useState(COMMON_SYMPTOMS[0]);
  const [customSymptom, setCustomSymptom] = useState("");
  const [severity, setSeverity] = useState(2);
  const [note, setNote] = useState("");

  const sorted = [...data.sideEffects].sort((a, b) => b.date.localeCompare(a.date));

  const summary = useMemo(() => {
    const map = {};
    data.sideEffects.forEach((s) => {
      if (s.symptom === NONE_SYMPTOM) return;
      if (!map[s.symptom]) map[s.symptom] = { count: 0, totalSeverity: 0 };
      map[s.symptom].count += 1;
      map[s.symptom].totalSeverity += s.severity;
    });
    return Object.entries(map)
      .map(([symptom, v]) => ({ symptom, count: v.count, avg: v.totalSeverity / v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [data.sideEffects]);

  function handleAdd() {
    const finalSymptom = symptom === "אחר" ? customSymptom.trim() : symptom;
    if (!finalSymptom) { showToast("נא לבחור או להזין תופעה"); return; }
    const entry = { id: uid(), date, symptom: finalSymptom, severity: finalSymptom === NONE_SYMPTOM ? 0 : severity, note: note.trim() };
    updateData((d) => ({ ...d, sideEffects: [...d.sideEffects, entry] }));
    setNote("");
    setCustomSymptom("");
    showToast(finalSymptom === NONE_SYMPTOM ? "נרשם יום נקי מתופעות" : "התופעה נשמרה");
  }

  function handleDelete(id) {
    updateData((d) => ({ ...d, sideEffects: d.sideEffects.filter((s) => s.id !== id) }));
  }

  return (
    <div className="screen">
      <div className="card">
        <h2>רישום תופעת לוואי</h2>
        <div className="field">
          <label>תאריך</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>תופעה</label>
          <div className="chip-row">
            <button
              className={`chip none-chip ${symptom === NONE_SYMPTOM ? "selected" : ""}`}
              onClick={() => setSymptom(NONE_SYMPTOM)}
            >
              ✓ {NONE_SYMPTOM} — יום נקי
            </button>
            {[...COMMON_SYMPTOMS, "אחר"].map((s) => (
              <button key={s} className={`chip ${symptom === s ? "selected" : ""}`} onClick={() => setSymptom(s)}>
                {s}
              </button>
            ))}
          </div>
          {symptom === "אחר" && (
            <input
              style={{ marginTop: 8, border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 11px", width: "100%" }}
              placeholder="תיאור התופעה"
              value={customSymptom}
              onChange={(e) => setCustomSymptom(e.target.value)}
            />
          )}
        </div>
        {symptom !== NONE_SYMPTOM && (
          <div className="field">
            <label>עוצמה: {severity} / 5</label>
            <div className="chip-row">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={`chip ${severity === n ? "selected" : ""}`}
                  style={severity === n ? { background: SEVERITY_COLORS[n], borderColor: SEVERITY_COLORS[n] } : {}}
                  onClick={() => setSeverity(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <label>הערה (לא חובה)</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="פרטים נוספים..." />
        </div>
        <button className="btn-primary" onClick={handleAdd}>שמירת תופעה</button>
      </div>

      {summary.length > 0 && (
        <div className="card">
          <h2>דפוסים נפוצים</h2>
          <div className="entry-list">
            {summary.map((s) => (
              <div className="entry" key={s.symptom}>
                <div className="meta">
                  <span className="main">{s.symptom}</span>
                  <span className="sub">{s.count} מקרים · עוצמה ממוצעת {s.avg.toFixed(1)}</span>
                </div>
                <span className="severity-badge" style={{ background: SEVERITY_COLORS[Math.round(s.avg)] }}>{s.avg.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section-title">היסטוריה ({sorted.length})</div>
      {sorted.length === 0 ? (
        <div className="card"><EmptyState text="עדיין לא דווחו תופעות לוואי" /></div>
      ) : (
        <div className="card">
          <div className="entry-list">
            {sorted.map((s) => (
              <div className="entry" key={s.id}>
                <div className="meta">
                  <span className="main">{s.symptom}{s.note ? ` — ${s.note}` : ""}</span>
                  <span className="sub">{formatDateHe(s.date)}</span>
                </div>
                {s.symptom === NONE_SYMPTOM ? (
                  <span className="severity-badge none-badge">✓</span>
                ) : (
                  <span className="severity-badge" style={{ background: SEVERITY_COLORS[s.severity], marginLeft: 6 }}>{s.severity}</span>
                )}
                <ConfirmDelete onConfirm={() => handleDelete(s.id)}>✕</ConfirmDelete>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Nutrition                                                               */
/* ---------------------------------------------------------------------- */

const MEAL_SLOTS = [
  { key: "breakfast", label: "בוקר", icon: "🌅" },
  { key: "lunch", label: "צהריים", icon: "☀️" },
  { key: "dinner", label: "ערב", icon: "🌙" },
  { key: "snacks", label: "נשנושים", icon: "🍎" },
];

function emptyNutritionForm() {
  return { water: "", protein: "", breakfast: "", lunch: "", dinner: "", snacks: "", note: "" };
}

function NutritionTab({ data, updateData, showToast }) {
  const [date, setDate] = useState(todayISO());
  const [form, setForm] = useState(() => {
    const e = data.nutrition.find((n) => n.date === todayISO());
    return e ? { water: e.water ?? "", protein: e.protein ?? "", breakfast: e.breakfast ?? "", lunch: e.lunch ?? "", dinner: e.dinner ?? "", snacks: e.snacks ?? "", note: e.note ?? "" } : emptyNutritionForm();
  });
  const formTopRef = useRef(null);

  const existing = data.nutrition.find((n) => n.date === date);

  useEffect(() => {
    const e = data.nutrition.find((n) => n.date === date);
    setForm(e ? { water: e.water ?? "", protein: e.protein ?? "", breakfast: e.breakfast ?? "", lunch: e.lunch ?? "", dinner: e.dinner ?? "", snacks: e.snacks ?? "", note: e.note ?? "" } : emptyNutritionForm());
    // eslint-disable-next-line
  }, [date]);

  const sorted = [...data.nutrition].sort((a, b) => b.date.localeCompare(a.date));

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSave() {
    const entry = {
      id: existing ? existing.id : uid(),
      date,
      water: form.water === "" ? null : parseFloat(form.water),
      protein: form.protein === "" ? null : parseFloat(form.protein),
      breakfast: form.breakfast.trim(),
      lunch: form.lunch.trim(),
      dinner: form.dinner.trim(),
      snacks: form.snacks.trim(),
      note: form.note.trim(),
    };
    updateData((d) => ({ ...d, nutrition: [...d.nutrition.filter((n) => n.date !== date), entry] }));
    showToast(existing ? "היום עודכן" : "הרישום היומי נשמר");
  }

  function handleDelete(id) {
    updateData((d) => ({ ...d, nutrition: d.nutrition.filter((n) => n.id !== id) }));
  }

  function handleEdit(entry) {
    setDate(entry.date);
    if (formTopRef.current) formTopRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="screen">
      <div className="card" ref={formTopRef}>
        <h2>תפריט יומי {existing ? <span className="muted">— עריכת יום קיים</span> : null}</h2>
        <div className="field">
          <label>תאריך</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>שתייה (כוסות)</label>
            <input type="number" inputMode="numeric" value={form.water} onChange={(e) => setField("water", e.target.value)} placeholder="0" />
          </div>
          <div className="field">
            <label>חלבון (גרם)</label>
            <input type="number" inputMode="numeric" value={form.protein} onChange={(e) => setField("protein", e.target.value)} placeholder="0" />
          </div>
        </div>

        {MEAL_SLOTS.map((slot) => (
          <div className="field" key={slot.key}>
            <label>{slot.icon} {slot.label}</label>
            <textarea
              className="meal-input"
              value={form[slot.key]}
              onChange={(e) => setField(slot.key, e.target.value)}
              placeholder={`מה אכלת ב${slot.label}...`}
            />
          </div>
        ))}

        <div className="field">
          <label>הערות נוספות (לא חובה)</label>
          <textarea value={form.note} onChange={(e) => setField("note", e.target.value)} placeholder="תחושות, תיאבון, כל דבר נוסף..." />
        </div>
        <button className="btn-primary" onClick={handleSave}>
          {existing ? "עדכון" : "שמירת"} יום {formatDateHe(date)}
        </button>
      </div>

      <div className="section-title">היסטוריה ({sorted.length})</div>
      {sorted.length === 0 ? (
        <div className="card"><EmptyState text="עדיין אין רישומי תזונה" /></div>
      ) : (
        <div className="card">
          <div className="entry-list">
            {sorted.map((n) => (
              <div className="nutrition-entry" key={n.id}>
                <div className="nutrition-entry-header">
                  <span className="date">{formatDateHe(n.date)}</span>
                  <div className="nutrition-entry-actions">
                    <button className="edit-btn" onClick={() => handleEdit(n)}>עריכה</button>
                    <ConfirmDelete onConfirm={() => handleDelete(n.id)}>✕</ConfirmDelete>
                  </div>
                </div>
                {(n.water || n.protein) && (
                  <div className="nutrition-badges">
                    {n.water ? <span className="badge">💧 {n.water} כוסות</span> : null}
                    {n.protein ? <span className="badge">🥩 {n.protein} גרם</span> : null}
                  </div>
                )}
                {MEAL_SLOTS.some((s) => n[s.key]) && (
                  <div className="meal-rows">
                    {MEAL_SLOTS.map((s) => n[s.key] ? (
                      <div className="meal-row" key={s.key}>
                        <span className="meal-icon">{s.icon}</span>
                        <span className="meal-label">{s.label}:</span>
                        <span className="meal-text">{n[s.key]}</span>
                      </div>
                    ) : null)}
                  </div>
                )}
                {n.note && <div className="nutrition-note">{n.note}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Notes                                                                    */
/* ---------------------------------------------------------------------- */

function NotesTab({ data, updateData, showToast }) {
  const [text, setText] = useState("");
  const sorted = [...data.notes].sort((a, b) => b.date.localeCompare(a.date));

  function handleAdd() {
    if (!text.trim()) { showToast("נא לכתוב הערה"); return; }
    const entry = { id: uid(), date: new Date().toISOString(), text: text.trim() };
    updateData((d) => ({ ...d, notes: [...d.notes, entry] }));
    setText("");
    showToast("ההערה נשמרה");
  }

  function handleDelete(id) {
    updateData((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) }));
  }

  return (
    <div className="screen">
      <div className="card">
        <h2>הערה חופשית</h2>
        <div className="field">
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="איך את מרגישה היום?" rows={4} />
        </div>
        <button className="btn-primary" onClick={handleAdd}>שמירת הערה</button>
      </div>

      <div className="section-title">הערות קודמות ({sorted.length})</div>
      {sorted.length === 0 ? (
        <div className="card"><EmptyState text="עדיין אין הערות" /></div>
      ) : (
        <div className="card">
          <div className="entry-list">
            {sorted.map((n) => (
              <div className="entry" key={n.id} style={{ alignItems: "flex-start" }}>
                <div className="meta">
                  <span className="main">{n.text}</span>
                  <span className="sub">{new Date(n.date).toLocaleString("he-IL")}</span>
                </div>
                <ConfirmDelete onConfirm={() => handleDelete(n.id)}>✕</ConfirmDelete>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Settings                                                                 */
/* ---------------------------------------------------------------------- */

function SettingsTab({ data, updateData, showToast }) {
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );

  function handleIntervalChange(e) {
    const val = parseInt(e.target.value, 10) || 1;
    updateData((d) => ({ ...d, settings: { ...d.settings, intervalDays: val } }));
  }

  async function toggleReminders() {
    if (!data.settings.reminderEnabled) {
      if (typeof Notification !== "undefined") {
        const perm = await Notification.requestPermission();
        setNotifPermission(perm);
        if (perm !== "granted") {
          showToast("ההרשאה להתראות לא אושרה");
          return;
        }
      }
      updateData((d) => ({ ...d, settings: { ...d.settings, reminderEnabled: true } }));
      showToast("תזכורות הופעלו");
    } else {
      updateData((d) => ({ ...d, settings: { ...d.settings, reminderEnabled: false } }));
      showToast("תזכורות כבויות");
    }
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `glp1-tracker-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("הקובץ יוצא בהצלחה");
  }

  function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        updateData(() => ({ ...structuredCloneSafe(DEFAULT_DATA), ...imported, settings: { ...DEFAULT_DATA.settings, ...(imported.settings || {}) } }));
        showToast("הנתונים יובאו בהצלחה");
      } catch (err) {
        showToast("שגיאה בייבוא הקובץ");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleClearAll() {
    updateData(() => structuredCloneSafe(DEFAULT_DATA));
    clearAllPhotoBlobs();
    showToast("כל הנתונים נמחקו");
  }

  return (
    <div className="screen">
      <div className="privacy-note">
        <span>🔒</span>
        <span>כל הנתונים שלך נשמרים אך ורק על המכשיר הזה (localStorage). שום מידע לא נשלח לשרת חיצוני.</span>
      </div>

      <div className="card">
        <h2>תזכורות</h2>
        <div className="settings-row">
          <span>מרווח בין זריקות (ימים)</span>
          <input type="number" style={{ width: 64, textAlign: "center", border: "1px solid #e5e7eb", borderRadius: 8, padding: 6 }} value={data.settings.intervalDays} onChange={handleIntervalChange} />
        </div>
        <div className="settings-row">
          <span>התראות דפדפן {notifPermission === "unsupported" ? "(לא נתמך במכשיר זה)" : ""}</span>
          <button className={`switch ${data.settings.reminderEnabled ? "on" : ""}`} onClick={toggleReminders} disabled={notifPermission === "unsupported"}>
            <span className="knob" />
          </button>
        </div>
        <div className="empty-state" style={{ padding: "8px 0 0", textAlign: "right" }}>
          התראות דפדפן יעבדו רק כשהאפליקציה פתוחה בטאב.
        </div>
      </div>

      <div className="card">
        <h2>ניהול נתונים</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button className="btn-secondary" onClick={handleExport}>ייצוא נתונים (JSON)</button>
          <label className="btn-secondary" style={{ display: "block", textAlign: "center" }}>
            ייבוא נתונים
            <input type="file" accept="application/json" onChange={handleImport} style={{ display: "none" }} />
          </label>
          <ConfirmDeleteAll onConfirm={handleClearAll} />
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteAll({ onConfirm }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <button className="btn-danger" onClick={() => { onConfirm(); setConfirming(false); }}>
        לאשר מחיקת כל הנתונים
      </button>
    );
  }
  return (
    <button className="btn-danger" onClick={() => setConfirming(true)}>
      מחיקת כל הנתונים
    </button>
  );
}

/* ---------------------------------------------------------------------- */
/* Root App                                                                 */
/* ---------------------------------------------------------------------- */

function App() {
  const [data, setData] = useState(loadData);
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const notifiedRef = useRef(false);

  useEffect(() => { saveData(data); }, [data]);

  const updateData = useCallback((updater) => {
    setData((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }, []);

  // Best-effort reminder check while the tab is open
  useEffect(() => {
    if (!data.settings.reminderEnabled || typeof Notification === "undefined") return;
    const check = () => {
      const last = data.injections[data.injections.length - 1];
      if (!last) return;
      const nextDue = addDaysISO(last.date, data.settings.intervalDays);
      if (todayISO() >= nextDue && !notifiedRef.current && Notification.permission === "granted") {
        new Notification("תזכורת GLP-1", { body: "הגיע הזמן לזריקה הבאה שלך" });
        notifiedRef.current = true;
      }
    };
    check();
    const interval = setInterval(check, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [data.settings.reminderEnabled, data.settings.intervalDays, data.injections]);

  useEffect(() => { notifiedRef.current = false; }, [data.injections.length]);

  const screens = {
    dashboard: <Dashboard data={data} showToast={showToast} onNavigate={setTab} />,
    injections: <InjectionsTab data={data} updateData={updateData} showToast={showToast} />,
    weight: <WeightTab data={data} updateData={updateData} showToast={showToast} />,
    photos: <PhotosTab data={data} updateData={updateData} showToast={showToast} />,
    sideEffects: <SideEffectsTab data={data} updateData={updateData} showToast={showToast} />,
    nutrition: <NutritionTab data={data} updateData={updateData} showToast={showToast} />,
    notes: <NotesTab data={data} updateData={updateData} showToast={showToast} />,
    settings: <SettingsTab data={data} updateData={updateData} showToast={showToast} />,
  };

  return (
    <React.Fragment>
      <header className="app-header">
        <div className="header-inner">
          <h1>המעקב של מיכל לייבה</h1>
          <p className="subtitle">יומן GLP-1 אישי — הנתונים שלך נשארים איתך בלבד</p>
        </div>
        <WaveDivider />
      </header>

      {screens[tab]}

      <nav className="tab-bar">
        {TABS.map((t) => (
          <button key={t.key} className={`tab-btn ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            <span className="ic">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <Toast message={toast} />
    </React.Fragment>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
