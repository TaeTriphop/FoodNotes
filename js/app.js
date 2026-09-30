import { PEOPLE } from "./config.js";
import * as api from "./api.js";

const app = document.getElementById("app");

/* ---------- ค่าคงที่ ---------- */

const R_VERDICTS = [
  { key: "revisit", label: "ซ้ำ", tone: "good" },
  { key: "meh", label: "เฉยๆ", tone: "neutral" },
  { key: "no", label: "ไม่ซ้ำ", tone: "bad" },
  { key: "wishlist", label: "อยากไป", tone: "wish" },
];
const D_VERDICTS = [
  { key: "order", label: "สั่งอีก", tone: "good", icon: "👍" },
  { key: "meh", label: "เฉยๆ", tone: "neutral", icon: "😐" },
  { key: "skip", label: "ไม่สั่ง", tone: "bad", icon: "👎" },
];
const byKey = (list) => Object.fromEntries(list.map((v) => [v.key, v]));
const RV = byKey(R_VERDICTS);
const DV = byKey(D_VERDICTS);

const PRESETS = {
  order: ["เผ็ดน้อย", "เผ็ดกลาง", "เผ็ดมาก", "หวานน้อย", "ไม่ใส่ผักชี", "กินไม่ได้"],
  reasons: ["ไม่อร่อย", "ได้น้อย ไม่คุ้ม", "เค็มไป", "หวานไป", "เผ็ดไป", "รอนาน"],
  category: ["ร้านอาหาร", "คาเฟ่", "ขนม"],
  area: [],
};

const svg = (inner, fill = "none") =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  edit: svg('<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  dots: svg('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>', "currentColor"),
  dice: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r=".8" fill="currentColor"/><circle cx="15" cy="15" r=".8" fill="currentColor"/><circle cx="15" cy="9" r=".8" fill="currentColor"/><circle cx="9" cy="15" r=".8" fill="currentColor"/>'),
};

/* ---------- state ---------- */

const state = {
  restaurants: [],
  dishes: [],
  loaded: false,
  query: "",
  category: null,
  verdict: null,
  area: null,
  sort: "recent",
};

let sheet = null; // dialog ที่เปิดอยู่
let form = null; // ข้อมูลของฟอร์มใน sheet
let lastSnapshot = "";

/* ---------- utilities ---------- */

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const arr = (v) => (Array.isArray(v) ? v : []);
const byThaiName = (a, b) => a.name.localeCompare(b.name, "th");

function safeUrl(u) {
  try {
    const url = new URL(u);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function todayStr() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

function daysAgo(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date();
  return Math.round((Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) - Date.UTC(y, m - 1, d)) / 86400000);
}

function relVisit(r) {
  if (!r.last_visited) return r.verdict === "wishlist" ? "ยังไม่เคยไป" : "ยังไม่ได้จดเมนู";
  const n = daysAgo(r.last_visited);
  if (n <= 0) return "ไปวันนี้";
  if (n === 1) return "ไปเมื่อวาน";
  if (n < 7) return `ไป ${n} วันก่อน`;
  if (n < 30) return `ไป ${Math.floor(n / 7)} สัปดาห์ก่อน`;
  if (n < 365) return `ไป ${Math.floor(n / 30)} เดือนก่อน`;
  return `ไป ${Math.floor(n / 365)} ปีก่อน`;
}

const activity = (r) => r.last_visited || (r.created_at || "").slice(0, 10);

function currentRid() {
  const m = location.hash.match(/^#\/r\/([\w-]+)/);
  return m ? m[1] : null;
}

function toast(msg) {
  const inSheet = sheet?.querySelector(".sheet-msg");
  if (inSheet) {
    inSheet.textContent = msg;
    return;
  }
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2400);
}

function errorText(e) {
  const m = e?.message || String(e);
  if (/fetch|network/i.test(m)) return "เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง";
  return `ทำรายการไม่สำเร็จ: ${m}`;
}

async function guard(fn, btn) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    toast(errorText(e));
    return null;
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ---------- data ---------- */

function normRestaurant(r) {
  return { ...r, order_shared: arr(r.order_shared), order_me: arr(r.order_me), order_her: arr(r.order_her) };
}
function normDish(d) {
  return { ...d, order_shared: arr(d.order_shared), order_me: arr(d.order_me), order_her: arr(d.order_her), reasons: arr(d.reasons) };
}

async function refresh({ rerender = true, onlyIfChanged = false } = {}) {
  const data = await api.loadAll();
  const snapshot = JSON.stringify(data);
  const changed = snapshot !== lastSnapshot;
  lastSnapshot = snapshot;
  state.restaurants = data.restaurants.map(normRestaurant);
  state.dishes = data.dishes.map(normDish);
  state.loaded = true;
  if (rerender && (!onlyIfChanged || changed)) {
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
  }
}

// แท็กที่เคยใช้ เรียงจากใช้บ่อยสุด ถ้าระบุร้าน แท็กที่เคยใช้ในร้านนั้นจะขึ้นก่อน
function suggestions(kind, rid = null) {
  const counts = new Map();
  const add = (v, w) => v && counts.set(v, (counts.get(v) || 0) + w);
  if (kind === "order") {
    for (const x of [...state.restaurants, ...state.dishes]) {
      const w = rid && (x.id === rid || x.restaurant_id === rid) ? 1000 : 1;
      for (const v of [...x.order_shared, ...x.order_me, ...x.order_her]) add(v, w);
    }
  } else if (kind === "reasons") {
    for (const d of state.dishes) for (const v of d.reasons) add(v, rid && d.restaurant_id === rid ? 1000 : 1);
  } else {
    for (const r of state.restaurants) add(r[kind], 1);
  }
  const used = [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  return [...new Set([...used, ...PRESETS[kind]])];
}

const hasOrder = (x) => x.order_shared.length || x.order_me.length || x.order_her.length;

function orderHtml(x) {
  const parts = [];
  if (x.order_shared.length) parts.push(`<span class="o-part">${esc(x.order_shared.join(", "))}</span>`);
  if (x.order_me.length) parts.push(`<span class="o-part"><b>${esc(PEOPLE.me)}</b> ${esc(x.order_me.join(", "))}</span>`);
  if (x.order_her.length) parts.push(`<span class="o-part"><b>${esc(PEOPLE.her)}</b> ${esc(x.order_her.join(", "))}</span>`);
  return parts.join("");
}

/* ---------- router ---------- */

function route() {
  if (!state.loaded) return;
  const rid = currentRid();
  if (rid) renderRestaurant(rid);
  else renderHome();
}

window.addEventListener("hashchange", () => {
  closeSheet();
  route();
  window.scrollTo(0, 0);
});

/* ---------- หน้ารายการร้าน ---------- */

function filteredRestaurants() {
  const q = state.query.trim().toLowerCase();
  const list = state.restaurants.filter(
    (r) =>
      (!state.category || r.category === state.category) &&
      (!state.verdict || r.verdict === state.verdict) &&
      (!state.area || r.area === state.area) &&
      (!q || r.name.toLowerCase().includes(q) || (r.area || "").toLowerCase().includes(q))
  );
  if (state.sort === "name") return list.sort(byThaiName);
  if (state.sort === "oldest") {
    return list.sort((a, b) => {
      if (!a.last_visited) return 1;
      if (!b.last_visited) return -1;
      return a.last_visited.localeCompare(b.last_visited);
    });
  }
  return list.sort((a, b) => activity(b).localeCompare(activity(a)) || (b.created_at || "").localeCompare(a.created_at || ""));
}

function chipRow(key, items, current, label) {
  return `<div class="chip-row" role="group" aria-label="${label}">${items
    .map(([value, text]) => {
      const on = value === current;
      return `<button class="chip ${on ? "is-on" : ""}" data-filter="${key}" data-value="${esc(value ?? "")}" aria-pressed="${on}">${esc(text)}</button>`;
    })
    .join("")}</div>`;
}

function renderHome() {
  document.title = "จดร้าน";
  const cats = suggestions("category").filter((c) => state.restaurants.some((r) => r.category === c));
  const areas = suggestions("area").filter((a) => state.restaurants.some((r) => r.area === a));
  const sortOpt = (v, t) => `<option value="${v}" ${state.sort === v ? "selected" : ""}>${t}</option>`;

  app.innerHTML = `
    <header class="topbar">
      <h1 class="brand">จดร้าน</h1>
      <button class="icon-btn" data-action="menu" aria-label="เมนูเพิ่มเติม">${ICON.dots}</button>
    </header>
    <div class="search-wrap">
      <input id="q" class="search" type="search" placeholder="ค้นหาหรือพิมพ์ชื่อร้านใหม่" value="${esc(state.query)}" autocomplete="off" enterkeyhint="go" aria-label="ค้นหาหรือเพิ่มร้าน">
    </div>
    <div class="filters">
      ${cats.length ? chipRow("category", [[null, "ทุกประเภท"], ...cats.map((c) => [c, c])], state.category, "กรองตามประเภท") : ""}
      ${chipRow("verdict", [[null, "ทุกสถานะ"], ...R_VERDICTS.map((v) => [v.key, v.label])], state.verdict, "กรองตามสถานะ")}
      ${areas.length ? chipRow("area", [[null, "ทุกย่าน"], ...areas.map((a) => [a, a])], state.area, "กรองตามย่าน") : ""}
    </div>
    <div class="list-tools">
      <label class="sort">เรียง
        <select id="sort">
          ${sortOpt("recent", "ไปล่าสุด")}
          ${sortOpt("oldest", "ไม่ได้ไปนานสุด")}
          ${sortOpt("name", "ชื่อร้าน")}
        </select>
      </label>
      <button class="btn btn-quiet btn-small" data-action="random">${ICON.dice} สุ่มร้าน</button>
    </div>
    <div id="home-list"></div>`;
  renderHomeList();
}

function renderHomeList() {
  const el = document.getElementById("home-list");
  if (!el) return;
  const list = filteredRestaurants();
  const q = state.query.trim();
  const exact = q && state.restaurants.some((r) => r.name.trim().toLowerCase() === q.toLowerCase());
  let html = "";
  if (q && !exact) html += `<button class="add-row" data-action="add-restaurant">${ICON.plus} เพิ่มร้าน “${esc(q)}”</button>`;
  if (list.length) {
    html += `<ul class="r-list">${list.map(restaurantRow).join("")}</ul>`;
  } else if (!q) {
    html += state.restaurants.length
      ? `<p class="empty">ไม่มีร้านที่ตรงกับตัวกรองนี้</p>`
      : `<div class="empty"><p class="empty-title">เริ่มจดร้านแรก</p><p>พิมพ์ชื่อร้านในช่องด้านบน แล้วกดเพิ่มร้าน</p></div>`;
  }
  el.innerHTML = html;
}

function restaurantRow(r) {
  const v = r.verdict ? RV[r.verdict] : null;
  const sub = [r.category, r.area].filter(Boolean).map((s) => `<span>${esc(s)}</span>`).join("");
  return `<li><a class="r-row" href="#/r/${r.id}">
    <span class="r-main">
      <span class="r-name">${esc(r.name)}</span>
      <span class="r-sub">${sub}<span>${relVisit(r)}</span></span>
    </span>
    ${v ? `<span class="badge tone-${v.tone}">${v.label}</span>` : ""}
  </a></li>`;
}

async function addRestaurant(btn) {
  const name = state.query.trim();
  if (!name) return;
  const row = await guard(() => api.saveRestaurant({ name, category: state.category, area: state.area }), btn);
  if (!row) return;
  state.query = "";
  await guard(() => refresh({ rerender: false }));
  location.hash = `#/r/${row.id}`;
}

function openRandom() {
  let pool = filteredRestaurants();
  if (!state.verdict) pool = pool.filter((r) => r.verdict === "revisit");
  if (!pool.length) {
    toast(state.verdict ? "ไม่มีร้านให้สุ่มในตัวกรองนี้" : "ยังไม่มีร้านสถานะ “ซ้ำ” ให้สุ่ม");
    return;
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const sub = [pick.category, pick.area, relVisit(pick)].filter(Boolean).join("  ");
  openSheet(`
    <h2 class="sheet-title" tabindex="-1" autofocus>ลองไปร้านนี้ไหม</h2>
    <p class="random-name">${esc(pick.name)}</p>
    <p class="random-sub">${esc(sub)}</p>
    <div class="sheet-actions">
      <button class="btn btn-quiet" data-action="random">สุ่มใหม่</button>
      <span class="spacer"></span>
      <a class="btn btn-primary" href="#/r/${pick.id}">ดูร้าน</a>
    </div>`);
}

function openMenu() {
  openSheet(`
    <h2 class="sheet-title" tabindex="-1" autofocus>เมนูเพิ่มเติม</h2>
    <p class="menu-stats">จดไว้ ${state.restaurants.length} ร้าน ${state.dishes.length} เมนู</p>
    <div class="menu-list">
      <button class="menu-item" data-action="reload">
        <span class="menu-item-title">โหลดข้อมูลใหม่</span>
        <span class="menu-item-sub">ดึงรายการล่าสุดที่อีกคนเพิ่งจด</span>
      </button>
      <button class="menu-item" data-action="export">
        <span class="menu-item-title">สำรองข้อมูล</span>
        <span class="menu-item-sub">ดาวน์โหลดทุกอย่างเป็นไฟล์ JSON เก็บไว้</span>
      </button>
    </div>
    <div class="sheet-actions"><span class="spacer"></span><button class="btn btn-quiet" data-action="close">ปิด</button></div>`);
}

function exportData() {
  const payload = { exported_at: new Date().toISOString(), restaurants: state.restaurants, dishes: state.dishes };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `food-notes-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- หน้าร้าน ---------- */

function renderRestaurant(id) {
  const r = state.restaurants.find((x) => x.id === id);
  if (!r) {
    app.innerHTML = `
      <header class="topbar"><a class="icon-btn" href="#/" aria-label="กลับหน้ารายการร้าน">${ICON.back}</a></header>
      <div class="empty"><p class="empty-title">ไม่พบร้านนี้</p><p>อาจถูกลบไปแล้ว</p></div>`;
    return;
  }
  document.title = r.name;
  const regulars = state.dishes.filter((d) => d.restaurant_id === id && d.is_regular).sort(byThaiName);
  const meta = [r.category, r.area].filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join("");
  const map = r.map_url && safeUrl(r.map_url);

  app.innerHTML = `
    <header class="topbar sticky">
      <a class="icon-btn" href="#/" aria-label="กลับหน้ารายการร้าน">${ICON.back}</a>
      <h1 class="page-title">${esc(r.name)}</h1>
      <button class="icon-btn" data-action="edit-restaurant" aria-label="แก้ไขร้าน">${ICON.edit}</button>
    </header>
    <div class="seg" role="group" aria-label="สถานะร้าน">
      ${R_VERDICTS.map((v) => {
        const on = r.verdict === v.key;
        return `<button class="seg-btn tone-${v.tone} ${on ? "is-on" : ""}" data-action="quick-verdict" data-value="${v.key}" aria-pressed="${on}">${v.label}</button>`;
      }).join("")}
    </div>
    ${meta || map ? `<p class="meta">${meta}${map ? `<a href="${esc(map)}" target="_blank" rel="noopener">เปิดแผนที่</a>` : ""}</p>` : ""}
    ${hasOrder(r) ? `<p class="shop-order"><span class="shop-order-label">สั่งทั้งร้าน</span>${orderHtml(r)}</p>` : ""}
    ${r.note ? `<p class="note">${esc(r.note)}</p>` : ""}
    ${regulars.length ? slipHtml(regulars) : ""}
    <div class="search-wrap">
      <input id="dq" class="search" type="search" placeholder="ค้นหาหรือเพิ่มเมนู" autocomplete="off" enterkeyhint="go" aria-label="ค้นหาหรือเพิ่มเมนู">
    </div>
    <div id="dish-list"></div>`;
  renderDishList(id);
}

function slipHtml(list) {
  return `<section class="slip" aria-label="ชุดประจำ">
    <h2 class="slip-title">ชุดประจำ</h2>
    <ol class="slip-lines">
      ${list
        .map(
          (d) => `<li><button class="slip-line" data-action="edit-dish" data-id="${d.id}">
            <span class="slip-row"><span class="slip-name">${esc(d.name)}</span>${d.quantity ? `<span class="slip-qty">${esc(d.quantity)}</span>` : ""}</span>
            ${hasOrder(d) ? `<span class="slip-order">${orderHtml(d)}</span>` : ""}
            ${d.note ? `<span class="slip-note">${esc(d.note)}</span>` : ""}
          </button></li>`
        )
        .join("")}
    </ol>
  </section>`;
}

function renderDishList(rid) {
  const el = document.getElementById("dish-list");
  if (!el) return;
  const q = (document.getElementById("dq")?.value || "").trim();
  const all = state.dishes.filter((d) => d.restaurant_id === rid).sort(byThaiName);

  if (q) {
    const hits = all.filter((d) => d.name.toLowerCase().includes(q.toLowerCase()));
    const exact = all.some((d) => d.name.trim().toLowerCase() === q.toLowerCase());
    el.innerHTML = `
      ${exact ? "" : `<button class="add-row" data-action="add-dish">${ICON.plus} เพิ่มเมนู “${esc(q)}”</button>`}
      ${hits.length ? `<ul class="d-list">${hits.map(dishRow).join("")}</ul>` : `<p class="empty">ยังไม่เคยจดเมนูนี้</p>`}`;
    return;
  }

  if (!all.length) {
    el.innerHTML = `<div class="empty"><p class="empty-title">ยังไม่มีเมนู</p><p>พิมพ์ชื่อเมนูในช่องด้านบน แล้วกดเพิ่มเมนู</p></div>`;
    return;
  }

  const rest = all.filter((d) => !d.is_regular);
  const groups = [
    ["สั่งอีก", rest.filter((d) => d.verdict === "order")],
    ["เฉยๆ", rest.filter((d) => d.verdict === "meh")],
    ["ยังไม่ได้ให้คะแนน", rest.filter((d) => !d.verdict)],
    ["ไม่สั่ง", rest.filter((d) => d.verdict === "skip")],
  ].filter((g) => g[1].length);

  el.innerHTML =
    groups
      .map(
        ([title, list]) => `<section class="d-group">
          <h2 class="group-title">${title}<span class="count">${list.length}</span></h2>
          <ul class="d-list">${list.map(dishRow).join("")}</ul>
        </section>`
      )
      .join("") + `<button class="add-row subtle" data-action="add-dish">${ICON.plus} เพิ่มเมนู</button>`;
}

function dishRow(d) {
  const v = d.verdict ? DV[d.verdict] : null;
  return `<li><button class="d-row ${v ? `tone-${v.tone}` : ""}" data-action="edit-dish" data-id="${d.id}">
    <span class="d-head">
      <span class="d-name">${esc(d.name)}</span>
      ${d.quantity ? `<span class="d-qty">${esc(d.quantity)}</span>` : ""}
      ${d.is_regular ? `<span class="d-pin">ชุดประจำ</span>` : ""}
    </span>
    ${hasOrder(d) ? `<span class="d-order">${orderHtml(d)}</span>` : ""}
    ${d.verdict === "skip" && d.reasons.length ? `<span class="d-reasons">${esc(d.reasons.join(", "))}</span>` : ""}
    ${d.note ? `<span class="d-note">${esc(d.note)}</span>` : ""}
  </button></li>`;
}

async function quickVerdict(value, btn) {
  const r = state.restaurants.find((x) => x.id === currentRid());
  if (!r) return;
  const verdict = r.verdict === value ? null : value;
  const ok = await guard(() => api.saveRestaurant({ verdict }, r.id), btn);
  if (ok) await guard(() => refresh());
}

/* ---------- bottom sheet ---------- */

function openSheet(html) {
  closeSheet();
  const d = document.createElement("dialog");
  d.className = "sheet";
  d.innerHTML = `<div class="sheet-body">${html}</div>`;
  d.addEventListener("close", () => {
    d.remove();
    if (sheet === d) {
      sheet = null;
      form = null;
    }
  });
  d.addEventListener("click", (e) => {
    if (e.target === d) closeSheet();
  });
  document.body.appendChild(d);
  sheet = d;
  d.showModal();
}

function closeSheet() {
  if (!sheet) return;
  const d = sheet;
  sheet = null;
  form = null;
  d.close();
  d.remove();
}

const val = (sel) => (sheet?.querySelector(sel)?.value || "").trim();

function fieldError(sel, msg) {
  const input = sheet.querySelector(sel);
  let err = input.parentElement.querySelector(".field-error");
  if (!err) {
    err = document.createElement("p");
    err.className = "field-error";
    input.insertAdjacentElement("afterend", err);
    input.addEventListener("input", () => err.remove(), { once: true });
  }
  err.textContent = msg;
  input.focus();
}

/* ---------- ช่องแท็ก ---------- */

function tagFieldHtml(field) {
  const f = form.tags[field];
  const selected = [...f.values];
  const rid = form.type === "dish" ? form.rid : form.id;
  const limit = f.kind === "area" || f.kind === "category" ? 12 : 8;
  const shown = [...new Set([...selected, ...suggestions(f.kind, rid)])].slice(0, Math.max(limit, selected.length));
  return `<div class="tag-field" data-field="${field}">
    ${shown
      .map((t) => {
        const on = f.values.has(t);
        return `<button type="button" class="chip ${on ? "is-on" : ""}" data-action="toggle-tag" data-field="${field}" data-value="${esc(t)}" aria-pressed="${on}">${esc(t)}</button>`;
      })
      .join("")}
    <button type="button" class="chip chip-add" data-action="new-tag" data-field="${field}">${ICON.plus} เพิ่ม</button>
  </div>`;
}

function rerenderTagField(field) {
  const el = sheet?.querySelector(`.tag-field[data-field="${field}"]`);
  if (el) el.outerHTML = tagFieldHtml(field);
}

function toggleTag(field, value) {
  const f = form.tags[field];
  if (f.values.has(value)) f.values.delete(value);
  else {
    if (f.single) f.values.clear();
    f.values.add(value);
  }
  rerenderTagField(field);
}

function startNewTag(field, btn) {
  const input = document.createElement("input");
  input.className = "tag-input";
  input.placeholder = "พิมพ์แล้วกด Enter";
  input.enterKeyHint = "done";
  btn.replaceWith(input);
  input.focus();
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (keep && v && form) {
      const f = form.tags[field];
      if (f.single) f.values.clear();
      f.values.add(v);
    }
    rerenderTagField(field);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

function splitHtml() {
  if (!form.split) return `<button type="button" class="link-btn" data-action="split-on">+ สั่งแยกคน</button>`;
  return `
    <div class="split-sub"><span class="who">${esc(PEOPLE.me)}</span>${tagFieldHtml("order_me")}</div>
    <div class="split-sub"><span class="who">${esc(PEOPLE.her)}</span>${tagFieldHtml("order_her")}</div>
    <button type="button" class="link-btn" data-action="split-off">สั่งเหมือนกัน ไม่ต้องแยก</button>`;
}

function setSplit(on) {
  form.split = on;
  if (!on) {
    form.tags.order_me.values.clear();
    form.tags.order_her.values.clear();
  }
  sheet.querySelector("#split-area").innerHTML = splitHtml();
}

function verdictButtons() {
  const list = form.type === "dish" ? D_VERDICTS : R_VERDICTS;
  return list
    .map((v) => {
      const on = form.verdict === v.key;
      return `<button type="button" class="verdict-btn tone-${v.tone} ${on ? "is-on" : ""}" data-action="form-verdict" data-value="${v.key}" aria-pressed="${on}">
        ${v.icon ? `<span class="emo" aria-hidden="true">${v.icon}</span>` : ""}${v.label}
      </button>`;
    })
    .join("");
}

function setFormVerdict(value) {
  form.verdict = form.verdict === value ? null : value;
  sheet.querySelector("#verdict-grid").innerHTML = verdictButtons();
  const reasons = sheet.querySelector("#reasons-field");
  if (reasons) reasons.hidden = form.verdict !== "skip";
}

const tagSet = (kind, values, single = false) => ({ kind, single, values: new Set(values) });

/* ---------- ฟอร์มเมนู ---------- */

function openDishSheet(dish, presetName = "") {
  const d = dish || { name: presetName, verdict: null, is_regular: false, quantity: "", order_shared: [], order_me: [], order_her: [], reasons: [], note: "" };
  form = null;
  const draft = {
    type: "dish",
    id: dish?.id || null,
    rid: currentRid(),
    verdict: d.verdict,
    split: d.order_me.length > 0 || d.order_her.length > 0,
    tags: {
      order_shared: tagSet("order", d.order_shared),
      order_me: tagSet("order", d.order_me),
      order_her: tagSet("order", d.order_her),
      reasons: tagSet("reasons", d.reasons),
    },
  };
  form = draft;
  const html = `
    <h2 class="sheet-title" tabindex="-1" ${dish || presetName ? "autofocus" : ""}>${dish ? "แก้ไขเมนู" : "เพิ่มเมนู"}</h2>
    <label class="field">
      <span class="field-label">ชื่อเมนู</span>
      <input id="f-name" value="${esc(d.name)}" placeholder="ส้มตำไทย" autocomplete="off" ${dish || presetName ? "" : "autofocus"}>
    </label>
    <div class="field">
      <span class="field-label">เป็นยังไงบ้าง</span>
      <div class="verdict-grid" id="verdict-grid">${verdictButtons()}</div>
    </div>
    <div class="field" id="reasons-field" ${d.verdict === "skip" ? "" : "hidden"}>
      <span class="field-label">ทำไมไม่สั่ง</span>
      ${tagFieldHtml("reasons")}
    </div>
    <label class="switch-row">
      <input type="checkbox" id="f-regular" ${d.is_regular ? "checked" : ""}>
      <span>ปักเป็นชุดประจำ</span>
      <span class="hint">สั่งทุกครั้งที่มา</span>
    </label>
    <label class="field">
      <span class="field-label">จำนวนหรือขนาด</span>
      <input id="f-qty" value="${esc(d.quantity || "")}" placeholder="10 ไม้, จานกลาง, 1 ถ้วยพอ" autocomplete="off">
    </label>
    <div class="field">
      <span class="field-label">บอกร้านว่า</span>
      ${tagFieldHtml("order_shared")}
      <div id="split-area">${splitHtml()}</div>
    </div>
    <label class="field">
      <span class="field-label">โน้ต</span>
      <textarea id="f-note" rows="2" placeholder="เคยสั่ง 20 ไม้แล้วกินไม่หมด">${esc(d.note || "")}</textarea>
    </label>
    <p class="sheet-msg" role="alert"></p>
    <div class="sheet-actions">
      ${dish ? `<button class="btn btn-danger" data-action="delete-dish">ลบเมนู</button>` : ""}
      <span class="spacer"></span>
      <button class="btn btn-quiet" data-action="close">ยกเลิก</button>
      <button class="btn btn-primary" data-action="save-dish">บันทึก</button>
    </div>`;
  openSheet(html);
  form = draft; // openSheet เรียก closeSheet ซึ่งล้าง form จึงตั้งกลับ
}

async function saveDishForm(btn) {
  const name = val("#f-name");
  if (!name) return fieldError("#f-name", "ใส่ชื่อเมนูก่อน");
  const f = form;
  const payload = {
    restaurant_id: f.rid,
    name,
    verdict: f.verdict,
    is_regular: sheet.querySelector("#f-regular").checked,
    quantity: val("#f-qty") || null,
    order_shared: [...f.tags.order_shared.values],
    order_me: f.split ? [...f.tags.order_me.values] : [],
    order_her: f.split ? [...f.tags.order_her.values] : [],
    reasons: f.verdict === "skip" ? [...f.tags.reasons.values] : [],
    note: val("#f-note") || null,
  };
  const saved = await guard(() => api.saveDish(payload, f.id), btn);
  if (!saved) return;
  closeSheet();
  toast(f.id ? "บันทึกแล้ว" : "เพิ่มเมนูแล้ว");
  await guard(() => refresh());
}

async function deleteDishForm(btn) {
  const d = state.dishes.find((x) => x.id === form.id);
  if (!d || !confirm(`ลบเมนู “${d.name}”? ลบแล้วกู้คืนไม่ได้`)) return;
  const ok = await guard(() => api.deleteDish(d.id), btn);
  if (!ok) return;
  closeSheet();
  toast("ลบเมนูแล้ว");
  await guard(() => refresh());
}

/* ---------- ฟอร์มร้าน ---------- */

function openRestaurantSheet() {
  const r = state.restaurants.find((x) => x.id === currentRid());
  if (!r) return;
  const draft = {
    type: "restaurant",
    id: r.id,
    verdict: r.verdict,
    split: r.order_me.length > 0 || r.order_her.length > 0,
    tags: {
      category: tagSet("category", r.category ? [r.category] : [], true),
      area: tagSet("area", r.area ? [r.area] : [], true),
      order_shared: tagSet("order", r.order_shared),
      order_me: tagSet("order", r.order_me),
      order_her: tagSet("order", r.order_her),
    },
  };
  form = draft;
  const html = `
    <h2 class="sheet-title" tabindex="-1" autofocus>แก้ไขร้าน</h2>
    <label class="field">
      <span class="field-label">ชื่อร้าน</span>
      <input id="f-name" value="${esc(r.name)}" autocomplete="off">
    </label>
    <div class="field"><span class="field-label">ประเภท</span>${tagFieldHtml("category")}</div>
    <div class="field"><span class="field-label">ย่าน</span>${tagFieldHtml("area")}</div>
    <div class="field">
      <span class="field-label">สถานะ</span>
      <div class="verdict-grid verdict-grid-4" id="verdict-grid">${verdictButtons()}</div>
    </div>
    <div class="field">
      <span class="field-label">บอกร้านว่า (ใช้กับทุกเมนู)</span>
      ${tagFieldHtml("order_shared")}
      <div id="split-area">${splitHtml()}</div>
    </div>
    <label class="field">
      <span class="field-label">ลิงก์ Google Maps</span>
      <input id="f-map" type="url" inputmode="url" value="${esc(r.map_url || "")}" placeholder="https://maps.app.goo.gl/…" autocomplete="off">
    </label>
    <label class="field">
      <span class="field-label">โน้ตร้าน</span>
      <textarea id="f-note" rows="3" placeholder="ที่จอดรถน้อย, เบียร์ไม่ค่อยเย็น, ค่าน้ำแข็งแพง">${esc(r.note || "")}</textarea>
    </label>
    <p class="sheet-msg" role="alert"></p>
    <div class="sheet-actions">
      <button class="btn btn-danger" data-action="delete-restaurant">ลบร้าน</button>
      <span class="spacer"></span>
      <button class="btn btn-quiet" data-action="close">ยกเลิก</button>
      <button class="btn btn-primary" data-action="save-restaurant">บันทึก</button>
    </div>`;
  openSheet(html);
  form = draft;
}

async function saveRestaurantForm(btn) {
  const name = val("#f-name");
  if (!name) return fieldError("#f-name", "ใส่ชื่อร้านก่อน");
  const mapUrl = val("#f-map");
  if (mapUrl && !safeUrl(mapUrl)) return fieldError("#f-map", "ลิงก์ต้องขึ้นต้นด้วย https://");
  const f = form;
  const payload = {
    name,
    category: [...f.tags.category.values][0] || null,
    area: [...f.tags.area.values][0] || null,
    verdict: f.verdict,
    order_shared: [...f.tags.order_shared.values],
    order_me: f.split ? [...f.tags.order_me.values] : [],
    order_her: f.split ? [...f.tags.order_her.values] : [],
    map_url: mapUrl || null,
    note: val("#f-note") || null,
  };
  const saved = await guard(() => api.saveRestaurant(payload, f.id), btn);
  if (!saved) return;
  closeSheet();
  toast("บันทึกแล้ว");
  await guard(() => refresh());
}

async function deleteRestaurantForm(btn) {
  const r = state.restaurants.find((x) => x.id === form.id);
  if (!r) return;
  const n = state.dishes.filter((d) => d.restaurant_id === r.id).length;
  if (!confirm(`ลบร้าน “${r.name}”${n ? ` และเมนูทั้งหมด ${n} เมนู` : ""}? ลบแล้วกู้คืนไม่ได้`)) return;
  const ok = await guard(() => api.deleteRestaurant(r.id), btn);
  if (!ok) return;
  closeSheet();
  toast("ลบร้านแล้ว");
  await guard(() => refresh({ rerender: false }));
  location.hash = "#/";
}

/* ---------- events ---------- */

function onHomeEnter() {
  const q = state.query.trim();
  if (!q) return;
  const exact = state.restaurants.find((r) => r.name.trim().toLowerCase() === q.toLowerCase());
  if (exact) location.hash = `#/r/${exact.id}`;
  else addRestaurant();
}

function onDishEnter() {
  const input = document.getElementById("dq");
  const q = input.value.trim();
  if (!q) return;
  input.blur();
  const exact = state.dishes.find((d) => d.restaurant_id === currentRid() && d.name.trim().toLowerCase() === q.toLowerCase());
  openDishSheet(exact || null, exact ? "" : q);
}

document.addEventListener("click", (e) => {
  const filter = e.target.closest("[data-filter]");
  if (filter) {
    state[filter.dataset.filter] = filter.dataset.value || null;
    renderHome();
    return;
  }
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const { action, value, field, id } = el.dataset;

  switch (action) {
    case "menu": return openMenu();
    case "reload":
      closeSheet();
      return guard(() => refresh()).then((r) => r !== null && toast("โหลดข้อมูลล่าสุดแล้ว"));
    case "export": return exportData();
    case "retry": return boot();
    case "close": return closeSheet();
    case "random": return openRandom();
    case "add-restaurant": return addRestaurant(el);
    case "quick-verdict": return quickVerdict(value, el);
    case "edit-restaurant": return openRestaurantSheet();
    case "add-dish": {
      const q = (document.getElementById("dq")?.value || "").trim();
      document.activeElement?.blur();
      return openDishSheet(null, q);
    }
    case "edit-dish": return openDishSheet(state.dishes.find((d) => d.id === id));
    case "toggle-tag": return toggleTag(field, value);
    case "new-tag": return startNewTag(field, el);
    case "split-on": return setSplit(true);
    case "split-off": return setSplit(false);
    case "form-verdict": return setFormVerdict(value);
    case "save-dish": return saveDishForm(el);
    case "delete-dish": return deleteDishForm(el);
    case "save-restaurant": return saveRestaurantForm(el);
    case "delete-restaurant": return deleteRestaurantForm(el);
  }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "q") {
    state.query = e.target.value;
    renderHomeList();
  } else if (e.target.id === "dq") {
    renderDishList(currentRid());
  }
});

document.addEventListener("change", (e) => {
  if (e.target.id === "sort") {
    state.sort = e.target.value;
    renderHomeList();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  if (e.target.id === "q") {
    e.preventDefault();
    onHomeEnter();
  } else if (e.target.id === "dq") {
    e.preventDefault();
    onDishEnter();
  }
});

// กลับเข้าแอปเมื่อไหร่ ดึงข้อมูลล่าสุด (เผื่ออีกคนเพิ่งจด)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.loaded && !sheet) {
    refresh({ onlyIfChanged: true }).catch(() => {});
  }
});

/* ---------- start ---------- */

async function boot() {
  if (!api.isConfigured()) {
    app.innerHTML = `<div class="empty">
      <p class="empty-title">ยังไม่ได้ตั้งค่า Supabase</p>
      <p>เปิดไฟล์ js/config.js แล้วใส่ Project URL กับ anon key ของคุณ</p>
    </div>`;
    return;
  }
  app.innerHTML = `<p class="loading">กำลังโหลด…</p>`;
  try {
    await refresh({ rerender: false });
    route();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="empty">
      <p class="empty-title">เชื่อมต่อฐานข้อมูลไม่ได้</p>
      <p>ถ้าไม่ได้เปิดแอปเกิน 1 สัปดาห์ Supabase อาจพัก project ไว้ เข้า supabase.com แล้วกด Restore project จากนั้นกลับมากดลองใหม่</p>
      <p class="err-detail">${esc(e?.message || e)}</p>
      <button class="btn btn-primary" data-action="retry">ลองใหม่</button>
    </div>`;
  }
}

boot();
