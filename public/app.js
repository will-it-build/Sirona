import { validateRecord } from './validation.js';
import { RecordStore } from './sync.js';
let engine = null;
let currentUser = null;
let repainting = false;
let deviceError = '';
const store = {
  load() { return { sessions: [], pendingDeletes: [] }; },
  save(value) {
    if (!engine) return;
    for (const session of value.sessions) engine.put('session:' + session.id, session);
  },
};
function updateSaveStatus() {
  const el = document.getElementById('saveStatus');
  if (!el) return;
  const conflicts = engine ? Object.keys(engine.conflicts).length : 0;
  const pending = engine ? Object.keys(engine.pending).length : 0;
  el.textContent = deviceError || engine?.error || (conflicts ? 'Changes need your review.' : engine?.busy ? 'Saving…' : pending ? 'Saved on this device · waiting to sync' : currentUser ? 'All changes saved' : 'Sign in to save your workouts');
  document.getElementById('syncDot').className = 'sync-dot ' + (deviceError || engine?.error || conflicts ? 'err' : pending ? 'local' : 'ok');
  document.getElementById('retrySync').hidden = !engine || (!pending && !engine.error);
  document.getElementById('reviewConflicts').hidden = !conflicts;
}
const sync = {
  loggedIn: false,
  canSync() { return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'; },
  dot() { updateSaveStatus(); },
  async api(path, method = 'GET', data, userId = currentUser?.id) {
    const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(userId ? { 'X-Sirona-User': userId } : {}) },
      body: data ? JSON.stringify(data) : undefined,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if ((response.status === 401 || (response.status === 409 && !result.conflict)) && path.startsWith('/api/v2/')) {
        if (engine) engine.active = false;
        showAuth('login');
      }
      throw Object.assign(new Error(result.error || 'Could not reach the server.'), { status: response.status, data: result });
    }
    return result;
  },
  async pull() {
    const active = engine;
    if (!active || !this.loggedIn) return;
    await active.sync();
    if (active !== engine || !active.active) return;
    state.sessions = active.sessions();
    const nextDraft = active.get('draft:active');
    if (nextDraft && JSON.stringify(nextDraft) !== JSON.stringify({ ...draft, meta: readMeta() })) {
      repainting = true;
      draft = nextDraft;
      applyMeta(draft.meta || {});
      renderDayRow(); renderExercises(); renderPicker();
      repainting = false;
    }
    hydrateTodayPlan();
    renderHistory(); renderWeek(); renderProgress();
    updateSaveStatus();
  },
  push() { return this.pull(); },
  remove(id) {
    if (!engine) return;
    engine.put('session:' + id, null, true);
    state.sessions = engine.sessions();
    void this.push();
  },
};
let authMode = 'login';
let signupAvailable = false;
let resetToken = '';
let releaseTab = null;
async function claimTab() {
  if (releaseTab || !navigator.locks) return;
  await new Promise((resolve, reject) => {
    void navigator.locks.request('sirona-editor', { ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error('GymSpear is open in another tab. Close that tab, then try again.')); return; }
      await new Promise(release => { releaseTab = release; resolve(); });
      releaseTab = null;
    });
  });
}
function setShell(on, hasSession) {
  document.getElementById('view-auth').hidden = on;
  document.getElementById('appNav').hidden = !on;
  document.getElementById('appMain').hidden = !on;
  document.getElementById('logoutBtn').hidden = !on || !hasSession;
  if (!on) { document.getElementById('restBar').hidden = true; document.body.classList.remove('resting'); }
}
function authErr(message) {
  const el = document.getElementById('authErr'); el.hidden = !message; el.textContent = message || '';
}
function showAuth(mode) {
  authMode = mode;
  sync.loggedIn = false;
  setShell(false, false);
  authErr('');
  document.getElementById('authNote').hidden = true;
  document.getElementById('authEmailWrap').hidden = mode !== 'signup';
  document.getElementById('authUserWrap').hidden = mode === 'reset';
  document.getElementById('authPassWrap').hidden = mode === 'forgot';
  document.getElementById('authPass2Wrap').hidden = !['signup', 'reset'].includes(mode);
  document.getElementById('authForgotBtn').hidden = mode !== 'login';
  document.getElementById('authSignupBtn').hidden = mode !== 'login' || !signupAvailable;
  document.getElementById('authBackBtn').hidden = mode === 'login';
  const labels = {
    login: ['Welcome back', 'Sign in to your private training log.', 'Log in'],
    signup: ['Build your routine', 'Your workouts, your account. Create a free training log.', 'Create account'],
    forgot: ['Reset your password', 'Enter your username or email to request a recovery link.', 'Send reset link'],
    reset: ['Choose a new password', 'Use at least 12 characters.', 'Save password'],
  };
  const [title, lead, button] = labels[mode];
  document.getElementById('authTitle').textContent = title;
  document.getElementById('authLead').textContent = lead;
  document.getElementById('authGo').textContent = button;
  document.getElementById('authPass').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  document.getElementById('authPass').value = '';
  document.getElementById('authPass2').value = '';
}
function applyMeta(meta) {
  const ids = { mBw: 'bodyweight', mSleep: 'sleep', mCommute: 'commute', mCommuteTime: 'commuteTime', mFeel: 'feel' };
  for (const [id, key] of Object.entries(ids)) document.getElementById(id).value = meta[key] ?? '';
}
async function activate(user) {
  await claimTab();
  if (engine) engine.active = false;
  currentUser = user;
  deviceError = '';
  engine = new RecordStore(user, localStorage, (path, method, data) => sync.api(path, method, data, user.id), updateSaveStatus);
  localStorage.setItem('sirona-active-user', JSON.stringify(user));
  state = { sessions: engine.sessions(), pendingDeletes: [] };
  draft = engine.get('draft:active') || { day: guessDay(), entries: [] };
  openEx = new Set();
  planEdit = null;
  clearRest();
  closePlanEditor();
  applyMeta(draft.meta || {});
  sync.loggedIn = true;
  setShell(true, true);
  document.getElementById('accountName').textContent = user.username;
  document.getElementById('exportLegacyBtn').hidden = !user.legacyOwner || !localStorage.getItem('sirona-v1');
  repainting = true;
  renderDayRow(); renderExercises(); renderPicker(); renderHistory(); renderWeek(); renderProgress();
  repainting = false;
  updateSaveStatus();
  await sync.pull();
}
async function submitAuth(event) {
  event.preventDefault();
  const button = document.getElementById('authGo');
  if (button.disabled) return;
  button.disabled = true;
  authErr('');
  try {
    const username = document.getElementById('authUser').value.trim();
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPass').value;
    if (['signup', 'reset'].includes(authMode) && password !== document.getElementById('authPass2').value) throw new Error('Passwords do not match.');
    if (authMode === 'forgot') {
      await sync.api('/api/forgot-password', 'POST', { username });
      const note = document.getElementById('authNote'); note.hidden = false;
      note.textContent = 'If that account exists, a reset link will be sent. Check your inbox and spam folder. The link expires in one hour.';
      return;
    }
    await claimTab();
    const endpoint = authMode === 'reset' ? '/api/reset-password' : '/api/' + authMode;
    const response = await sync.api(endpoint, 'POST', { username, email, password, token: resetToken });
    if (resetToken) { resetToken = ''; history.replaceState({}, '', location.pathname); }
    document.getElementById('authPass').value = '';
    document.getElementById('authPass2').value = '';
    await activate(response.user);
  } catch (error) { authErr(error.message); }
  finally { button.disabled = false; }
}
async function logout() {
  if (engine && Object.keys(engine.pending).length && !confirm('Some changes are only on this device. Log out and keep them here for your next sign-in?')) return;
  try { await sync.api('/api/logout', 'POST', {}); }
  catch { alert('Could not log out securely. Reconnect and try again.'); return; }
  if (engine) engine.active = false;
  engine = null; currentUser = null;
  localStorage.removeItem('sirona-active-user');
  state = store.load(); draft = { day: 'Push', entries: [] };
  clearMeta(); clearRest();
  document.getElementById('conflictDialog').close();
  showAuth('login'); updateSaveStatus();
}
async function bootAuth() {
  resetToken = new URLSearchParams(location.search).get('reset') || '';
  if (resetToken) { showAuth('reset'); return; }
  try { const result = await sync.api('/api/me'); await activate(result.user); }
  catch (error) {
    if (error.status === 401) signupAvailable = error.data?.signup === true;
    showAuth('login');
    if (error.status === 401) return;
    // A cached account is used only after a successful earlier sign-in on this device.
    try {
      const user = JSON.parse(localStorage.getItem('sirona-active-user') || 'null');
      if (!error.status && user) { await activate(user); return; }
    } catch { /* Storage or another open tab is unavailable. */ }
    authErr(error.message || 'Connect to the internet to sign in.');
  }
}
function saveDraft() {
  if (repainting || !engine?.active || !sync.loggedIn) return;
  if (!draft.id) draft.id = crypto.randomUUID();
  try { engine.put('draft:active', { ...draft, meta: readMeta() }); }
  catch (error) { deviceError = error.message; updateSaveStatus(); }
}
function updateExerciseNote(index, note) { draft.entries[index].note = note; saveDraft(); }
function reviewConflicts() {
  const body = document.getElementById('conflictBody'); body.replaceChildren();
  for (const [key, conflict] of Object.entries(engine?.conflicts || {})) {
    const section = document.createElement('section');
    const local = engine.pending[key];
    const title = document.createElement('h3');
    title.textContent = key === 'draft:active' ? 'Workout in progress' : (local.data?.day || 'Workout') + ' session';
    const summary = document.createElement('p');
    const describe = value => value?.deleted ? 'deleted' : `${value?.data?.entries?.reduce((n, e) => n + e.sets.length, 0) || 0} sets`;
    summary.textContent = `This device: ${describe(local)}. Server: ${describe(conflict.remote)}. Choose the version to keep.`;
    section.append(title, summary);
    for (const [choice, label] of [['server', 'Use server version'], ['local', conflict.remote?.deleted && !local.deleted ? 'Save mine as a new session' : 'Keep this device’s version']]) {
      const button = document.createElement('button'); button.textContent = label;
      button.addEventListener('click', async () => { engine.resolve(key, choice); await sync.pull(); reviewConflicts(); });
      section.append(button);
    }
    body.append(section);
  }
  const dialog = document.getElementById('conflictDialog');
  if (!Object.keys(engine?.conflicts || {}).length) { dialog.close(); return; }
  if (!dialog.open) dialog.showModal();
}

/* ============================================================
   Exercise menus — from the paper log (source of truth).
   ============================================================ */
const MENU = {
  Push: {
    'Chest Compounds': ['Incline Barbell Bench Press','Incline Dumbbell Press','Flat Barbell Bench Press','Flat Dumbbell Press','Machine Chest Press','Decline Press','Cable Chest Press','Push-ups (weighted / elevated)','Push-ups'],
    'Chest Isolation': ['Dumbbell Flyes (flat)','Dumbbell Flyes (incline)','Cable Flyes (high-to-low)','Cable Flyes (mid)','Cable Flyes (low-to-high)','Pec Deck / Machine Fly','Single-arm Cable Crossover'],
    'Shoulder Compounds': ['Seated Dumbbell Shoulder Press','Standing Dumbbell Shoulder Press','Machine Shoulder Press','Barbell Overhead Press','Arnold Press'],
    'Side & Rear Delts': ['Dumbbell Lateral Raises','Cable Lateral Raises (low pulley)','High-Cable Lateral Raises','Machine Lateral Raise','Face Pulls','Rear Delt Flyes (dumbbell)','Rear Delt Flyes (cable)'],
    'Triceps': ['Cable Tricep Pushdown (bar)','Cable Tricep Pushdown (V-bar)','Cable Tricep Pushdown (rope)','Overhead Cable Extension','Dumbbell Overhead Extension','Skull Crushers','Close-Grip Bench Press','Dips','Bench Dips','Single-arm Cable Kickback'],
    'Arms (optional)': ['Dumbbell Curls','Hammer Curls'],
  },
  Pull: {
    'Vertical Pulls': ['Lat Pulldown (wide)','Lat Pulldown (close)','Lat Pulldown (neutral)','Pull-ups / Chin-ups (assisted or full)','Single-arm Lat Pulldown','Straight-arm Cable Pulldown','Dumbbell Pullovers'],
    'Horizontal Rows': ['Seated Cable Row','Chest-Supported Row','Bent-Over Barbell Row','Single-arm Dumbbell Row','T-Bar Row','Machine Row','Ring Rows'],
    'Upper Back & Rear Delts': ['Face Pulls','High-Cable Reverse Fly','Dumbbell Rear Delt Fly','Cable Rear Delt Fly','Shrugs'],
    'Biceps': ['EZ-Bar Curls','Straight-Bar Curls','Dumbbell Curls','Incline Dumbbell Curls','Hammer Curls','Cable Curls','Concentration Curls','Preacher Curls','Spider Curls'],
    'Forearms': ['Wrist Curls (palm up)','Wrist Curls (palm down)'],
  },
  Legs: {
    'Quad Dominant': ['Barbell Back Squat','Goblet Squat','Leg Press','Hack Squat','Front Squat','Bulgarian Split Squat','Walking Lunges','Reverse Lunges','Step-ups','Leg Extension'],
    'Hamstring & Glute Dominant': ['Romanian Deadlift (barbell)','Romanian Deadlift (dumbbell)','Conventional Deadlift','Sumo Deadlift','Stiff-Leg Deadlift','Leg Curl (lying)','Leg Curl (seated)','Hip Thrust','Glute Bridge','Cable Pull-Through','Single-leg RDL'],
    'Calves': ['Standing Calf Raise','Seated Calf Raise','Leg-Press Calf Raise','Single-leg Calf Raise'],
  },
};
const CORE = ['Hanging Knee Raises','Hanging Leg Raises','Cable Woodchoppers','Plank variations','Ab Wheel','Pallof Press','Farmer Carries','Pillow Pass'];
const CUSTOM = 'Custom…';

/* ---------- state ---------- */
const DAYS = ['Push','Pull','Legs'];
let state = store.load();
if(state.sessions) state.sessions.sort((a,b)=> (b.date||'').localeCompare(a.date||''));
let draft = { day: guessDay(), entries: [] };
let openEx = new Set(); // expanded exercise indices on Today
let planEdit = null; // { dateKey, id?, day, entries, notes }

function isPlanned(s){ return s.status === 'planned'; }
function isDone(s){ return !isPlanned(s); } // missing status = done (pre-planner logs)
function dateKey(isoOrDate){
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return y + '-' + m + '-' + day;
}
function parseKey(key){
  const [y,m,d] = key.split('-').map(Number);
  return new Date(y, m-1, d);
}
function atNoon(key){
  const d = parseKey(key);
  d.setHours(12,0,0,0);
  return d.toISOString();
}
function todayKey(){ return dateKey(new Date()); }
function planFor(key){ return state.sessions.find(s => isPlanned(s) && dateKey(s.date) === key); }
function doneOn(key){ return state.sessions.filter(s => isDone(s) && dateKey(s.date) === key); }

function guessDay(){
  const last = state.sessions.find(isDone);
  if(!last) return 'Push';
  const i = DAYS.indexOf(last.day);
  return DAYS[(i+1) % DAYS.length] || 'Push';
}

/* ---------- helpers ---------- */
function lastPerformance(name){
  for(const s of state.sessions){
    if(!isDone(s) || !s.entries) continue;
    const e = s.entries.find(e => e.exercise.toLowerCase() === name.toLowerCase());
    if(e && e.sets.length){
      const best = e.sets.reduce((a,b)=> (b.w > a.w ? b : a));
      return {date:s.date, best, sets:e.sets.length};
    }
  }
  return null;
}
function fmtDate(iso){
  return new Date(iso).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
}
function esc(s){ const d=document.createElement('div'); d.textContent=s ?? ''; return d.innerHTML.replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

/* ---------- plate math (20kg bar, per-side) ---------- */
const PLATES = [25,20,15,10,5,2.5,1.25];
function plateBreakdown(total){
  const perSide = (total - 20) / 2;
  if(perSide < 0) return null;
  let rem = perSide, out = [];
  for(const p of PLATES){ while(rem >= p - 1e-9){ out.push(p); rem -= p; } }
  return { plates: out, exact: rem < 1e-9 };
}
function renderPlates(el, val){
  const w = parseFloat(val);
  if(!Number.isFinite(w) || w < 20 || w > 2000){ el.classList.remove('show'); return; }
  const b = plateBreakdown(w);
  el.classList.add('show');
  if(!b){ el.textContent = 'Below bar weight (20 kg)'; return; }
  const cls = p => 'pl pl-' + String(p).replace('.','_');
  el.innerHTML =
    '<div class="sum">' + (b.exact ? '' : '≈ ') + '<b>' + w + ' kg</b> = bar + ' +
      (b.plates.length ? b.plates.join(' + ') + ' per side' : 'empty') +
      (b.exact ? '' : ' (nearest loadable)') + '</div>' +
    '<div class="bar-line"><span class="sleeve"></span>' +
      b.plates.map(p => '<span class="' + cls(p) + '"></span>').join('') +
    '</div>';
}

/* ---------- day + picker ---------- */
function renderDayRow(){
  document.getElementById('dayRow').innerHTML = DAYS.map(d =>
    '<button class="' + (draft.day===d?'on':'') + '" onclick="setDay(\'' + d + '\')">' + d + '</button>'
  ).join('');
}
function setDay(d){ draft.day = d; renderDayRow(); renderPicker(); saveDraft(); }

function groupsForDay(day){
  return Object.keys(MENU[day || draft.day]).concat(['Core (optional)']);
}
function exercisesForGroup(g, day){
  if(g === 'Core (optional)') return CORE.slice();
  return (MENU[day || draft.day][g] || []).slice();
}
function renderPicker(){
  const gSel = document.getElementById('pGroup');
  gSel.innerHTML = '<option value="" disabled selected>Muscle group…</option>' +
    groupsForDay().map(g => '<option>' + esc(g) + '</option>').join('');
  const eSel = document.getElementById('pEx');
  eSel.innerHTML = '<option value="" disabled selected>Exercise…</option>';
  document.getElementById('pCustom').hidden = true;
  document.getElementById('pCustom').value = '';
  updateAddBtn();
}
function onGroupChange(){
  const g = document.getElementById('pGroup').value;
  const eSel = document.getElementById('pEx');
  eSel.innerHTML = '<option value="" disabled selected>Exercise…</option>' +
    exercisesForGroup(g).map(x => '<option>' + esc(x) + '</option>').join('') +
    '<option>' + CUSTOM + '</option>';
  document.getElementById('pCustom').hidden = true;
  updateAddBtn();
}
function onExChange(){
  const isCustom = document.getElementById('pEx').value === CUSTOM;
  const c = document.getElementById('pCustom');
  c.hidden = !isCustom;
  if(isCustom) c.focus();
  updateAddBtn();
}
function updateAddBtn(){
  const g = document.getElementById('pGroup').value;
  const x = document.getElementById('pEx').value;
  const c = document.getElementById('pCustom').value.trim();
  document.getElementById('pAdd').disabled = !g || !x || (x === CUSTOM && !c);
}
document.addEventListener('input', e => { if(e.target.id === 'pCustom') updateAddBtn(); });

function addExercise(){
  const g = document.getElementById('pGroup').value;
  let x = document.getElementById('pEx').value;
  if(x === CUSTOM) x = document.getElementById('pCustom').value.trim();
  if(!g || !x) return;
  draft.entries.push({exercise:x, group:g, sets:[], note:''});
  openEx.add(draft.entries.length - 1);
  if(rest && !rest.done && rest.fromEi === draft.entries.length - 2) promoteRestSwitch();
  renderExercises();
  renderPicker();
}

/* ---------- rest timer (session UI) ---------- */
const REST_MIN = 30;
const REST_MAX = 120;
const REST_SAME = 60;
const REST_SWITCH = 90;
let restKindPref = 'same';
let restSecs = { same: REST_SAME, switch: REST_SWITCH };
let rest = null; // { start, endsAt, duration, kind, fromEi, tick, done, hideAt }

function clampRest(n){
  n = parseInt(n, 10);
  if(!Number.isFinite(n)) n = REST_SAME;
  return Math.max(REST_MIN, Math.min(REST_MAX, n));
}
function restKindAfterSet(ei){
  const e = draft.entries[ei];
  if(!e) return 'same';
  const later = draft.entries.slice(ei + 1);
  if(!later.length) return 'same';
  const last = lastPerformance(e.exercise);
  if(last && e.sets.length === last.sets) return 'switch';
  return 'same';
}
function restNextName(fromEi){
  const n = draft.entries[fromEi + 1];
  return n ? n.exercise : '';
}
function restCurrentEi(){
  const open = [...openEx].filter(i => i >= 0).sort((a,b)=> a-b);
  if(open.length) return open[0];
  return draft.entries.length ? 0 : -1;
}
function fmtRest(secs){
  const s = Math.max(0, Math.ceil(secs));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2,'0');
}
function restRemaining(){
  if(!rest) return restSecs[restKindPref];
  return Math.max(0, (rest.endsAt - Date.now()) / 1000);
}
function sessionLoggerOpen(){
  const auth = document.getElementById('view-auth');
  if(auth && !auth.hidden) return false;
  const today = document.getElementById('view-today');
  const main = document.getElementById('appMain');
  return !!(today && !today.hidden && main && !main.hidden);
}
function announceRest(msg){
  const el = document.getElementById('restAnnouncer');
  if(!el) return;
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = msg; });
}
function paintRestSlider(kind, secs){
  const slider = document.getElementById('restSlider');
  const label = document.getElementById('restSecs');
  if(slider) slider.value = String(secs);
  if(label) label.textContent = secs + 's';
  if(slider) slider.disabled = !!(rest && rest.done);
}
function startRest(ei, kind){
  if(rest && rest.tick) clearInterval(rest.tick);
  restKindPref = kind === 'switch' ? 'switch' : 'same';
  const duration = restSecs[restKindPref];
  const start = Date.now();
  rest = {
    start, duration, kind: restKindPref, fromEi: ei, done: false,
    endsAt: start + duration * 1000,
    tick: setInterval(updateRestBar, 200)
  };
  updateRestBar();
  announceRest(restKindPref === 'switch'
    ? 'Rest ' + duration + ' seconds, next exercise'
    : 'Rest ' + duration + ' seconds, between sets');
}
function applyKindDuration(kind){
  restKindPref = kind;
  if(!rest || rest.done){ updateRestBar(); return; }
  rest.kind = kind;
  rest.duration = restSecs[kind];
  rest.endsAt = rest.start + rest.duration * 1000;
  updateRestBar();
}
function promoteRestSwitch(){
  if(!rest || rest.done || rest.kind === 'switch') return;
  applyKindDuration('switch');
}
function toggleRestKind(){
  if(rest && rest.done) return;
  applyKindDuration(restKindPref === 'same' ? 'switch' : 'same');
}
function setRestSeconds(val){
  const secs = clampRest(val);
  restSecs[restKindPref] = secs;
  if(rest && !rest.done){
    rest.duration = secs;
    rest.endsAt = rest.start + secs * 1000;
  }
  updateRestBar();
}
function skipRest(){
  if(!rest){
    startRest(restCurrentEi(), restKindPref);
    return;
  }
  clearRest();
}
function clearRest(){
  if(rest && rest.tick) clearInterval(rest.tick);
  rest = null;
  updateRestBar();
}
function restEnds(){
  if(!rest || rest.done) return;
  rest.done = true;
  rest.hideAt = Date.now() + 5000;
  try{ navigator.vibrate && navigator.vibrate([40, 50, 80]); }catch(e){}
  announceRest('Rest done');
}
function updateRestBar(){
  const bar = document.getElementById('restBar');
  if(!bar) return;
  if(!sessionLoggerOpen()){
    bar.hidden = true;
    document.body.classList.remove('resting');
    return;
  }
  if(rest && !rest.done && restRemaining() <= 0) restEnds();
  if(rest && rest.done && rest.hideAt && Date.now() >= rest.hideAt){
    if(rest.tick) clearInterval(rest.tick);
    rest = null;
  }
  const kind = rest ? rest.kind : restKindPref;
  const chosen = rest && !rest.done ? rest.duration : restSecs[kind];
  document.body.classList.add('resting');
  bar.hidden = false;
  bar.classList.toggle('go', !!(rest && rest.done));
  document.getElementById('restLabel').textContent = (rest && rest.done) ? 'Go' : 'Rest';
  document.getElementById('restTime').textContent = (rest && rest.done)
    ? '0:00'
    : fmtRest(rest ? restRemaining() : chosen);
  const kindBtn = document.getElementById('restKind');
  const next = restNextName(rest ? rest.fromEi : restCurrentEi());
  kindBtn.textContent = (rest && rest.done)
    ? 'Ready'
    : (kind === 'switch'
      ? (next ? 'Next · ' + next : 'Next exercise')
      : 'Between sets');
  kindBtn.disabled = !!(rest && rest.done);
  document.getElementById('restSkip').textContent = !rest ? 'Start' : (rest.done ? 'OK' : 'Skip');
  paintRestSlider(kind, chosen);
  const fill = document.getElementById('restFill');
  if(!rest) fill.style.width = '100%';
  else if(rest.done) fill.style.width = '0';
  else {
    const pct = Math.max(0, Math.min(1, restRemaining() / rest.duration));
    fill.style.width = (pct * 100) + '%';
  }
}
document.addEventListener('visibilitychange', () => { updateRestBar(); });

/* ---------- exercises ---------- */
let hydrating = false;
let hydrateGen = 0;
function renderExercises(){
  const wrap = document.getElementById('exercises');
  wrap.innerHTML = '';
  hydrating = true;
  const gen = ++hydrateGen;
  draft.entries.forEach((e, ei) => {
    const last = lastPerformance(e.exercise);
    const card = document.createElement('details');
    card.className = 'exercise';
    if(openEx.has(ei)) card.open = true;
    card.innerHTML =
      '<summary>' +
        '<span class="ex-name">' + esc(e.exercise) + '</span>' +
        '<span class="chev" aria-hidden="true"></span>' +
        '<button type="button" class="set-del" onclick="event.preventDefault();event.stopPropagation();removeExercise(' + ei + ')" aria-label="Remove exercise">×</button>' +
      '</summary>' +
      '<div class="ex-group">' + esc(e.group) + '</div>' +
      (last
        ? '<div class="ex-last">last: <b>' + last.best.w + ' kg × ' + last.best.r + '</b> · ' + last.sets + ' sets · ' + fmtDate(last.date) + '</div>'
        : '<div class="ex-last">first time — set the marker</div>') +
      '<div class="sets">' +
        e.sets.map((s, si) =>
          '<div class="set-row"><span class="set-n">' + (si+1) + '</span>' +
          '<span class="set-val"><b>' + s.w + '</b> kg × <b>' + s.r + '</b></span>' +
          (s.rpe ? '<span class="set-rpe">RPE ' + s.rpe + '</span>' : '') +
          (last && e1rm(s.w, s.r) > e1rm(last.best.w, last.best.r) ? '<span class="set-beat">▲ beat</span>' : '') +
          '<button class="set-del" onclick="removeSet(' + ei + ',' + si + ')" aria-label="Remove set">×</button></div>'
        ).join('') +
      '</div>' +
      '<div class="plates" id="pl-' + ei + '"></div>' +
      '<div class="add-set">' +
        '<input type="number" inputmode="decimal" step="0.5" min="0" placeholder="kg" id="w-' + ei + '" oninput="renderPlates(document.getElementById(\'pl-' + ei + '\'), this.value)">' +
        '<span class="x-label">×</span>' +
        '<input type="number" inputmode="numeric" min="1" placeholder="reps" id="r-' + ei + '">' +
        '<input type="number" inputmode="decimal" min="1" max="10" step="0.5" placeholder="RPE" class="rpe" id="p-' + ei + '">' +
        '<button class="go" onclick="addSet(' + ei + ')">Add</button>' +
      '</div>' +
      '<div class="ex-note"><input type="text" placeholder="Notes (optional)" value="' + esc(e.note) + '" oninput="updateExerciseNote(' + ei + ',this.value)"></div>';
    card.addEventListener('toggle', () => {
      if(hydrating) return;
      if(card.open){
        const wasOpen = openEx.has(ei);
        openEx.add(ei);
        if(!wasOpen && rest && !rest.done && ei > rest.fromEi) promoteRestSwitch();
      } else openEx.delete(ei);
    });
    wrap.appendChild(card);
  });
  document.getElementById('finishBtn').disabled = !draft.entries.some(e => e.sets.length);
  saveDraft();
  setTimeout(() => { if(gen === hydrateGen) hydrating = false; }, 0);
}
function removeExercise(i){
  draft.entries.splice(i,1);
  const next = new Set();
  openEx.forEach(j => {
    if(j < i) next.add(j);
    else if(j > i) next.add(j - 1);
  });
  openEx = next;
  if(rest){
    if(rest.fromEi === i) clearRest();
    else if(rest.fromEi > i) rest.fromEi--;
  }
  renderExercises();
}
function addSet(i){
  const w = parseFloat(document.getElementById('w-'+i).value);
  const r = parseInt(document.getElementById('r-'+i).value,10);
  const rpeRaw = document.getElementById('p-'+i).value;
  const rpe = rpeRaw ? parseFloat(rpeRaw) : null;
  if(!Number.isFinite(w) || w < 0 || w > 2000 || !Number.isInteger(r) || r <= 0 || r > 10000 || (rpe !== null && (!Number.isFinite(rpe) || rpe < 1 || rpe > 10))) { alert('Check weight, reps and RPE (1–10).'); return; }
  const set = {w, r}; if(rpe) set.rpe = rpe;
  draft.entries[i].sets.push(set);
  openEx.add(i);
  renderExercises();
  const wi = document.getElementById('w-'+i);
  wi.value = w; document.getElementById('r-'+i).value = '';
  renderPlates(document.getElementById('pl-'+i), w);
  startRest(i, restKindAfterSet(i));
}
function removeSet(i,si){
  const last = draft.entries[i].sets.length - 1;
  draft.entries[i].sets.splice(si,1);
  if(rest && rest.fromEi === i && si === last) clearRest();
  renderExercises();
}

/* ---------- finish ---------- */
function readMeta(){
  const v = id => document.getElementById(id).value;
  const meta = {};
  if(v('mBw')) meta.bodyweight = parseFloat(v('mBw'));
  if(v('mSleep')) meta.sleep = parseInt(v('mSleep'),10);
  if(v('mCommute')) meta.commute = v('mCommute');
  if(v('mCommuteTime')) meta.commuteTime = parseInt(v('mCommuteTime'),10);
  if(v('mFeel').trim()) meta.feel = v('mFeel').trim();
  return meta;
}
function clearMeta(){
  ['mBw','mSleep','mCommute','mCommuteTime','mFeel'].forEach(id => document.getElementById(id).value='');
}
function startFreshWorkout(){
  if (!engine?.active) return;
  if ((draft.entries.length || Object.keys(readMeta()).length) && !confirm('Clear this unfinished workout and start a new one? Export first if you want to keep the draft. Logged sessions will stay in your ledger.')) return;
  const next = { id: crypto.randomUUID(), day: guessDay(), entries: [], meta: {} };
  try { engine.put('draft:active', next); }
  catch (error) { deviceError = error.message; updateSaveStatus(); return; }
  draft = next;
  openEx = new Set(); clearMeta(); clearRest();
  renderDayRow(); renderExercises(); renderPicker();
  void sync.push();
}
window.startFreshWorkout = startFreshWorkout;
function finishSession(){
  const entries = draft.entries.filter(e => e.sets.length);
  if(!entries.length) return;
  if(!engine?.active) return;
  if(state.sessions.some(s => (s.id === draft.id || s.id === draft.planId) && isDone(s))){
    alert('This workout is already in your ledger. Export your draft if you need to keep these changes, then choose “Start a new workout”.');
    return;
  }
  const meta = readMeta();
  const planned = draft.planId && state.sessions.find(s => s.id === draft.planId && isPlanned(s));
  if(planned){
    planned.status = 'done';
    planned.date = new Date().toISOString();
    planned.day = draft.day;
    planned.meta = meta;
    planned.entries = entries;
  } else {
    state.sessions.unshift({
      id: draft.id || crypto.randomUUID(),
      date: new Date().toISOString(),
      day: draft.day,
      status: 'done',
      meta,
      entries
    });
  }
  state.sessions.sort((a,b)=> b.date.localeCompare(a.date));
  clearRest();
  draft = { day: guessDay(), entries: [] };
  openEx = new Set();
  clearMeta();
  hydrateTodayPlan();
  engine.transaction(() => { store.save(state); saveDraft(); });
  void sync.push();
  renderDayRow(); renderExercises(); renderPicker(); renderHistory(); renderWeek();
  showView('history');
}

/* ---------- ledger ---------- */
function metaLine(m){
  if(!m) return '';
  const bits = [];
  if(m.bodyweight) bits.push(esc(m.bodyweight) + ' kg bw');
  if(m.sleep) bits.push('sleep ' + esc(m.sleep) + '/10');
  if(m.commute) bits.push(esc(m.commute.toLowerCase()) + (m.commuteTime ? ' ' + esc(m.commuteTime) + 'min' : ''));
  if(m.feel) bits.push('“' + esc(m.feel) + '”');
  return bits.length ? '<div class="h-meta">' + bits.join(' · ') + '</div>' : '';
}
function renderHistory(){
  const wrap = document.getElementById('historyList');
  const done = state.sessions.filter(isDone);
  if(!done.length){
    wrap.innerHTML = '<div class="empty"><b>Empty ledger</b>Log your first session and it lands here.</div>';
    return;
  }
  wrap.innerHTML = done.map(s =>
    '<div class="h-session">' +
      '<div class="h-top"><span class="h-day">' + s.day + '</span><span class="h-date">' + fmtDate(s.date) + '</span></div>' +
      (s.notes ? '<div class="h-meta">' + esc(s.notes) + '</div>' : '') +
      metaLine(s.meta) +
      s.entries.map(e =>
        '<div class="h-ex"><div class="n">' + esc(e.exercise) + '</div>' +
        '<div class="s">' + e.sets.map(x => x.w + '×' + x.r + (x.rpe ? '@' + x.rpe : '')).join('  ') + '</div>' +
        (e.note ? '<div class="note">' + esc(e.note) + '</div>' : '') +
        '</div>'
      ).join('') +
      '<button class="h-del" onclick="deleteSession(\'' + s.id + '\')">delete entry</button>' +
    '</div>'
  ).join('');
}
function deleteSession(id){
  if(!confirm('Delete this session from the ledger?')) return;
  if(draft.planId === id) draft.planId = undefined;
  sync.remove(id);
  hydrateTodayPlan();
  renderHistory(); renderExercises(); renderWeek();
}

/* ---------- import / export ---------- */
function exportLegacyData(){
  // Never assign a shared legacy cache to a new public account or overwrite it.
  if (!currentUser?.legacyOwner) return;
  const raw = localStorage.getItem('sirona-v1');
  if (!raw) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([raw], {type:'application/json'}));
  a.download = 'sirona-device-recovery.json';
  a.click(); URL.revokeObjectURL(a.href);
}
window.exportLegacyData = exportLegacyData;
function exportData(){
  const blob = new Blob([JSON.stringify({sessions: state.sessions, draft, pending: engine?.pending || {}},null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'gymspear-export.json';
  a.click(); URL.revokeObjectURL(a.href);
}
function validImportedSession(s) { return validateRecord('session:' + s.id, s); }
function importData(){
  const f = document.getElementById('importFile');
  f.onchange = () => {
    const file = f.files[0]; if(!file) return;
    if(file.size > 5 * 1024 * 1024) { alert('Choose an export smaller than 5 MB.'); return; }
    file.text().then(t => {
      try{
        const data = JSON.parse(t);
        if(!Array.isArray(data.sessions)) throw 0;
        if(data.sessions.length > 1000) throw new Error('Too many sessions');
        const imported = data.sessions.map(session => ({...session, id: crypto.randomUUID()}));
        if(!imported.every(validImportedSession)) throw new Error('Invalid session');
        state.sessions.push(...imported);
        store.save(state); sync.push();
        hydrateTodayPlan();
        renderHistory(); renderExercises(); renderWeek();
        alert('Imported ' + imported.length + ' sessions.');
      }catch(e){ alert('That file is not a GymSpear export.'); }
    });
  };
  f.click();
}

/* ---------- progress ---------- */
function e1rm(w, r){ return r >= 1 ? w * (1 + r/30) : w; }   // Epley estimate
function exerciseHistory(name){
  // oldest → newest, one point per completed session where it appears
  const pts = [];
  for(let i = state.sessions.length - 1; i >= 0; i--){
    const s = state.sessions[i];
    if(!isDone(s) || !s.entries) continue;
    const e = s.entries.find(e => e.exercise.toLowerCase() === name.toLowerCase());
    if(e && e.sets.length){
      const best = e.sets.reduce((a,b)=> (e1rm(b.w,b.r) > e1rm(a.w,a.r) ? b : a));
      const vol = e.sets.reduce((t,x)=> t + x.w * x.r, 0);
      pts.push({date:s.date, best, vol, sets:e.sets.length});
    }
  }
  return pts;
}
function renderProgressSelect(){
  const names = [...new Set(state.sessions.filter(isDone).flatMap(s => (s.entries||[]).map(e => e.exercise)))].sort();
  const sel = document.getElementById('progEx');
  const keep = sel.value;
  sel.innerHTML = names.length
    ? names.map(n => '<option' + (n===keep?' selected':'') + '>' + esc(n) + '</option>').join('')
    : '<option value="" disabled selected>No exercises logged yet</option>';
}
function sparkline(pts){
  if(pts.length < 2) return '';
  const W = 500, H = 120, P = 8;
  const vals = pts.map(p => e1rm(p.best.w, p.best.r));
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  const x = i => P + i * (W - 2*P) / (pts.length - 1);
  const y = v => H - P - (v - min) * (H - 2*P) / span;
  const line = vals.map((v,i)=> (i?'L':'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const dots = vals.map((v,i)=>
    '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="3.5" fill="' +
    (v >= max ? 'var(--knurl)' : 'var(--chalk-dim)') + '"/>').join('');
  return '<svg class="prog-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Estimated 1RM trend">' +
    '<path d="' + line + '" fill="none" stroke="var(--knurl)" stroke-width="2" opacity=".7"/>' + dots + '</svg>';
}
function renderProgress(){
  renderProgressSelect();
  const name = document.getElementById('progEx').value;
  const body = document.getElementById('progBody');
  if(!name){ body.innerHTML = '<div class="empty"><b>Nothing to compare yet</b>Log a few sessions and your history lands here.</div>'; return; }
  const pts = exerciseHistory(name);
  if(!pts.length){ body.innerHTML = ''; return; }

  const bestPt = pts.reduce((a,b)=> e1rm(b.best.w,b.best.r) > e1rm(a.best.w,a.best.r) ? b : a);
  const latest = pts[pts.length-1];
  const first  = pts[0];
  const change = e1rm(latest.best.w, latest.best.r) - e1rm(first.best.w, first.best.r);

  const rows = pts.slice().reverse().map((p, i, arr) => {
    const prev = arr[i+1]; // previous session (older)
    const d = prev ? e1rm(p.best.w,p.best.r) - e1rm(prev.best.w,prev.best.r) : null;
    const isPR = p === bestPt;
    return '<div class="prog-row">' +
      '<span class="d">' + fmtDate(p.date) + '</span>' +
      '<span class="best"><b>' + p.best.w + '</b> kg × <b>' + p.best.r + '</b> · ' + p.sets + ' sets</span>' +
      (isPR ? '<span class="pr-flag">PR</span>' : '') +
      (d === null ? '' : '<span class="delta ' + (d >= 0 ? 'up' : 'down') + '">' + (d >= 0 ? '▲' : '▼') + ' ' + Math.abs(d).toFixed(1) + '</span>') +
      '</div>';
  }).join('');

  body.innerHTML =
    '<div class="prog-card">' +
      '<div class="prog-stats">' +
        '<div class="prog-stat"><div class="v">' + bestPt.best.w + '×' + bestPt.best.r + '</div><div class="l">Best set</div></div>' +
        '<div class="prog-stat"><div class="v">' + e1rm(bestPt.best.w,bestPt.best.r).toFixed(0) + '</div><div class="l">Est. 1RM kg</div></div>' +
        '<div class="prog-stat"><div class="v">' + (change >= 0 ? '+' : '') + change.toFixed(1) + '</div><div class="l">Since first</div></div>' +
      '</div>' +
      sparkline(pts) +
    '</div>' +
    '<div class="prog-card"><div class="prog-title">Session by session — beat these numbers</div>' + rows + '</div>';
}

/* ---------- week + plans ---------- */
function weekKeys(){
  const keys = [];
  const now = new Date();
  for(let i=0;i<7;i++){
    keys.push(dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate()+i)));
  }
  return keys;
}
function weekHeading(key, i){
  if(i===0) return 'Today';
  if(i===1) return 'Tomorrow';
  return parseKey(key).toLocaleDateString('en-GB',{weekday:'long'});
}
function weekDateLabel(key){
  return parseKey(key).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
}
function startable(key){ return key <= todayKey(); }

function applyPlan(s){
  draft = {
    day: s.day,
    planId: s.id,
    entries: (s.entries||[]).map(e => ({
      exercise: e.exercise,
      group: e.group,
      sets: [],
      note: e.note || ''
    }))
  };
  openEx = new Set();
  clearRest();
}

function hydrateTodayPlan(){
  const plan = planFor(todayKey());
  if(!plan) return;
  if(draft.planId === plan.id) return;
  if(draft.entries.length) return;
  applyPlan(plan);
}

function startPlan(id){
  const s = state.sessions.find(x => x.id === id);
  if(!s || !isPlanned(s)) return;
  if(draft.planId === id && draft.entries.length){ showView('today'); return; }
  if(draft.entries.some(e => e.sets.length) && !confirm('Replace the session you’re logging?')) return;
  applyPlan(s);
  renderDayRow(); renderExercises(); renderPicker();
  showView('today');
}

function openPlanEditor(key, id){
  const existing = id
    ? state.sessions.find(s => s.id === id)
    : planFor(key);
  planEdit = existing && isPlanned(existing)
    ? {
        dateKey: dateKey(existing.date),
        id: existing.id,
        day: existing.day,
        notes: existing.notes || '',
        entries: (existing.entries||[]).map(e => ({
          exercise: e.exercise, group: e.group, sets: [], note: e.note || ''
        }))
      }
    : { dateKey: key, day: guessDay(), notes: '', entries: [] };
  renderPlanEditor();
  showView('week');
}

function closePlanEditor(){
  planEdit = null;
  const ed = document.getElementById('planEditor');
  ed.hidden = true;
  ed.innerHTML = '';
}

function setPlanDay(d){
  if(!planEdit) return;
  planEdit.day = d;
  renderPlanEditor();
}
function movePlanEx(i, dir){
  if(!planEdit) return;
  const j = i + dir;
  if(j < 0 || j >= planEdit.entries.length) return;
  const t = planEdit.entries[i];
  planEdit.entries[i] = planEdit.entries[j];
  planEdit.entries[j] = t;
  renderPlanEditor();
}
function removePlanEx(i){
  if(!planEdit) return;
  planEdit.entries.splice(i,1);
  renderPlanEditor();
}
function updatePlanNote(i, val){
  if(planEdit) planEdit.entries[i].note = val;
}
function updatePlanSessionNote(val){
  if(planEdit) planEdit.notes = val;
}

function renderPlanPicker(){
  if(!planEdit) return;
  const gSel = document.getElementById('wGroup');
  const eSel = document.getElementById('wEx');
  if(!gSel) return;
  const keepG = gSel.value;
  gSel.innerHTML = '<option value="" disabled>Muscle group…</option>' +
    groupsForDay(planEdit.day).map(g => '<option' + (g===keepG?' selected':'') + '>' + esc(g) + '</option>').join('');
  if(!keepG) gSel.selectedIndex = 0;
  const g = gSel.value;
  const keepX = eSel.value;
  eSel.innerHTML = '<option value="" disabled>Exercise…</option>' +
    (g ? exercisesForGroup(g, planEdit.day).map(x => '<option' + (x===keepX?' selected':'') + '>' + esc(x) + '</option>').join('') +
      '<option' + (keepX===CUSTOM?' selected':'') + '>' + CUSTOM + '</option>' : '');
  if(!g || !keepX) eSel.selectedIndex = 0;
  const isCustom = eSel.value === CUSTOM;
  const c = document.getElementById('wCustom');
  c.hidden = !isCustom;
  updatePlanAddBtn();
}
function onPlanGroupChange(){
  const eSel = document.getElementById('wEx');
  const g = document.getElementById('wGroup').value;
  eSel.innerHTML = '<option value="" disabled selected>Exercise…</option>' +
    exercisesForGroup(g, planEdit.day).map(x => '<option>' + esc(x) + '</option>').join('') +
    '<option>' + CUSTOM + '</option>';
  document.getElementById('wCustom').hidden = true;
  updatePlanAddBtn();
}
function onPlanExChange(){
  const isCustom = document.getElementById('wEx').value === CUSTOM;
  const c = document.getElementById('wCustom');
  c.hidden = !isCustom;
  if(isCustom) c.focus();
  updatePlanAddBtn();
}
function updatePlanAddBtn(){
  const g = document.getElementById('wGroup');
  const x = document.getElementById('wEx');
  const c = document.getElementById('wCustom');
  if(!g) return;
  document.getElementById('wAdd').disabled = !g.value || !x.value || (x.value === CUSTOM && !c.value.trim());
}
function addPlanExercise(){
  if(!planEdit) return;
  const g = document.getElementById('wGroup').value;
  let x = document.getElementById('wEx').value;
  if(x === CUSTOM) x = document.getElementById('wCustom').value.trim();
  if(!g || !x) return;
  planEdit.entries.push({exercise:x, group:g, sets:[], note:''});
  renderPlanEditor();
}

function renderPlanEditor(){
  const ed = document.getElementById('planEditor');
  if(!planEdit){ ed.hidden = true; ed.innerHTML = ''; return; }
  ed.hidden = false;
  const idx = weekKeys().indexOf(planEdit.dateKey);
  const label = idx >= 0 ? weekHeading(planEdit.dateKey, idx)
    : parseKey(planEdit.dateKey).toLocaleDateString('en-GB',{weekday:'short'});
  const dateL = weekDateLabel(planEdit.dateKey);
  ed.innerHTML =
    '<h2>Plan ' + esc(label === 'Today' || label === 'Tomorrow' ? label : label.slice(0,3)) + ' ' + esc(dateL) + '</h2>' +
    '<div class="day-row">' + DAYS.map(d =>
      '<button class="' + (planEdit.day===d?'on':'') + '" onclick="setPlanDay(\'' + d + '\')">' + d + '</button>'
    ).join('') + '</div>' +
    '<label for="wNotes" class="picker-title">Notes</label>' +
    '<input class="plan-notes" id="wNotes" type="text" placeholder="optional — e.g. heavy bench" value="' + esc(planEdit.notes) + '" oninput="updatePlanSessionNote(this.value)">' +
    planEdit.entries.map((e,i) =>
      '<div class="plan-ex">' +
        '<div class="plan-move">' +
          '<button type="button" onclick="movePlanEx(' + i + ',-1)" aria-label="Move up">▲</button>' +
          '<button type="button" onclick="movePlanEx(' + i + ',1)" aria-label="Move down">▼</button>' +
        '</div>' +
        '<div class="info"><div class="n">' + esc(e.exercise) + '</div><div class="g">' + esc(e.group) + '</div>' +
          '<input type="text" placeholder="Notes (optional)" value="' + esc(e.note) + '" oninput="updatePlanNote(' + i + ', this.value)">' +
        '</div>' +
        '<button class="set-del" onclick="removePlanEx(' + i + ')" aria-label="Remove exercise">×</button>' +
      '</div>'
    ).join('') +
    '<div class="picker" style="margin-top:10px">' +
      '<div class="picker-title">Add exercise</div>' +
      '<div class="row">' +
        '<select id="wGroup" onchange="onPlanGroupChange()"></select>' +
        '<select id="wEx" onchange="onPlanExChange()"></select>' +
        '<input type="text" id="wCustom" placeholder="Custom exercise name…" hidden oninput="updatePlanAddBtn()">' +
        '<button class="add-btn" id="wAdd" onclick="addPlanExercise()" disabled>Add to plan</button>' +
      '</div>' +
    '</div>' +
    '<button class="plan-save" onclick="savePlan()">Save plan</button>' +
    '<button class="plan-cancel" onclick="closePlanEditor()">Cancel</button>';
  renderPlanPicker();
}

function savePlan(){
  if(!planEdit) return;
  if(!planEdit.entries.length){ alert('Add at least one exercise.'); return; }
  const payload = {
    day: planEdit.day,
    status: 'planned',
    notes: (planEdit.notes || '').trim(),
    entries: planEdit.entries.map(e => ({
      exercise: e.exercise, group: e.group, sets: [], note: e.note || ''
    }))
  };
  const existing = planEdit.id
    ? state.sessions.find(s => s.id === planEdit.id && isPlanned(s))
    : planFor(planEdit.dateKey);
  if(existing){
    existing.day = payload.day;
    existing.status = 'planned';
    existing.notes = payload.notes;
    existing.entries = payload.entries;
    existing.date = existing.date || atNoon(planEdit.dateKey);
  } else {
    state.sessions.push({
      id: crypto.randomUUID(),
      date: atNoon(planEdit.dateKey),
      ...payload
    });
  }
  state.sessions.sort((a,b)=> b.date.localeCompare(a.date));
  store.save(state);
  sync.push();
  if(draft.planId && existing && draft.planId === existing.id){
    draft.day = existing.day;
    draft.entries = existing.entries.map(e => {
      const live = draft.entries.find(d => d.exercise === e.exercise);
      return { exercise: e.exercise, group: e.group, sets: live ? live.sets : [], note: e.note || '' };
    });
  } else {
    hydrateTodayPlan();
  }
  closePlanEditor();
  renderDayRow(); renderExercises(); renderPicker();
  renderWeek();
}

function deletePlan(id){
  if(!confirm('Delete this planned session?')) return;
  const wasDraft = draft.planId === id;
  const hadSets = draft.entries.some(e => e.sets.length);
  sync.remove(id);
  if(planEdit && planEdit.id === id) closePlanEditor();
  if(wasDraft){
    draft.planId = undefined;
    if(!hadSets){
      draft = { day: guessDay(), entries: [] };
      openEx = new Set();
    }
    renderDayRow(); renderExercises(); renderPicker();
  }
  renderWeek();
}

function weekCard(key, i, plan, overdue){
  const logged = doneOn(key);
  const names = plan ? (plan.entries||[]) : [];
  const actions = [];
  if(plan){
    if(startable(key)) actions.push('<button class="primary" onclick="startPlan(\'' + plan.id + '\')">Start</button>');
    actions.push('<button onclick="openPlanEditor(\'' + key + '\',\'' + plan.id + '\')">Edit</button>');
    actions.push('<button onclick="deletePlan(\'' + plan.id + '\')">Delete</button>');
  } else {
    actions.push('<button class="primary" onclick="openPlanEditor(\'' + key + '\')">Plan session</button>');
  }
  return '<div class="week-day' + (key===todayKey()?' is-today':'') + '">' +
    '<div class="week-top"><span class="week-label">' + esc(overdue ? 'Missed' : weekHeading(key, i)) + '</span>' +
      '<span class="week-date">' + esc(weekDateLabel(key)) + '</span></div>' +
    (plan
      ? '<div class="week-day-type">' + esc(plan.day) + '</div>' +
        (plan.notes ? '<div class="week-notes">' + esc(plan.notes) + '</div>' : '') +
        names.map(e =>
          '<div class="week-ex"><div class="n">' + esc(e.exercise) + '</div>' +
          (e.note ? '<div class="note">' + esc(e.note) + '</div>' : '') + '</div>'
        ).join('')
      : '<div class="week-logged">No session planned</div>') +
    (logged.length ? '<div class="week-logged">Logged ' + logged.map(s => s.day).join(', ') + '</div>' : '') +
    '<div class="week-actions">' + actions.join('') + '</div>' +
  '</div>';
}

function renderWeek(){
  const wrap = document.getElementById('weekList');
  const today = todayKey();
  const overdue = state.sessions
    .filter(s => isPlanned(s) && dateKey(s.date) < today)
    .sort((a,b)=> a.date.localeCompare(b.date));
  let html = '';
  if(overdue.length){
    html += '<div class="week-section">Overdue</div>';
    overdue.forEach(s => { html += weekCard(dateKey(s.date), -1, s, true); });
    html += '<div class="week-section">Coming days</div>';
  }
  weekKeys().forEach((key, i) => { html += weekCard(key, i, planFor(key), false); });
  wrap.innerHTML = html;
}

/* ---------- views ---------- */
function showView(v){
  document.getElementById('view-today').hidden    = v !== 'today';
  document.getElementById('view-week').hidden     = v !== 'week';
  document.getElementById('view-history').hidden  = v !== 'history';
  document.getElementById('view-progress').hidden = v !== 'progress';
  document.getElementById('tab-today').setAttribute('aria-selected', v==='today');
  document.getElementById('tab-week').setAttribute('aria-selected', v==='week');
  document.getElementById('tab-history').setAttribute('aria-selected', v==='history');
  document.getElementById('tab-progress').setAttribute('aria-selected', v==='progress');
  if(v === 'progress') renderProgress();
  if(v === 'week') renderWeek();
  updateRestBar();
}

// Existing inline button handlers call only these named UI functions.
Object.assign(window, {updateSaveStatus,claimTab,setShell,authErr,showAuth,applyMeta,activate,submitAuth,logout,bootAuth,saveDraft,updateExerciseNote,reviewConflicts,isPlanned,isDone,dateKey,parseKey,atNoon,todayKey,planFor,doneOn,guessDay,lastPerformance,fmtDate,esc,plateBreakdown,renderPlates,renderDayRow,setDay,groupsForDay,exercisesForGroup,renderPicker,onGroupChange,onExChange,updateAddBtn,addExercise,clampRest,restKindAfterSet,restNextName,restCurrentEi,fmtRest,restRemaining,sessionLoggerOpen,announceRest,paintRestSlider,startRest,applyKindDuration,promoteRestSwitch,toggleRestKind,setRestSeconds,skipRest,clearRest,restEnds,updateRestBar,renderExercises,removeExercise,addSet,removeSet,readMeta,clearMeta,finishSession,metaLine,renderHistory,deleteSession,exportData,validImportedSession,importData,e1rm,exerciseHistory,renderProgressSelect,sparkline,renderProgress,weekKeys,weekHeading,weekDateLabel,startable,applyPlan,hydrateTodayPlan,startPlan,openPlanEditor,closePlanEditor,setPlanDay,movePlanEx,removePlanEx,updatePlanNote,updatePlanSessionNote,renderPlanPicker,onPlanGroupChange,onPlanExChange,updatePlanAddBtn,addPlanExercise,renderPlanEditor,savePlan,deletePlan,weekCard,renderWeek,showView});
document.addEventListener('input', event => {
  if (['mBw','mSleep','mCommute','mCommuteTime','mFeel'].includes(event.target.id)) saveDraft();
});
window.addEventListener('online', () => { void sync.pull(); });
window.addEventListener('offline', updateSaveStatus);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void sync.pull(); });
setInterval(() => { if (!document.hidden) void sync.pull(); }, 15000);
window.addEventListener('storage', event => {
  if (event.key === 'sirona-active-user') { if(engine) engine.active = false; showAuth('login'); authErr('Account changed in another tab. Sign in again.'); }
});
document.getElementById('retrySync').addEventListener('click', () => { void sync.pull(); });
document.getElementById('reviewConflicts').addEventListener('click', reviewConflicts);
let installPrompt;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; document.getElementById('installApp').hidden = false; });
document.getElementById('installApp').addEventListener('click', async () => { if(installPrompt) { await installPrompt.prompt(); installPrompt = null; document.getElementById('installApp').hidden = true; } });
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});

/* ---------- boot ---------- */
document.getElementById('todayDate').textContent =
  new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
hydrateTodayPlan();
renderDayRow(); renderExercises(); renderPicker(); renderHistory(); renderWeek();
bootAuth();
