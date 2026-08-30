/* Wispace
   A small saving tracker. There is no server behind this - everything the
   user makes is kept in this browser under one localStorage key. */

const STORE_KEY = 'wispace-data';
const DAY_MS = 86400000;

const CURRENCIES = {
  USD: { symbol: 'US$', label: 'USD (US$)' },
  CAD: { symbol: 'CA$', label: 'CAD (CA$)' },
  EUR: { symbol: '€', label: 'EUR (€)' }
};

/* Every option the app can plan around. `days` is what all the maths uses,
   so a month is treated as 30 days rather than a real calendar month. */
const CADENCES = [
  { id: 'day',      label: 'Every day',      per: 'day',      unit: 'Day',   title: 'Daily',       days: 1 },
  { id: 'week',     label: 'Every week',     per: 'week',     unit: 'Week',  title: 'Weekly',      days: 7 },
  { id: 'twoWeeks', label: 'Every 2 weeks',  per: '2 weeks',  unit: 'Wk',    title: 'Biweekly',    days: 14 },
  { id: 'month',    label: 'Every month',    per: 'month',    unit: 'Month', title: 'Monthly',     days: 30 },
  { id: 'halfYear', label: 'Every 6 months', per: '6 months', unit: 'Half',  title: 'Half-yearly', days: 182 },
  { id: 'year',     label: 'Every year',     per: 'year',     unit: 'Year',  title: 'Yearly',      days: 365 }
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let state = {
  user: null,
  currency: 'USD',
  reminders: true,
  goals: [],
  entries: [],
  activeGoalId: null
};

/* ---------- small helpers ---------- */

const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const toISO = (date) => date.toISOString().slice(0, 10);
const today = () => toISO(new Date());
const parseISO = (iso) => new Date(`${iso}T00:00:00`);
const addDays = (iso, count) => toISO(new Date(parseISO(iso).getTime() + count * DAY_MS));
const daysBetween = (from, to) => Math.round((parseISO(to) - parseISO(from)) / DAY_MS);

function money(value) {
  const symbol = CURRENCIES[state.currency].symbol;
  return `${value < 0 ? '-' : ''}${symbol}${Math.abs(value).toFixed(2)}`;
}

// Drops the ".00" so the small check-in cards stay readable.
function shortMoney(value) {
  const symbol = CURRENCIES[state.currency].symbol;
  const rounded = Math.round(value * 100) / 100;
  return symbol + (Number.isInteger(rounded) ? rounded : rounded.toFixed(2));
}

const longDate = (iso) => parseISO(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

// Bare "Nov 22" for the narrow check-in cards.
const shortDate = (iso) => parseISO(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Same, but keeps the year when a plan runs past December.
function planDate(iso) {
  const date = parseISO(iso);
  return date.getFullYear() === new Date().getFullYear() ? shortDate(iso) : longDate(iso);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

/* Not real security - there is no account system here. This only keeps the
   typed password out of localStorage in plain text. */
function scramble(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return String(hash);
}

const cadenceOf = (goal) => CADENCES.find((c) => c.id === goal.cadence) || CADENCES[1];
const goalById = (id) => state.goals.find((goal) => goal.id === id);

/* ---------- saving and loading ---------- */

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Could not save to localStorage', error);
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) state = Object.assign(state, JSON.parse(raw));
  } catch (error) {
    console.warn('Saved data was unreadable, starting fresh', error);
  }
}

/* ---------- goal maths ---------- */

function savedFor(goalId) {
  return state.entries
    .filter((entry) => entry.goalId === goalId)
    .reduce((total, entry) => total + (entry.type === 'withdraw' ? -entry.amount : entry.amount), 0);
}

const progressOf = (goal) => clamp((savedFor(goal.id) / goal.target) * 100, 0, 100);

/* What you'd have to put in each time to still land on the original
   deadline. Used to fill the cadence chips and to suggest a fix. */
function requiredPerPeriod(target, saved, cadenceDays, deadline, from) {
  const remaining = Math.max(target - saved, 0);
  const daysLeft = Math.max(daysBetween(from || today(), deadline), 1);
  const periods = Math.max(Math.ceil(daysLeft / cadenceDays), 1);
  return remaining / periods;
}

/* The rule this app follows: the contribution stays where the user put it
   and the finish date moves instead. Returns null if there's no amount yet. */
function projectedFinish(goal) {
  const remaining = goal.target - savedFor(goal.id);
  if (remaining <= 0) return today();
  if (!goal.contribution || goal.contribution <= 0) return null;
  const periods = Math.ceil(remaining / goal.contribution);
  return addDays(today(), periods * cadenceOf(goal).days);
}

function paceFor(goal) {
  if (savedFor(goal.id) >= goal.target) {
    return { tone: 'done', text: 'Goal reached — what a feeling' };
  }
  const finish = projectedFinish(goal);
  if (!finish) return { tone: 'behind', text: 'Add an amount to get a finish date' };

  const drift = daysBetween(goal.deadline, finish);
  if (drift <= -2) return { tone: 'ahead', text: `${Math.abs(drift)} days early — landing ${planDate(finish)}` };
  if (drift <= 2) return { tone: 'on', text: `Right on pace for ${planDate(finish)}` };
  return { tone: 'behind', text: `${drift} days later than planned — now ${planDate(finish)}` };
}

/* One card per contribution, from the day the goal started to the day it
   finishes. Capped so a daily year-long goal doesn't build 365 nodes. */
function checkinsFor(goal) {
  const cadence = cadenceOf(goal);
  const saved = savedFor(goal.id);
  if (!goal.contribution || goal.contribution <= 0) return [];

  const count = clamp(Math.ceil(goal.target / goal.contribution), 1, 400);
  const cards = [];

  for (let index = 1; index <= count; index += 1) {
    const alreadyPlanned = (index - 1) * goal.contribution;
    cards.push({
      index,
      due: addDays(goal.startDate, (index - 1) * cadence.days),
      amount: Math.min(goal.contribution, Math.max(goal.target - alreadyPlanned, 0)),
      done: saved >= Math.min(index * goal.contribution, goal.target)
    });
  }
  return cards;
}

const nextDueCard = (goal) => checkinsFor(goal).find((card) => !card.done);

/* When the amount and the deadline don't line up, offer ways out instead of
   just refusing. Each one can be applied with a tap. */
function planSuggestions(target, saved, deadline, cadence, contribution) {
  const suggestions = [];
  const needed = requiredPerPeriod(target, saved, cadence.days, deadline);
  if (!contribution || contribution <= 0) return suggestions;

  const remaining = Math.max(target - saved, 0);
  const periods = Math.ceil(remaining / contribution);
  const finish = addDays(today(), periods * cadence.days);
  const drift = daysBetween(deadline, finish);
  if (drift <= 2 && drift >= -2) return suggestions;

  if (drift > 2) {
    suggestions.push({
      kind: 'amount',
      value: Math.ceil(needed * 100) / 100,
      title: `Put in ${money(Math.ceil(needed * 100) / 100)} instead`,
      note: `Keeps your ${planDate(deadline)} deadline at the same rhythm.`
    });
    suggestions.push({
      kind: 'deadline',
      value: finish,
      title: `Move the deadline to ${planDate(finish)}`,
      note: `${money(contribution)} every ${cadence.per} gets you there without stretching.`
    });

    // A tighter rhythm can also rescue the same amount, so look for one.
    const faster = CADENCES.filter((option) => option.days < cadence.days)
      .reverse()
      .find((option) => {
        const optionFinish = addDays(today(), Math.ceil(remaining / contribution) * option.days);
        return daysBetween(deadline, optionFinish) <= 2;
      });
    if (faster) {
      suggestions.push({
        kind: 'cadence',
        value: faster.id,
        title: `Switch to ${faster.label.toLowerCase()}`,
        note: `Same ${money(contribution)}, just more often — you land on time.`
      });
    }
  } else {
    suggestions.push({
      kind: 'amount',
      value: Math.round(needed * 100) / 100,
      title: `You could ease off to ${money(Math.round(needed * 100) / 100)}`,
      note: `Still reaches ${money(target)} by ${planDate(deadline)} with less pressure.`
    });
    suggestions.push({
      kind: 'deadline',
      value: finish,
      title: `Or finish early on ${planDate(finish)}`,
      note: `Keep ${money(contribution)} every ${cadence.per} and pull the date forward.`
    });
  }
  return suggestions;
}

/* ---------- screens and pages ---------- */

function showScreen(id) {
  $$('.screen').forEach((screen) => screen.classList.toggle('active', screen.id === id));
}

function showPage(id) {
  $$('.page').forEach((page) => page.classList.toggle('active-page', page.id === id));
  $$('.bottom-nav button').forEach((button) => button.classList.toggle('active', button.dataset.page === id));

  // A hidden page has no width, so both sliders lose their place while the
  // user is off on another tab. Put them back once Home is on screen again.
  if (id === 'home-page' && state.goals.length) {
    scrollToGoalIndex(state.goals.indexOf(activeGoal()));
    renderCheckins();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openModal(id) { $(`#${id}`).classList.add('open'); }
function closeModals() { $$('.modal-backdrop').forEach((modal) => modal.classList.remove('open')); }

/* ---------- home ---------- */

function activeGoal() {
  return goalById(state.activeGoalId) || state.goals[0] || null;
}

/* A slide is 100% of the carousel's content box, which is narrower than
   clientWidth because of the padding that lets the ring bleed to the edge.
   Measuring one slide keeps the scroll maths right at any screen size. */
function slideWidth() {
  const slide = $('#goal-carousel').firstElementChild;
  return slide && slide.offsetWidth ? slide.offsetWidth : 0;
}

function scrollToGoalIndex(index, smooth) {
  const width = slideWidth();
  if (!width) return;
  $('#goal-carousel').scrollTo({ left: index * width, behavior: smooth ? 'smooth' : 'auto' });
}

function goalIndexFromScroll() {
  const width = slideWidth();
  if (!width) return state.goals.indexOf(activeGoal());
  return clamp(Math.round($('#goal-carousel').scrollLeft / width), 0, state.goals.length - 1);
}

function renderHome() {
  const carousel = $('#goal-carousel');
  const dots = $('#carousel-dots');
  const hasGoals = state.goals.length > 0;

  $('#home-empty').hidden = hasGoals;
  $('#home-content').hidden = !hasGoals;
  if (!hasGoals) return;

  const current = activeGoal();
  state.activeGoalId = current.id;

  carousel.innerHTML = state.goals.map((goal) => {
    const saved = savedFor(goal.id);
    const pace = paceFor(goal);
    return `
      <article class="goal-slide" data-goal="${goal.id}">
        <div class="progress-ring" style="--progress:${progressOf(goal)}%">
          <div class="ring-inner">
            <span>${escapeHtml(goal.name)}</span>
            <strong>${money(saved)}</strong>
            <small>of ${money(goal.target)} goal</small>
          </div>
        </div>
        <p class="pace-note ${pace.tone}"><span class="status-dot"></span>${escapeHtml(pace.text)}</p>
      </article>`;
  }).join('');

  dots.innerHTML = state.goals
    .map((goal) => `<i class="${goal.id === current.id ? 'on' : ''}" data-goal="${goal.id}"></i>`)
    .join('');
  dots.hidden = state.goals.length < 2;

  // Rebuilding the slides resets the scroll, so put it back where it was.
  scrollToGoalIndex(state.goals.indexOf(current));

  renderCheckins();
  renderHomeStats();
}

function renderHomeStats() {
  const goal = activeGoal();
  if (!goal) return;

  const cadence = cadenceOf(goal);
  const next = nextDueCard(goal);

  $('#deposit-label').textContent = money(next ? next.amount : goal.contribution);
  $('#next-deposit').textContent = next ? `${money(next.amount)} / ${cadence.per}` : 'All done';
  $('#checkin-title').textContent = `${cadence.title} check-in`;

  const month = today().slice(0, 7);
  const savedThisMonth = state.entries
    .filter((entry) => entry.goalId && entry.date.startsWith(month))
    .reduce((total, entry) => total + (entry.type === 'withdraw' ? -entry.amount : entry.amount), 0);
  $('#month-saved').textContent = money(savedThisMonth);
}

function renderCheckins() {
  const goal = activeGoal();
  const track = $('#checkin-track');
  if (!goal) { track.innerHTML = ''; return; }

  const cadence = cadenceOf(goal);
  const cards = checkinsFor(goal);
  const currentIndex = cards.findIndex((card) => !card.done);

  track.innerHTML = cards.map((card) => {
    const isNow = card.index - 1 === currentIndex;
    const classes = ['day-card', card.done ? 'done' : '', isNow ? 'today' : ''].filter(Boolean).join(' ');
    return `
      <button class="${classes}" type="button" data-checkin="${card.index}" data-amount="${card.amount}">
        <span>${cadence.unit} ${card.index}</span>
        <strong>${shortMoney(card.amount)}</strong>
        <small>${shortDate(card.due)}</small>
      </button>`;
  }).join('');

  // Land on the card the user is actually up to.
  const target = track.children[Math.max(currentIndex, 0)];
  if (target) track.scrollLeft = Math.max(target.offsetLeft - track.clientWidth / 2 + target.clientWidth / 2, 0);
}

/* ---------- goals page ---------- */

function renderGoals() {
  const list = $('#goal-list');

  if (!state.goals.length) {
    list.innerHTML = `
      <div class="empty-state small">
        <h3>No goals yet</h3>
        <p>Every goal starts with a number and a date. Add as many as you like.</p>
      </div>`;
    return;
  }

  list.innerHTML = state.goals.map((goal) => {
    const saved = savedFor(goal.id);
    const cadence = cadenceOf(goal);
    const pace = paceFor(goal);
    const percent = Math.round(progressOf(goal));
    return `
      <article class="goal-item" data-goal="${goal.id}">
        <header>
          <span class="goal-name">${escapeHtml(goal.name)}</span>
          <span class="pill ${pace.tone}">${percent}%</span>
        </header>
        <strong class="goal-amount">${money(saved)}</strong>
        <small>of ${money(goal.target)} &middot; ${money(goal.contribution)} every ${cadence.per}</small>
        <div class="bar"><i style="width:${progressOf(goal)}%"></i></div>
        <p class="goal-foot">
          <span>Aiming for ${longDate(goal.deadline)}</span>
          <button class="link-button" type="button" data-edit="${goal.id}">Edit</button>
        </p>
      </article>`;
  }).join('');
}

/* ---------- history ---------- */

let historyFilter = 'all';

function renderHistory() {
  const list = $('#transactions');
  const month = today().slice(0, 7);

  const totalSaved = state.goals.reduce((total, goal) => total + savedFor(goal.id), 0);
  $('#history-total').textContent = money(totalSaved);

  const monthly = state.entries.filter((entry) => entry.date.startsWith(month));
  const isIncoming = (entry) => entry.type === 'deposit' || entry.type === 'income';
  $('#history-in').textContent = money(monthly.filter(isIncoming).reduce((sum, e) => sum + e.amount, 0));
  $('#history-out').textContent = money(monthly.filter((e) => !isIncoming(e)).reduce((sum, e) => sum + e.amount, 0));

  const visible = state.entries
    .filter((entry) => {
      if (historyFilter === 'goals') return Boolean(entry.goalId);
      if (historyFilter === 'outside') return !entry.goalId;
      return true;
    })
    .slice()
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date)));

  if (!visible.length) {
    list.innerHTML = `
      <div class="empty-state small">
        <h3>Nothing here yet</h3>
        <p>Deposits show up automatically. Tap Log to add anything from outside your goals.</p>
      </div>`;
    return;
  }

  const tones = { deposit: 'green', withdraw: 'red', income: 'purple', expense: 'gold' };
  const signs = { deposit: '+', withdraw: '-', income: '+', expense: '-' };
  let lastDate = '';

  list.innerHTML = visible.map((entry) => {
    const heading = entry.date === lastDate ? '' : `<p class="date-heading">${longDate(entry.date)}</p>`;
    lastDate = entry.date;
    const goal = entry.goalId ? goalById(entry.goalId) : null;
    const sub = goal ? goal.name : entry.type === 'income' ? 'Money in' : 'Money out';
    const positive = signs[entry.type] === '+';

    return `${heading}
      <div class="transaction">
        <span class="transaction-icon ${tones[entry.type]}">${positive ? '&#8593;' : '&#8595;'}</span>
        <div>
          <strong>${escapeHtml(entry.label)}</strong>
          <small>${escapeHtml(sub)}</small>
        </div>
        <span class="amount ${positive ? 'positive' : 'negative'}">${signs[entry.type]}${money(entry.amount).replace('-', '')}</span>
        <button class="remove-entry" type="button" data-remove="${entry.id}" aria-label="Delete this entry">&#10005;</button>
      </div>`;
  }).join('');
}

/* ---------- profile ---------- */

function renderProfile() {
  const user = state.user;
  if (!user) return;

  const initial = (user.name || user.first || 'W').trim().charAt(0).toUpperCase();
  $('#avatar').textContent = initial;
  $('#profile-name').textContent = user.name;
  $('#profile-handle').textContent = `@${(user.first || user.name).toLowerCase().replace(/\s+/g, '')}`;
  $('#profile-email').textContent = user.email;
  $('#profile-since').textContent = longDate(user.memberSince);
  $('#greeting').textContent = `Hey, ${(user.name || '').split(' ')[0]}!`;

  $('#stat-goals').textContent = String(state.goals.length);
  $('#stat-saved').textContent = money(state.goals.reduce((total, goal) => total + savedFor(goal.id), 0));
  $('#stat-checkins').textContent = String(state.entries.filter((entry) => entry.type === 'deposit').length);

  $('#setting-name').value = user.name;
  $('#profile-currency').value = state.currency;
  $('#setting-reminders').checked = state.reminders;
}

function renderCurrencySymbols() {
  const symbol = CURRENCIES[state.currency].symbol;
  $$('.currency-symbol').forEach((node) => { node.textContent = symbol; });
}

function render() {
  renderCurrencySymbols();
  renderHome();
  renderGoals();
  renderHistory();
  renderProfile();
  save();
}

/* ---------- dragging ----------
   Mouse users get click-and-drag; touch devices keep their own native
   swipe because it feels better than anything reimplemented here. */

function enableDrag(track, onRelease) {
  let pointerId = null;
  let startX = 0;
  let startScroll = 0;
  let travelled = 0;

  track.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse') return;
    pointerId = event.pointerId;
    travelled = 0;
    startX = event.clientX;
    startScroll = track.scrollLeft;
    track.classList.add('dragging');
    track.setPointerCapture(pointerId);
  });

  track.addEventListener('pointermove', (event) => {
    if (pointerId === null) return;
    const moved = event.clientX - startX;
    travelled = Math.max(travelled, Math.abs(moved));
    track.scrollLeft = startScroll - moved;
  });

  const stop = () => {
    if (pointerId === null) return;
    if (track.hasPointerCapture(pointerId)) track.releasePointerCapture(pointerId);
    pointerId = null;
    track.classList.remove('dragging');
    if (onRelease) onRelease();
  };

  track.addEventListener('pointerup', stop);
  track.addEventListener('pointercancel', stop);

  // Swallow the click that follows a real drag so cards don't fire by accident.
  track.addEventListener('click', (event) => {
    if (travelled > 6) { event.preventDefault(); event.stopPropagation(); }
  }, true);
}

function snapCarousel() {
  scrollToGoalIndex(goalIndexFromScroll(), true);
}

function syncActiveFromScroll() {
  if (!state.goals.length) return;
  const goal = state.goals[goalIndexFromScroll()];
  if (!goal || goal.id === state.activeGoalId) return;

  state.activeGoalId = goal.id;
  $$('#carousel-dots i').forEach((dot) => dot.classList.toggle('on', dot.dataset.goal === goal.id));
  renderCheckins();
  renderHomeStats();
  save();
}

/* ---------- goal builder ---------- */

let editingGoalId = null;

// Live values inside the sheet, kept apart from the saved goal.
let draft = { name: '', target: 200, timeframe: '180', deadline: '', cadence: 'week', contribution: 0 };

function draftDeadline() {
  return draft.timeframe === 'custom' ? draft.deadline : addDays(today(), Number(draft.timeframe));
}

function openGoalSheet(goalId) {
  editingGoalId = goalId || null;
  const goal = goalId ? goalById(goalId) : null;

  if (goal) {
    draft = {
      name: goal.name,
      target: goal.target,
      timeframe: 'custom',
      deadline: goal.deadline,
      cadence: goal.cadence,
      contribution: goal.contribution
    };
    $('#goal-eyebrow').textContent = 'Edit goal';
    $('#goal-heading').textContent = 'Adjust the plan.';
    $('#save-goal').innerHTML = 'Save changes <span>&rarr;</span>';
    $('#delete-goal').hidden = false;
  } else {
    draft = { name: '', target: 200, timeframe: '180', deadline: addDays(today(), 180), cadence: 'week', contribution: 0 };
    draft.contribution = Math.round(requiredPerPeriod(draft.target, 0, 7, draftDeadline()) * 100) / 100;
    $('#goal-eyebrow').textContent = 'New goal';
    $('#goal-heading').textContent = 'Set a target.';
    $('#save-goal').innerHTML = 'Save goal <span>&rarr;</span>';
    $('#delete-goal').hidden = true;
  }

  $('#goal-name-input').value = draft.name;
  $('#goal-target-input').value = draft.target;
  $('#goal-timeframe-input').value = draft.timeframe;
  $('#goal-date-input').value = draftDeadline();
  $('#goal-date-wrap').hidden = draft.timeframe !== 'custom';
  $('#goal-contribution-input').value = draft.contribution ? draft.contribution.toFixed(2) : '';

  renderCurrencySymbols();
  renderPlanner();
  openModal('goal-modal');
}

function renderPlanner() {
  const deadline = draftDeadline();
  const saved = editingGoalId ? savedFor(editingGoalId) : 0;
  const cadence = CADENCES.find((option) => option.id === draft.cadence);

  $('#cadence-chips').innerHTML = CADENCES.map((option) => {
    const amount = requiredPerPeriod(draft.target, saved, option.days, deadline);
    const chosen = option.id === draft.cadence ? 'recommended' : '';
    return `<button class="${chosen}" type="button" data-cadence="${option.id}">
      ${option.label}<b>${money(amount)}</b>
    </button>`;
  }).join('');

  const contribution = draft.contribution;
  if (!contribution || contribution <= 0) {
    $('#plan-summary-value').textContent = 'Choose an amount';
  } else {
    const remaining = Math.max(draft.target - saved, 0);
    const finish = addDays(today(), Math.ceil(remaining / contribution) * cadence.days);
    $('#plan-summary-value').textContent = `${money(contribution)} / ${cadence.per} → ${planDate(finish)}`;
  }

  const suggestions = planSuggestions(draft.target, saved, deadline, cadence, contribution);
  $('#plan-suggestions').innerHTML = suggestions.map((suggestion) => `
    <button class="suggestion-card" type="button" data-fix="${suggestion.kind}" data-value="${suggestion.value}">
      <strong>${escapeHtml(suggestion.title)}</strong>
      <small>${escapeHtml(suggestion.note)}</small>
    </button>`).join('');
}

function applySuggestion(kind, value) {
  if (kind === 'amount') {
    draft.contribution = Number(value);
    $('#goal-contribution-input').value = draft.contribution.toFixed(2);
  }
  if (kind === 'deadline') {
    draft.timeframe = 'custom';
    draft.deadline = value;
    $('#goal-timeframe-input').value = 'custom';
    $('#goal-date-input').value = value;
    $('#goal-date-wrap').hidden = false;
  }
  if (kind === 'cadence') {
    draft.cadence = value;
  }
  renderPlanner();
}

function saveGoalFromSheet() {
  const name = $('#goal-name-input').value.trim() || 'My goal';
  const target = Number($('#goal-target-input').value) || 0;
  const contribution = Number($('#goal-contribution-input').value) || 0;
  const deadline = draftDeadline();

  if (target <= 0 || contribution <= 0) {
    $('#goal-contribution-input').focus();
    return;
  }

  if (editingGoalId) {
    Object.assign(goalById(editingGoalId), { name, target, contribution, deadline, cadence: draft.cadence });
  } else {
    const goal = {
      id: uid(),
      name,
      target,
      contribution,
      deadline,
      cadence: draft.cadence,
      startDate: today(),
      createdAt: Date.now()
    };
    state.goals.push(goal);
    state.activeGoalId = goal.id;
  }

  closeModals();
  render();
  showPage('home-page');
}

/* ---------- deposits ---------- */

let depositMode = 'deposit';

function openDepositSheet(prefill) {
  const goal = activeGoal();
  if (!goal) { openGoalSheet(); return; }

  depositMode = 'deposit';
  $$('#deposit-mode button').forEach((button) => button.classList.toggle('active', button.dataset.mode === 'deposit'));

  $('#deposit-goal').innerHTML = state.goals
    .map((option) => `<option value="${option.id}">${escapeHtml(option.name)}</option>`)
    .join('');
  $('#deposit-goal').value = goal.id;

  const next = nextDueCard(goal);
  const planned = prefill || (next ? next.amount : goal.contribution);
  $('#deposit-input').value = planned.toFixed(2);

  const steps = [planned, planned * 2, planned / 2].map((value) => Math.round(value * 100) / 100);
  $('#deposit-suggestions').innerHTML = steps
    .filter((value) => value > 0)
    .map((value) => `<button type="button" data-amount="${value}">${shortMoney(value)}</button>`)
    .join('');

  $('#deposit-error').hidden = true;
  renderCurrencySymbols();
  updateDepositHint();
  openModal('deposit-modal');
}

// Shows what this exact deposit does to the finish date before it happens.
function updateDepositHint() {
  const goal = goalById($('#deposit-goal').value);
  const amount = Number($('#deposit-input').value) || 0;
  const hint = $('#deposit-hint');
  if (!goal || amount <= 0) { hint.textContent = ''; return; }

  const cadence = cadenceOf(goal);
  const saved = savedFor(goal.id);
  const after = depositMode === 'withdraw' ? saved - amount : saved + amount;
  const remaining = goal.target - after;

  if (remaining <= 0) {
    hint.textContent = `That finishes ${goal.name}. Nice.`;
    return;
  }
  const finish = addDays(today(), Math.ceil(remaining / goal.contribution) * cadence.days);
  const drift = daysBetween(goal.deadline, finish);
  const when = drift === 0 ? 'exactly on your deadline'
    : drift < 0 ? `${Math.abs(drift)} days before your deadline`
      : `${drift} days after your deadline`;
  hint.textContent = `New finish date: ${longDate(finish)} — ${when}.`;
}

function confirmDeposit() {
  const goal = goalById($('#deposit-goal').value);
  const amount = Number($('#deposit-input').value);
  const error = $('#deposit-error');

  if (!goal || !amount || amount <= 0) {
    error.textContent = 'Enter an amount above zero.';
    error.hidden = false;
    return;
  }
  if (depositMode === 'withdraw' && amount > savedFor(goal.id)) {
    error.textContent = `You only have ${money(savedFor(goal.id))} in ${goal.name}.`;
    error.hidden = false;
    return;
  }

  state.entries.push({
    id: uid(),
    type: depositMode,
    goalId: goal.id,
    label: depositMode === 'withdraw' ? `Took out of ${goal.name}` : `Deposit to ${goal.name}`,
    amount,
    date: today(),
    createdAt: Date.now()
  });

  state.activeGoalId = goal.id;
  closeModals();
  render();
}

/* ---------- manual history entries ---------- */

let entryMode = 'income';

function openEntrySheet() {
  entryMode = 'income';
  $$('#entry-mode button').forEach((button) => button.classList.toggle('active', button.dataset.mode === 'income'));
  $('#entry-label').value = '';
  $('#entry-amount').value = '20';
  $('#entry-date').value = today();
  $('#entry-error').hidden = true;
  renderCurrencySymbols();
  openModal('entry-modal');
}

function confirmEntry() {
  const label = $('#entry-label').value.trim();
  const amount = Number($('#entry-amount').value);
  const date = $('#entry-date').value || today();
  const error = $('#entry-error');

  if (!label) {
    error.textContent = 'Give it a name so you recognise it later.';
    error.hidden = false;
    return;
  }
  if (!amount || amount <= 0) {
    error.textContent = 'Enter an amount above zero.';
    error.hidden = false;
    return;
  }

  state.entries.push({ id: uid(), type: entryMode, goalId: null, label, amount, date, createdAt: Date.now() });
  closeModals();
  render();
}

/* ---------- sign in ---------- */

let authMode = 'create';

function setAuthMode(mode) {
  authMode = mode;
  const creating = mode === 'create';
  $$('#auth-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  $$('.when-create').forEach((field) => { field.hidden = !creating; });
  $('#auth-title').innerHTML = creating ? "Let's make your<br>money feel lighter." : 'Welcome back.';
  $('#auth-subtitle').textContent = creating
    ? 'Tell us a little about you to personalise your space.'
    : 'Sign in with the details you used on this device.';
  $('#auth-submit').innerHTML = creating ? 'Create my space <span>&rarr;</span>' : 'Sign in <span>&rarr;</span>';
  $('#auth-error').hidden = true;
}

function handleAuth(event) {
  event.preventDefault();
  const email = $('#email-input').value.trim().toLowerCase();
  const password = $('#password-input').value;
  const error = $('#auth-error');

  if (password.length < 6) {
    error.textContent = 'Password needs at least 6 characters.';
    error.hidden = false;
    return;
  }

  if (authMode === 'signin') {
    if (!state.user || state.user.email !== email || state.user.password !== scramble(password)) {
      error.textContent = 'No space on this device matches those details.';
      error.hidden = false;
      return;
    }
  } else {
    const first = $('#first-name-input').value.trim();
    const last = $('#last-name-input').value.trim();
    const nickname = $('#name-input').value.trim();

    if (!first) {
      error.textContent = 'A first name helps us greet you properly.';
      error.hidden = false;
      return;
    }

    state.user = {
      first,
      last,
      name: nickname || `${first} ${last}`.trim(),
      email,
      password: scramble(password),
      memberSince: today()
    };
    state.currency = $('#currency-input').value;
  }

  error.hidden = true;
  render();
  showScreen('app-view');
  showPage('home-page');
}

/* ---------- wiring ---------- */

$$('[data-page]').forEach((button) => {
  button.addEventListener('click', () => showPage(button.dataset.page));
});

$$('[data-action]').forEach((button) => {
  button.addEventListener('click', () => {
    switch (button.dataset.action) {
      case 'start': setAuthMode('create'); showScreen('signin-view'); break;
      case 'signin': setAuthMode(state.user ? 'signin' : 'create'); showScreen('signin-view'); break;
      case 'welcome': showScreen('welcome-view'); break;
      case 'deposit': openDepositSheet(); break;
      case 'new-goal': openGoalSheet(); break;
      case 'new-entry': openEntrySheet(); break;
      case 'close-modal': closeModals(); break;
      case 'checkin-next': $('#checkin-track').scrollBy({ left: 240, behavior: 'smooth' }); break;
      case 'signout': showScreen('welcome-view'); break;
      default: break;
    }
  });
});

$('#profile-form').addEventListener('submit', handleAuth);
$$('#auth-tabs button').forEach((tab) => tab.addEventListener('click', () => setAuthMode(tab.dataset.mode)));

// Home carousel
const carousel = $('#goal-carousel');
enableDrag(carousel, snapCarousel);
carousel.addEventListener('scroll', syncActiveFromScroll);
$('#carousel-dots').addEventListener('click', (event) => {
  const dot = event.target.closest('i');
  if (!dot) return;
  scrollToGoalIndex(state.goals.findIndex((goal) => goal.id === dot.dataset.goal), true);
});

// Check-in strip
const checkinTrack = $('#checkin-track');
enableDrag(checkinTrack);
checkinTrack.addEventListener('click', (event) => {
  const card = event.target.closest('[data-checkin]');
  if (card) openDepositSheet(Number(card.dataset.amount));
});

// Goals list
$('#goal-list').addEventListener('click', (event) => {
  const edit = event.target.closest('[data-edit]');
  if (edit) { openGoalSheet(edit.dataset.edit); return; }
  const card = event.target.closest('[data-goal]');
  if (card) {
    state.activeGoalId = card.dataset.goal;
    render();
    showPage('home-page');
  }
});

// Goal builder inputs
$('#goal-name-input').addEventListener('input', (event) => { draft.name = event.target.value; });
$('#goal-target-input').addEventListener('input', (event) => {
  draft.target = Number(event.target.value) || 0;
  renderPlanner();
});
$('#goal-timeframe-input').addEventListener('change', (event) => {
  draft.timeframe = event.target.value;
  $('#goal-date-wrap').hidden = draft.timeframe !== 'custom';
  if (draft.timeframe !== 'custom') $('#goal-date-input').value = draftDeadline();
  else draft.deadline = $('#goal-date-input').value || addDays(today(), 180);
  renderPlanner();
});
$('#goal-date-input').addEventListener('change', (event) => {
  draft.timeframe = 'custom';
  draft.deadline = event.target.value;
  $('#goal-timeframe-input').value = 'custom';
  renderPlanner();
});
$('#goal-contribution-input').addEventListener('input', (event) => {
  draft.contribution = Number(event.target.value) || 0;
  renderPlanner();
});
$('#cadence-chips').addEventListener('click', (event) => {
  const chip = event.target.closest('[data-cadence]');
  if (!chip) return;
  draft.cadence = chip.dataset.cadence;
  // Moving rhythm without an amount yet? Fill in the one that fits.
  const option = CADENCES.find((item) => item.id === draft.cadence);
  const saved = editingGoalId ? savedFor(editingGoalId) : 0;
  const suggested = requiredPerPeriod(draft.target, saved, option.days, draftDeadline());
  draft.contribution = Math.round(suggested * 100) / 100;
  $('#goal-contribution-input').value = draft.contribution.toFixed(2);
  renderPlanner();
});
$('#plan-suggestions').addEventListener('click', (event) => {
  const fix = event.target.closest('[data-fix]');
  if (fix) applySuggestion(fix.dataset.fix, fix.dataset.value);
});
$('#save-goal').addEventListener('click', saveGoalFromSheet);
$('#delete-goal').addEventListener('click', () => {
  if (!editingGoalId) return;
  state.goals = state.goals.filter((goal) => goal.id !== editingGoalId);
  state.entries = state.entries.filter((entry) => entry.goalId !== editingGoalId);
  if (state.activeGoalId === editingGoalId) state.activeGoalId = state.goals[0] ? state.goals[0].id : null;
  editingGoalId = null;
  closeModals();
  render();
});

// Deposit sheet
$$('#deposit-mode button').forEach((button) => button.addEventListener('click', () => {
  depositMode = button.dataset.mode;
  $$('#deposit-mode button').forEach((other) => other.classList.toggle('active', other === button));
  const withdrawing = depositMode === 'withdraw';
  $('#deposit-eyebrow').textContent = withdrawing ? 'Take money back out' : 'Add to your goal';
  $('#deposit-heading').textContent = withdrawing ? 'Life happens.' : 'Every little bit counts.';
  $('#confirm-deposit').innerHTML = `${withdrawing ? 'Take it out' : 'Make deposit'} <span>&rarr;</span>`;
  $('#deposit-error').hidden = true;
  updateDepositHint();
}));
$('#deposit-goal').addEventListener('change', updateDepositHint);
$('#deposit-input').addEventListener('input', updateDepositHint);
$('#deposit-suggestions').addEventListener('click', (event) => {
  const chip = event.target.closest('[data-amount]');
  if (!chip) return;
  $('#deposit-input').value = Number(chip.dataset.amount).toFixed(2);
  updateDepositHint();
});
$('#confirm-deposit').addEventListener('click', confirmDeposit);

// Entry sheet
$$('#entry-mode button').forEach((button) => button.addEventListener('click', () => {
  entryMode = button.dataset.mode;
  $$('#entry-mode button').forEach((other) => other.classList.toggle('active', other === button));
}));
$('#confirm-entry').addEventListener('click', confirmEntry);

// History
$$('#history-tabs button').forEach((tab) => tab.addEventListener('click', () => {
  historyFilter = tab.dataset.filter;
  $$('#history-tabs button').forEach((other) => other.classList.toggle('active', other === tab));
  renderHistory();
}));
$('#transactions').addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove]');
  if (!remove) return;
  state.entries = state.entries.filter((entry) => entry.id !== remove.dataset.remove);
  render();
});

// Profile settings
$('#setting-name').addEventListener('input', (event) => {
  if (!state.user) return;
  state.user.name = event.target.value;
  save();
});
$('#setting-name').addEventListener('change', renderProfile);
$('#profile-currency').addEventListener('change', (event) => {
  state.currency = event.target.value;
  render();
});
$('#setting-reminders').addEventListener('change', (event) => {
  state.reminders = event.target.checked;
  save();
});

// Tapping the dimmed background closes a sheet.
$$('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => {
  if (event.target === backdrop) closeModals();
}));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModals();
});

// Keep the carousel lined up if the window changes size.
window.addEventListener('resize', () => {
  if (activeGoal()) scrollToGoalIndex(state.goals.indexOf(activeGoal()));
});

/* ---------- start ---------- */

load();
setAuthMode('create');
render();
if (state.user) {
  showScreen('app-view');
  showPage('home-page');
}
