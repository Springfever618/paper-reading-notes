const API = "http://127.0.0.1:8765";
const $ = s => document.querySelector(s);
const esc = s => String(s || "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let CARD = null, timers = {};
let NOCARD = null, MANUAL = false;   // 10-04：当前网页没有对应的卡时不再沿用上一张（NOCARD = 当前网页标题）

async function loadList() {
  try {
    const j = await (await fetch(API + "/api/cards")).json();
    let { card } = await chrome.storage.local.get("card");
    // 当前网页正好是某张答题卡对应的论文 → 自动选那张卡
    try {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      let hit = null;
      for (const c of j.cards) {
        const m = await (await fetch(API + "/api/card_meta?name=" + encodeURIComponent(c))).json();
        if (t && m.url && sameDoc(t.url, m)) { card = c; hit = c; break; }
      }
      NOCARD = (t && /^https?:/.test(t.url) && !hit && !MANUAL) ? (t.title || t.url) : null;
    } catch (e) {}
    CARD = j.cards.includes(card) ? card : j.cards[0];
    $("#cards").innerHTML = (NOCARD ? `<option value="" selected>— 本页还没有卡 —</option>` : "") + j.cards.map(c => `<option ${!NOCARD && c === CARD ? "selected" : ""}>${esc(c)}</option>`).join("");
    await chrome.storage.local.set({ card: CARD });
    try { const st = await chrome.storage.local.get(["rnTab", "rnScroll", "rnMode"]); SCROLL = st.rnScroll || {}; MODES = st.rnMode || {}; if (st.rnTab) setTabUI(st.rnTab === "method" ? "card" : st.rnTab); } catch (e) {}
    pendingRestore = TAB; setTimeout(() => { pendingRestore = null; }, 3000);
    loadCard(); if (TAB === "notes") renderNotes(); if (TAB === "today") renderToday();
  } catch (e) {
    $("#body").innerHTML = '<p class="err">连不上本机服务。请先运行 server/start.command（或 python3 server/server.py），再点这里刷新。</p><button id="retry">刷新</button>';
    $("#retry").onclick = loadList;
  }
}
const VSYM = { ok: "✅", part: "⚠️", no: "❌" }, VTXT = { ok: "答对了", part: "部分对", no: "不对" };
const MODEL_OPTS = [["sonnet", "Sonnet 5.5"], ["opus", "Opus 5.5"], ["haiku", "Haiku 4.5"]];
const EFF_OPTS = [["low", "低"], ["medium", "中"], ["high", "高"], ["xhigh", "很高"], ["max", "最高"]];
function pickers() {
  return `<select class="m">${MODEL_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>` +
    `<select class="e" title="思考强度：越高越慢、越耗额度">${EFF_OPTS.map(([v, l]) => `<option value="${v}">强度 ${l}</option>`).join("")}</select>` +
    `<select class="c" title="自动 = 平时只发相关片段，点“一键解释 / 讲解批改”时发全文；要严谨就选全文"><option value="auto">上下文：自动</option><option value="full">上下文：全文</option><option value="rel">上下文：片段</option></select>`;
}
async function initPickers(root) {
  let v = {}; try { v = await chrome.storage.local.get(["rnModel", "rnEffort", "rnCtx"]); } catch (e) {}
  root.querySelectorAll("select.c").forEach(s => { s.value = v.rnCtx || "auto"; s.onchange = () => chrome.storage.local.set({ rnCtx: s.value }); });
  root.querySelectorAll("select.m").forEach(s => { if (v.rnModel) s.value = v.rnModel; s.onchange = () => chrome.storage.local.set({ rnModel: s.value }); });
  root.querySelectorAll("select.e").forEach(s => { s.value = v.rnEffort || "medium"; s.onchange = () => chrome.storage.local.set({ rnEffort: s.value }); });
}
  // 回答里的简单 Markdown：表格、小标题、分隔线、**粗体**、`代码`（先转义，再排版，不执行任何网页代码）
function md(t, br) {
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const inline = s => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    const isRow = s => /^\s*\|.*\|\s*$/.test(s), isSep = s => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(s);
    const cells = s => s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
    const L = String(t || "").split("\n"), out = [], nl = br ? "<br>" : "\n";
    for (let i = 0; i < L.length;) {
      if (isRow(L[i]) && i + 1 < L.length && isSep(L[i + 1])) {
        const head = cells(L[i]); i += 2; const rows = [];
        while (i < L.length && isRow(L[i])) rows.push(cells(L[i++]));
        out.push(`<table class="md"><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
        continue;
      }
      const h = L[i].match(/^\s*#{1,4}\s+(.*)$/);
      if (h) { out.push(`<div class="mdh">${inline(h[1])}</div>`); i++; continue; }
      if (/^\s*(---+|\*\*\*+)\s*$/.test(L[i])) { out.push('<hr class="md">'); i++; continue; }
      out.push(inline(L[i]) + (i < L.length - 1 ? nl : "")); i++;
    }
    return out.join("");
  }
// 回答 / 批改意见里引用的英文原句 → 可以点，点了在网页上找到这句
function cites(t) {
  return md(t, true).replace(/(&quot;|“|‘)([A-Za-z][^"“”‘’<>]{6,140}?)(&quot;|”|’)/g, (m, a, x, b) => /[A-Za-z]{3,}/.test(x) ? `${a}<a class="cite" data-text="${x.replace(/"/g, "")}">${x}</a>${b}` : m);
}
let META = { items: {}, grades: {} };
function noCardHtml(kind) {
  return `<p class="tip">当前这篇（${esc(NOCARD)}）还没有目标卡。目标卡是可选功能，做法见 GitHub 上的 README。想看别的论文的卡，在上面“— 本页还没有卡 —”那个下拉框里选。</p>`;
}
async function loadCard() {
  if (NOCARD) { $("#modebar").innerHTML = ""; $("#v-method").innerHTML = ""; $("#body").innerHTML = noCardHtml("目标卡"); return; }
  const j = await (await fetch(API + "/api/card?name=" + encodeURIComponent(CARD))).json();
  META = await (await fetch(API + "/api/card_meta?name=" + encodeURIComponent(CARD))).json();
  // 10-05：目标卡 = 读这篇为了 + 速扫 / 精读开关；速扫只做带 ⭐ 的关键任务和最后的一句话定位（没有 ⭐ 就每个任务做第一题）
  MODE = MODES[CARD] || (j.kind === "速扫" ? "速扫" : "精读");
  const allN = j.groups.reduce((k, g) => k + g.qs.length, 0);
  if (MODE === "速扫") {
    const last = g => /^最后/.test(g.head), anyStar = j.groups.some(g => g.star);
    j.groups = j.groups.map(g => anyStar ? ((g.star || last(g)) ? g : null) : (last(g) ? g : Object.assign({}, g, { qs: g.qs.slice(0, 1) }))).filter(g => g && g.qs.length);
  }
  const shownN = j.groups.reduce((k, g) => k + g.qs.length, 0);
  $("#modebar").innerHTML = `${j.why ? `<div class="why"><b>读这篇是为了：</b>${md(j.why)}</div>` : ""}
    <div class="mode"><span class="seg"><button data-mode="速扫" class="${MODE === "速扫" ? "on" : ""}">速扫</button><button data-mode="精读" class="${MODE === "精读" ? "on" : ""}">精读</button></span>
    <span>${MODE === "速扫" ? `只做关键题 ${shownN} / ${allN}，方法卡收起` : `全部 ${allN} 题 + 方法卡核对`}${j.kind ? ` · 卡片标的是「${esc(j.kind)}」` : ""}</span></div>`;
  $("#modebar").querySelectorAll("[data-mode]").forEach(b => b.onclick = async () => {
    MODES[CARD] = b.dataset.mode; try { await chrome.storage.local.set({ rnMode: MODES }); } catch (e) {} loadCard();
  });
  renderMethod();
  const nQ = shownN, graded = Object.values(META.grades || {}).filter(g => g.v);
  const score = graded.reduce((k, g) => k + (g.v === "ok" ? 1 : g.v === "part" ? .5 : 0), 0);
  $("#body").innerHTML = `<h1>${esc(j.title)}</h1><div class="grp">✍️ 边读边答</div>
    <div class="tip">边读边填，停手 1 秒自动保存。写完点“提交批改”。答题前 📍 只带你到相关段落，批改后 🎯 标出原文里所有相关的句子。批改意见里的蓝色英文可以点，点了跳到原文那句。${META.url ? ` <a href="${esc(META.url)}" target="_blank">打开这篇网页</a>` : ""}</div>
    <div class="progress">已批改 ${graded.length} / ${nQ} 题${graded.length ? ` · 得分 ${score} / ${graded.length}` : ""}</div>
    ${j.groups.map(g => `<div class="grp">${esc(g.head)}</div>${g.qs.map(q => qHtml(q)).join("")}`).join("")}
    <div class="allrow"><button id="gradeAll">全部提交批改（只批改写了答案、还没批改或改过答案的题）</button></div>`;
  document.querySelectorAll("textarea[data-i]").forEach(t => t.addEventListener("input", () => {
    t.classList.remove("saved"); clearTimeout(timers[t.dataset.i]);
    timers[t.dataset.i] = setTimeout(async () => {
      const r = await fetch(API + "/api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: CARD, idx: +t.dataset.i, text: t.value }) });
      if ((await r.json()).ok) t.classList.add("saved");
    }, 1000);
  }));
  $("#gradeAll").onclick = async () => {
    const b = $("#gradeAll"); b.disabled = true;
    const todo = [...document.querySelectorAll(".qbox")].filter(x => {
      const i = x.dataset.i, a = x.querySelector("textarea[data-i]").value.trim(), g = (META.grades || {})[i];
      return a && (!g || !g.v || g.ans !== a.split("\n").map(s => s.trim()).filter(Boolean).join(" / "));
    });
    if (!todo.length) { b.textContent = "没有需要批改的题（都没写，或者都批改过了）"; return; }
    for (let k = 0; k < todo.length; k++) { b.textContent = `批改中 ${k + 1} / ${todo.length}……`; await gradeQ(todo[k].dataset.i, true); }
    loadCard();
  };
  initPickers($("#body"));
  restoreScroll("card");
}
function qHtml(q) {
  const it = (META.items || {})[q.idx] || {}, g = (META.grades || {})[q.idx] || {}, graded = !!g.v;
  const spots = (it.spots || []).filter(sp => graded ? sp.key : sp.el);   // 10-04：网页没有段落编号的（如知网）答题前不显示 📍
  const nav = it.v2only ? `<span class="v2">这题在网页版里没有，去 PDF 里看</span>`
    : spots.length ? `<span class="spots">${spots.map((sp, j) => graded && sp.key
        ? `<a data-act="target" data-i="${q.idx}" data-j="${j}" title="${esc(sp.why)}">🎯${j + 1}</a>`
        : `<a data-act="goto" data-i="${q.idx}" data-j="${j}" title="${esc(sp.why || "去这段读")}">📍${j + 1}</a>`).join("")}</span>` : "";
  return `<div class="qbox" data-i="${q.idx}">
    <div class="q">${esc(q.q)}</div>
    <textarea data-i="${q.idx}">${esc(q.a)}</textarea>
    <div class="qacts">${nav}<span class="sp"></span><button class="sub" data-act="grade" data-i="${q.idx}">${graded ? "重新批改" : "提交批改"}</button></div>
    ${graded ? `<div class="grade ${g.v}"><b>${VSYM[g.v]} ${VTXT[g.v]}</b> <span class="gt">${esc(g.time)} · ${esc(g.model || "")}</span><div>${cites(g.fb)}</div>
      <div class="gacts"><a data-act="savenote" data-i="${q.idx}" data-w="grade">📌 把批改存为原文上的笔记</a></div>
      ${(g.history || []).length ? `<details class="hist"><summary>之前的批改（${g.history.length} 次）</summary>${g.history.slice().reverse().map(h => `<div class="h"><b>${VSYM[h.v] || ""} ${VTXT[h.v] || ""}</b> <span class="gt">${esc(h.time)}</span><div class="ha">当时的答案：${esc(h.ans)}</div><div>${cites(h.fb)}</div></div>`).join("")}</details>` : ""}</div>` : ""}
    ${(g.qa || []).map((x, k) => `<div class="fq"><div class="fqq">🙋 ${esc(x.q)}</div><div class="fqa"><span class="gt">🤖 ${esc(x.model || "")} · ${esc(x.time || "")}</span><br>${cites(x.a)}</div>
      <div class="gacts"><a data-act="savenote" data-i="${q.idx}" data-w="${k}">📌 存为原文上的笔记</a></div></div>`).join("")}
    <div class="ask" data-i="${q.idx}"><textarea class="askq" placeholder="${graded ? "追问，比如：dense 和 base 有什么区别？" : "对这道题有疑问可以先问"}（⌘+回车 发送）"></textarea>
      <div class="askside">${pickers()}${graded ? `<button data-act="explain" data-i="${q.idx}" class="ghost" title="不用打字：让 Claude 把批改展开讲清楚">✨ 讲解批改</button>` : ""}<button data-act="ask" data-i="${q.idx}">💬 追问</button></div></div>
  </div>`;
}
async function gradeQ(i, quiet) {
  const box = document.querySelector(`.qbox[data-i="${i}"]`); if (!box) return;
  const ta = box.querySelector("textarea[data-i]"), btn = box.querySelector(".sub");
  await fetch(API + "/api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: CARD, idx: +i, text: ta.value }) });
  btn.disabled = true; btn.innerHTML = '批改中 <span class="dots"><i></i><i></i><i></i></span>';
  const m = box.querySelector("select.m"), e = box.querySelector("select.e");
  const r = await (await fetch(API + "/api/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: CARD, idx: +i, model: m && m.value, effort: e && e.value }) })).json();
  if (!r.ok) { btn.disabled = false; btn.textContent = "提交批改"; box.insertAdjacentHTML("beforeend", `<div class="miss">⚠️ ${esc(r.err)}</div>`); return; }
  META.grades = META.grades || {}; META.grades[i] = r.grade; META.items[i] = Object.assign(META.items[i] || {}, r.target || {});
  if (!quiet) { await refreshMeta(); redrawQ(i); }
  tellPage();
}
async function refreshMeta() { META = await (await fetch(API + "/api/card_meta?name=" + encodeURIComponent(CARD))).json(); }
function redrawQ(i) {
  const box = document.querySelector(`.qbox[data-i="${i}"]`); if (!box) return;
  box.outerHTML = qHtml({ idx: +i, q: box.querySelector(".q").textContent, a: box.querySelector("textarea[data-i]").value });
  initPickers(document.querySelector(`.qbox[data-i="${i}"]`));
}
async function askQ(i, explain) {
  const box = document.querySelector(`.qbox[data-i="${i}"]`), ta = box.querySelector(".askq"), bt = box.querySelector('[data-act="ask"]');
  const q = ta.value.trim(); if (!q) { ta.focus(); return; }
  ta.disabled = bt.disabled = true;
  const live = document.createElement("div"); live.className = "fq live"; box.querySelector(".ask").before(live);
  live.innerHTML = `<div class="fqq">🙋 ${esc(q)}</div><div class="fqa">…</div>`;
  const r = await (await fetch(API + "/api/grade_ask_start", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: CARD, idx: +i, question: q, model: box.querySelector("select.m").value, effort: box.querySelector("select.e").value, ctx: box.querySelector("select.c").value, explain: !!explain }) })).json();
  if (!r.ok) { live.querySelector(".fqa").textContent = "⚠️ " + (r.err || "出错了"); ta.disabled = bt.disabled = false; return; }
  while (true) {
    await new Promise(res => setTimeout(res, 700));
    const p = await (await fetch(API + "/api/ask_poll?jid=" + r.jid)).json();
    live.querySelector(".fqa").innerHTML = `<span class="gt">🤖 ${esc(p.model || "")} · ${p.secs || 0} 秒 <span class="dots"><i></i><i></i><i></i></span></span><br>` + (p.err ? "⚠️ " + esc(p.err) : cites(p.text || "正在想……"));
    if (p.done || !p.ok) { if (p.qa) { await refreshMeta(); redrawQ(i); } else { ta.disabled = bt.disabled = false; } break; }
  }
}
$("#body").addEventListener("keydown", e => { if (e.target.classList.contains("askq") && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); askQ(e.target.closest(".qbox").dataset.i); } });
// 10-05：网页和卡是不是同一篇：网址一样，或网址里含卡片抬头里记的 DOI / 另一个网址（如 PNAS 官网版 ↔ PMC 版）
function sameDoc(u, meta) {
  const a = (u || "").split("#")[0].replace(/\/$/, ""), b = (meta.url || "").replace(/\/$/, "");
  if (a && a === b) return true;
  return (meta.alts || []).some(x => x && (x.startsWith("http") ? a === x.replace(/\/$/, "") : a.toLowerCase().includes(x.toLowerCase())));
}
async function onPage() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { t, ok: t && META.url && sameDoc(t.url, META) };
}
async function pageMsg(msg, a) {
  const { t, ok } = await onPage();
  if (!ok) { chrome.tabs.create({ url: META.url }); return; }
  const r = await chrome.tabs.sendMessage(t.id, msg).catch(() => null);
  a.parentElement.querySelectorAll(".miss").forEach(x => x.remove());
  if (!r || !r.found) { a.insertAdjacentHTML("afterend", ' <span class="miss">网页上没找到这句。开着翻译的话：先切回英文原文、刷新一次网页（让插件记下每段英文），再切回中文就能跳了</span>'); }
  else if (r.para) { a.insertAdjacentHTML("afterend", ' <span class="miss">开着翻译：已带你到这句所在的段落（闪框处）</span>'); }
}
$("#body").addEventListener("click", async e => {
  const c = e.target.closest("a.cite"); if (c) { pageMsg({ type: "find_text", text: c.dataset.text }, c); return; }
  const a = e.target.closest("[data-act]"); if (!a) return;
  const i = a.dataset.i, it = (META.items || {})[i] || {}, sp = (it.spots || [])[+a.dataset.j || 0] || {};
  if (a.dataset.act === "grade") return gradeQ(i);
  if (a.dataset.act === "ask") return askQ(i);
  if (a.dataset.act === "explain") {
    const box = document.querySelector(`.qbox[data-i="${i}"]`);
    box.querySelector(".askq").value = "请结合整篇论文的上下文，把这道题的批改展开讲清楚：我答对了什么、错 / 漏了什么，原文在哪一节怎么说的，里面的关键术语是什么意思。";
    return askQ(i, true);
  }
  if (a.dataset.act === "goto") return pageMsg({ type: "goto_el", el: sp.el, why: sp.why }, a);
  if (a.dataset.act === "target") return pageMsg({ type: "goto_target", idx: +i, j: +a.dataset.j }, a);
  if (a.dataset.act === "savenote") {
    if (a.dataset.busy) return; a.dataset.busy = "1"; a.style.pointerEvents = "none"; a.textContent = "存的中……";   // 防止连点存好几条
    const g = (META.grades || {})[i] || {}, w = a.dataset.w;
    const qt = (document.querySelector(`.qbox[data-i="${i}"] .q`) || {}).textContent || "";
    const no = (qt.match(/^\s*(\d+(?:\.\d+)?)/) || [])[1] || `第 ${+i + 1}`;   // 用题目自己的编号（如 2.2）
    const body = w === "grade" ? { note: `答题卡 ${no} 题的批改：${VSYM[g.v]} ${g.fb}`, qa: [] }
      : { note: `答题卡 ${no} 题的追问`, qa: [g.qa[+w]] };
    const r = await (await fetch(API + "/api/note_from_card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ name: CARD, idx: +i, j: 0 }, body)) })).json();
    a.textContent = r.ok ? (r.dup ? "✓ 之前已经存过了" : "✓ 已存为笔记（在原文第一处相关句子上）") : "⚠️ " + (r.err || "没存上");
    if (!r.ok) { delete a.dataset.busy; a.style.pointerEvents = ""; }
    if (r.ok) tellPage();
  }
});

// ---------- 方法卡 ----------
async function renderMethod() {
  const el = $("#v-method");
  if (NOCARD) { el.innerHTML = ""; return; }
  let m = null; try { m = (await (await fetch(API + "/api/method?name=" + encodeURIComponent(CARD))).json()).method; } catch (e) {}
  if (!m) { el.innerHTML = `<details class="mwrap"><summary>📋 方法卡 · 读完核对</summary><p class="tip">这篇还没有方法卡。跟 Claude 说“给这篇出方法卡”就行。</p></details>`; return; }
  const done = m.fields.filter(f => f.ok).length;
  el.innerHTML = `<details class="mwrap" ${MODE === "精读" ? "open" : ""}><summary>📋 方法卡 · 读完核对（已核对 ${done} / ${m.fields.length}）${MODE === "速扫" ? " · 速扫时收起，点开看" : ""}</summary>
    <div class="tip">${esc(m.status || "")}。读这篇论文最该带走的东西。每项都是 Claude 从原文抽出来的初稿：点 📍 去原文核对，对的打 ✓，不对或想补充就写在“我的核对”里。所有论文的方法卡会自动汇总成 <b>文献方法对比表</b>（数据文件夹里的 文献方法对比表.md）。</div>
    <div class="progress">已核对 ${done} / ${m.fields.length} 项</div>
    ${m.fields.map(f => `<div class="mf ${f.ok ? "ok" : ""}" data-k="${f.k}">
      <div class="mh"><b>${esc(f.label)}</b><label class="okc"><input type="checkbox" ${f.ok ? "checked" : ""}> ✓ 核对过</label></div>
      <div class="mt">${cites(f.text)}</div>
      ${f.spots && f.spots.length ? `<div class="spots">${f.spots.map((sp, j) => `<a data-mj="${j}" title="${esc(sp.why || "")}">📍 ${esc(sp.why || "原文")}</a>`).join("")}</div>` : ""}
      <textarea placeholder="我的核对 / 补充（可不写）">${esc(f.mine || "")}</textarea></div>`).join("")}
    <div class="mf nc"><div class="mh"><b>✍️ 我的话：这篇对我的研究有什么用</b></div><textarea class="ncmine" placeholder="用自己的话写一两句，会进对比表最后一列">${esc(m.nc_mine || "")}</textarea></div></details>`;
  const save = (body) => fetch(API + "/api/method_update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ name: CARD }, body)) });
  el.querySelectorAll(".mf[data-k]").forEach(box => {
    const k = box.dataset.k, f = m.fields.find(x => x.k === k);
    box.querySelector("input").onchange = e => { save({ k, ok: e.target.checked }); box.classList.toggle("ok", e.target.checked); };
    let tm; box.querySelector("textarea").oninput = e => { clearTimeout(tm); tm = setTimeout(() => save({ k, mine: e.target.value }), 900); };
    box.querySelectorAll("[data-mj]").forEach(a => a.onclick = async () => {
      const sp = f.spots[+a.dataset.mj]; META.url = META.url || m.url;
      pageMsg({ type: "find_text", text: sp.key, el: sp.el }, a);
    });
  });
  let tn; el.querySelector(".ncmine").oninput = e => { clearTimeout(tn); tn = setTimeout(() => save({ nc_mine: e.target.value }), 900); };
  if (!el.dataset.citeBound) { el.dataset.citeBound = "1"; el.addEventListener("click", e => { const c = e.target.closest("a.cite"); if (c) { META.url = META.url || m.url; pageMsg({ type: "find_text", text: c.dataset.text }, c); } }); }
}
$("#cards").addEventListener("change", async e => { if (!e.target.value) return; MANUAL = true; NOCARD = null; SCROLL[skey()] = scrollY; CARD = e.target.value; await chrome.storage.local.set({ card: CARD }); pendingRestore = TAB; setTimeout(() => { pendingRestore = null; }, 3000); loadCard(); });
chrome.runtime.onMessage.addListener(m => { if (m.type === "clipped") loadCard(); });
loadList();

// ---------- 两个标签页：答题卡 / 笔记 ----------
// 逻辑：网页上勾勾画画的都是“笔记”；“❓ 没看懂”是状态、🏷 标签是自己起的分类（没有标签 = 未归档）；每条笔记都能问 Claude。
let TAB = "card", FILTER = "page", CACHE = {}, MODES = {}, MODE = "精读";
const SWC = { yellow: "#f2c200", green: "#5fb236", blue: "#3b6fd8", red: "#e5484d", pink: "#ff6fae", purple: "#8e5cd9", orange: "#f2994a" };
// 记住：上次停在哪个标签页、每个标签页（每张卡）各自滚到了哪里
let SCROLL = {}, pendingRestore = null;
const skey = () => TAB + ":" + (CARD || "");
function saveScroll() {
  SCROLL[skey()] = scrollY; clearTimeout(saveScroll.t);
  saveScroll.t = setTimeout(() => { try { chrome.storage.local.set({ rnScroll: SCROLL, rnTab: TAB }); } catch (e) {} }, 300);
}
addEventListener("scroll", () => { if (!pendingRestore && !HIDDEN) saveScroll(); }, { passive: true });   // 抽屉收起期间不记录
// 抽屉重新展开时：回到这个标签页上次停的位置（防止浏览器把位置重置到最上面）
function backToSaved() { const y = SCROLL[skey()] || 0; if (y && Math.abs(scrollY - y) > 4) scrollTo(0, y); }
let HIDDEN = false;
addEventListener("message", e => {
  if (e.data && e.data.rnDrawer === "hidden") HIDDEN = true;
  if (e.data && e.data.rnDrawer === "shown") { try { parent.postMessage({ rnDrawerWide: TAB === "canvas" }, "*"); } catch (er) {} backToSaved(); setTimeout(() => { backToSaved(); HIDDEN = false; }, 150); }
});
addEventListener("resize", () => { if (scrollY === 0) backToSaved(); });
function restoreScroll(tab) {
  if (pendingRestore !== tab) return;
  const y = SCROLL[skey()] || 0;
  scrollTo(0, y); setTimeout(() => { scrollTo(0, y); pendingRestore = null; }, 200);   // 内容排好版后再滚一次
}
function setTabUI(t) {
  TAB = t;
  document.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("on", x.dataset.t === t));
  ["card", "notes", "today", "canvas"].forEach(k => $("#v-" + k).hidden = k !== t);
  // 10-06：④ 画布——第一次切过来才载入；切到画布时请网页把抽屉加宽，切走恢复
  if (t === "canvas") {
    document.documentElement.style.setProperty("--tabsH", $(".tabs").offsetHeight + "px");
    const f = $("#cvf"); if (!f.src) f.src = "canvas.html"; else f.contentWindow.postMessage({ rnCanvas: "shown" }, "*");
  }
  try { parent.postMessage({ rnDrawerWide: t === "canvas" }, "*"); } catch (e) {}
  $("#cards").hidden = t !== "card";   // 10-05：下拉框只在目标卡页显示
}
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
  SCROLL[skey()] = scrollY;
  setTabUI(b.dataset.t); pendingRestore = TAB; setTimeout(() => { pendingRestore = null; }, 3000); saveScroll.t && clearTimeout(saveScroll.t);
  try { chrome.storage.local.set({ rnScroll: SCROLL, rnTab: TAB }); } catch (e) {}
  if (TAB === "card") restoreScroll("card"); else refresh();
});
// 10-06：④ 画布（canvas.html）要的东西都经这里转给网页：这页的章节、跳到某句、笔记改了要刷新
addEventListener("message", async e => {
  const f = $("#cvf"); if (!f || e.source !== f.contentWindow || !e.data || !e.data.rnCanvas) return;
  const d = e.data, t = await curTab(), reply = o => f.contentWindow.postMessage(Object.assign({ rnCanvasReply: d.rid }, o), "*");
  if (d.rnCanvas === "info") {
    const r = t && await chrome.tabs.sendMessage(t.id, { type: "sections" }).catch(() => null);
    reply(t && /^https?:/.test(t.url) ? { url: t.url.split("#")[0], title: t.title, secs: (r && r.secs) || {} } : { err: "这个页面不能做笔记" });
  }
  if (d.rnCanvas === "goto" && t) chrome.tabs.sendMessage(t.id, { type: "goto", id: d.id }).catch(() => {});
  if (d.rnCanvas === "changed" && t) { tellPage(); }
});
async function curTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t; }
async function post(path, body) {
  return (await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
}
const isAsk = n => n.color === "q" && !n.solved;
const status = n => n.color === "q" ? (n.solved ? "✅ 已解决" : "❓ 没看懂") : "";
function noteHtml(n, url) {
  const bar = n.sty ? `border-left:3px ${n.sty.t === "wave" ? "dotted" : "solid"} ${SWC[n.sty.c] || "#f2c200"};padding-left:6px` : "";
  return `<div class="note" data-id="${n.id}" data-url="${esc(url)}">
    <div class="qt ${n.color}" style="${bar}" title="点一下跳到网页上的位置">“${esc(n.quote.slice(0, 300))}”</div>
    ${n.note ? `<div class="mine">💬 ${esc(n.note)}</div>` : ""}
    ${(n.qa || []).map(x => `<div class="qa"><b>🙋 ${esc(x.q)}</b><br>🤖 ${md(x.a, true)}</div>`).join("")}
    <div class="meta">${status(n) ? `<span class="st">${status(n)}</span> · ` : ""}${(n.tags || []).length ? n.tags.map(t => `<span class="tg">🏷 ${esc(t)}</span>`).join(" ") : `<span class="untag">未归档</span>`} · ${esc((n.time || "").slice(0, 11))}</div>
    <div class="acts">
      <a data-a="ask">🙋 问 Claude</a><a data-a="edit">✏️ 备注</a>
      <a data-a="q">${n.color === "q" ? "取消“没看懂”" : "❓ 没看懂"}</a>
      ${n.color === "q" ? `<a data-a="solve">${n.solved ? "改回待解决" : "✅ 已解决"}</a>` : ""}
      <a data-a="tags">🏷 标签</a><a data-a="link">🔗 链接</a><a data-a="del">🗑</a>
    </div></div>`;
}
// 10-05：两排筛选可以组合——范围（本页 / 全部论文）× 类型（全部 / 待解决 / 有问答 / 未归档 / 标签）
const SCOPES = [["page", "本页"], ["allp", "全部论文"]];
const FILTERS = [["all", "全部"], ["ask", "❓ 待解决"], ["qa", "💬 有问答"], ["untag", "未归档"]];
let SCOPE = "page";
const pass = (f, n) => f === "all" || (f === "ask" && isAsk(n)) || (f === "qa" && (n.qa || []).length) || (f === "untag" && !(n.tags || []).length) || (f.startsWith("tag:") && (n.tags || []).includes(f.slice(4)));
async function renderNotes() {
  const el = $("#v-notes"), t = await curTab();
  const onWeb = t && /^https?:/.test(t.url);
  let all, here;
  try {
    all = ((await (await fetch(API + "/api/webnotes_all")).json()).pages || []);
    here = onWeb ? await (await fetch(API + "/api/webnotes?url=" + encodeURIComponent(t.url))).json() : null;
  } catch (e) { el.innerHTML = '<p class="err">连不上本机服务。请先运行 server/start.command（或 python3 server/server.py）。</p>'; return; }
  if (FILTER === "page") FILTER = "all";   // 旧版存下的“本页”现在属于范围那一排
  const src = SCOPE === "page" ? (here ? [Object.assign({}, here, { url: t.url, title: here.title || t.title })] : []) : all;
  const count = f => src.reduce((k, p) => k + p.notes.filter(n => pass(f, n)).length, 0);
  const tagSet = [...new Set(all.flatMap(p => p.notes.flatMap(n => n.tags || [])))];
  let html = `<div class="chips">${SCOPES.map(([f, lab]) => `<button data-s="${f}" class="${f === SCOPE ? "on" : ""}">${lab}</button>`).join("")}</div>` +
    `<div class="chips">${FILTERS.map(([f, lab]) => `<button data-f="${f}" class="${f === FILTER ? "on" : ""}">${lab} ${count(f)}</button>`).join("")}</div>` +
    (tagSet.length ? `<div class="chips tags">${tagSet.map(x => `<button data-f="tag:${esc(x)}" class="${FILTER === "tag:" + x ? "on" : ""}">🏷 ${esc(x)} ${count("tag:" + x)}</button>`).join("")}</div>` : "");
  if (SCOPE === "page" && !here) html += '<p class="tip">这个页面不能做笔记（只支持普通网页）。</p>';
  else {
    if (SCOPE === "page") html += `<div class="zline"><a id="mkmap" title="切到 ④ 画布：划线按章节排成脑图，单击卡片跳回原文，做完可上传到 Obsidian">🗺 画布</a></div>`;
    if (FILTER === "ask") html += `<div class="tip">还没弄懂的地方。可以在每条下面“🙋 问 Claude”，或者跟 Claude 说“讲讲我的待解决”。</div>`;
    const pages = src.map(p => ({ ...p, notes: p.notes.filter(n => pass(FILTER, n)) })).filter(p => p.notes.length);
    const where = SCOPE === "page" ? "这页" : "所有论文里";
    html += pages.length ? pages.map(p => (SCOPE === "page" ? "" : `<div class="page"><a href="${esc(p.url)}" target="_blank">${esc(p.title || p.url)}</a> <span class="n">${p.notes.length}</span></div>`) + p.notes.map(n => noteHtml(n, p.url)).join("")).join("")
      : `<p class="tip">${FILTER === "ask" ? where + "没有待解决的地方 🎉" : FILTER === "untag" ? where + "没有未归档的笔记。" : FILTER === "qa" ? where + "还没有问过 Claude 的地方。" : FILTER.startsWith("tag:") ? where + "这个标签下还没有笔记。" : SCOPE === "page" ? "这页还没有笔记。在网页上选中文字 → 小条：📝 写笔记 / ❓ 没看懂。" : "还没有笔记。"}</p>`;
  }
  CACHE = {}; all.forEach(p => CACHE[p.url] = p.notes); if (here) CACHE[t.url] = here.notes;
  el.innerHTML = html;
  restoreScroll("notes");
  el.querySelectorAll(".chips button[data-f]").forEach(b => b.onclick = () => { FILTER = b.dataset.f; try { chrome.storage.local.set({ noteFilter: FILTER }); } catch (e) {} renderNotes(); });
  el.querySelectorAll(".chips button[data-s]").forEach(b => b.onclick = () => { SCOPE = b.dataset.s; try { chrome.storage.local.set({ noteScope: SCOPE }); } catch (e) {} renderNotes(); });
  const mk = $("#mkmap");
  if (mk) mk.onclick = () => { setTabUI("canvas"); try { chrome.storage.local.set({ rnTab: TAB }); } catch (e) {} };   // 10-06：切到 ④ 画布
}
function refresh() { if (TAB === "notes") renderNotes(); if (TAB === "card") renderMethod(); if (TAB === "today") renderToday(); }
async function tellPage() { const t = await curTab(); t && chrome.tabs.sendMessage(t.id, { type: "reload-notes" }).catch(() => {}); }
document.addEventListener("click", async e => {
  const box = e.target.closest(".note"); if (!box) return;
  const id = box.dataset.id, url = box.dataset.url, a = e.target.dataset.a;
  if (e.target.classList.contains("qt")) {
    const t = await curTab();
    if (t && t.url.split("#")[0] === url.split("#")[0]) {
      const r = await chrome.tabs.sendMessage(t.id, { type: "goto", id }).catch(() => null);
      if (!r || !r.found) {
        let tip = box.querySelector(".miss");
        if (!tip) { tip = document.createElement("div"); tip.className = "miss"; box.appendChild(tip); }
        tip.textContent = "页面上找不到这条的位置：多半是在开着翻译时划的，那时还没记段落位置。可以在翻译和原文之间切换一下再点；或者直接在下面改 / 删。";
      }
    } else chrome.tabs.create({ url });
    return;
  }
  if (!a) return;
  if (a === "ask") {   // 在抽屉里直接问
    if (box.querySelector(".askrow")) return;
    const row = document.createElement("div"); row.className = "askrow";
    row.innerHTML = '<textarea placeholder="问 Claude，比如：这句话什么意思？（⌘+回车 发送）"></textarea><div class="side">' + pickers() + '<button class="ex">✨ 一键解释</button><button class="go">发送</button></div>';
    box.appendChild(row);
    const ta = row.querySelector("textarea"), bt = row.querySelector("button.go"), ms = row.querySelector("select.m"), es = row.querySelector("select.e"); ta.focus();
    row.querySelector("button.ex").onclick = () => { row.dataset.explain = "1"; ta.value = "请结合整篇论文的上下文，用中文把我划的这段讲清楚：①它在说什么（大白话）；②里面的关键术语 / 缩写是什么意思、在论文哪里定义的；③它在整篇论文的论证里起什么作用。"; send(); };
    initPickers(row);
    const send = async () => {
      const q = ta.value.trim() || "这段话是什么意思？请解释给我听。";
      ta.disabled = bt.disabled = ms.disabled = es.disabled = true; bt.textContent = "…";
      const live = document.createElement("div"); live.className = "qa live"; row.after(live);
      const r = await post("/api/ask_start", { url, id, question: q, model: ms.value, effort: es.value, ctx: row.querySelector("select.c").value, explain: !!row.dataset.explain });
      if (!r.ok) { live.textContent = "⚠️ " + (r.err || "出错了"); return; }
      while (true) {
        await new Promise(res => setTimeout(res, 700));
        const p = await (await fetch(API + "/api/ask_poll?jid=" + r.jid)).json();
        live.innerHTML = `<span class="who">🤖 ${esc(p.model || "")} · ${p.secs || 0} 秒 <span class="dots"><i></i><i></i><i></i></span></span><br>` +
          (p.err ? "⚠️ " + esc(p.err) : md(p.text || "正在读这段……", true));
        if (p.done || !p.ok) { if (p.qa) { renderNotes(); tellPage(); } else { bt.textContent = "发送"; ta.disabled = bt.disabled = ms.disabled = es.disabled = false; } break; }
      }
    };
    bt.onclick = send; ta.onkeydown = ev => { if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) send(); };
    return;
  }
  const isQ = box.querySelector('[data-a="solve"]') !== null;
  if (a === "tags") {
    const n = (CACHE[url] || []).find(x => x.id === id);
    const v = prompt("标签（多个用逗号或空格分开；清空 = 未归档）：", ((n && n.tags) || []).join("，")); if (v === null) return;
    await post("/api/webnote_update", { url, id, tags: v.split(/[，,、\s]+/).map(x => x.trim()).filter(Boolean) });
  }
  if (a === "link") {   // 定位链接：对方用 Chrome 打开会直接跳到这句并高亮
    const n = (CACHE[url] || []).find(x => x.id === id); if (!n) return;
    const w = (n.en || n.quote).replace(/\s+/g, " ").trim().split(" ");
    const enc = x => encodeURIComponent(x).replace(/-/g, "%2D").replace(/,/g, "%2C");
    const link = url.split("#")[0] + "#:~:text=" + (w.length > 12 ? enc(w.slice(0, 5).join(" ")) + "," + enc(w.slice(-5).join(" ")) : enc(w.join(" ")));
    try { await navigator.clipboard.writeText(link); e.target.textContent = "✓ 已复制"; } catch (er) { prompt("复制这个链接：", link); }
    return;
  }
  if (a === "q") await post("/api/webnote_update", { url, id, color: isQ ? "n" : "q", solved: false });
  if (a === "solve") await post("/api/webnote_update", { url, id, solved: e.target.textContent.includes("已解决") });
  if (a === "edit") {
    const old = box.querySelector(".mine") ? box.querySelector(".mine").textContent.replace(/^💬 /, "") : "";
    const v = prompt("备注：", old); if (v === null) return;
    await post("/api/webnote_update", { url, id, note: v });
  }
  if (a === "del") { if (!confirm("删除这条笔记？")) return; await post("/api/webnote_update", { url, id, delete: true }); }
  renderNotes(); tellPage();
});
chrome.runtime.onMessage.addListener(m => { if (m.type === "notes-changed") refresh(); });
chrome.tabs.onActivated.addListener(refresh);
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === "complete") refresh(); });
try { chrome.storage.local.get(["noteFilter", "noteScope"]).then(v => { if (v.noteFilter) FILTER = v.noteFilter === "page" ? "all" : v.noteFilter; if (v.noteScope) SCOPE = v.noteScope; else if (v.noteFilter === "page") SCOPE = "page"; }); } catch (e) {}

// ---------- 白天 / 黑夜 ----------
async function applyTheme() {
  let th = "auto"; try { th = (await chrome.storage.local.get("rnTheme")).rnTheme || "auto"; } catch (e) {}
  const dark = th === "dark" || (th === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
applyTheme();
try { chrome.storage.onChanged.addListener(c => { if (c.rnTheme) applyTheme(); }); } catch (e) {}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

// ---------- ④ 今天：今天读了哪几篇、读了多久、划线 / 提问几次；按每条阅读线计数（阅读线在数据文件夹 reading_lines.json 里设置） ----------
let LINEF = "";
async function renderToday() {
  const el = $("#v-today");
  let d, t;
  try { d = await (await fetch(API + "/api/today")).json(); t = await curTab(); }
  catch (e) { el.innerHTML = '<p class="err">连不上本机服务。请先运行 server/start.command（或 python3 server/server.py）。</p>'; return; }
  const short = id => (d.lines.find(L => L.id === id) || {}).short || "未归类";
  const sel = (url, cur, title) => `<select data-url="${esc(url)}" data-title="${esc(title || "")}"><option value="">未归类</option>${d.lines.map(L => `<option value="${L.id}" ${L.id === cur ? "selected" : ""}>${esc(L.short)}</option>`).join("")}</select>`;
  const q = (id, name) => { const n = d.quota[id] || 0; return `<div class="${n >= d.target ? "done" : ""}">${name}<br><b>${n}</b> / ${d.target} 篇</div>`; };
  const mins = s => Math.round((s || 0) / 60);
  const norm = u => (u || "").split("#")[0];
  const here = t && /^https?:/.test(t.url) ? d.pages.find(p => norm(p.url) === norm(t.url)) : null;
  let html = `<div class="tip">今天 ${esc(d.date)} · 算读过一次：从第一次划线算起，精读再读 ≥30 分钟、划 ≥2 次线且两次隔 ≥10 分钟；速扫划 ≥2 次、再读 ≥10 分钟（30 分钟内回来算同一次）。</div>
    ${d.lines.length ? `<div class="td-quota">${d.lines.map(L => q(L.id, esc(L.short))).join("")}</div>` : ""}`;
  if (t && /^https?:/.test(t.url)) {
    html += `<div class="td-cur">本页：${here ? `今天 ${mins(here.active)} 分钟 · ${here.valid ? '<span class="td-ok">已算有效</span>' : '<span class="td-no">还没满有效</span>'} · ${here.n ? `累计有效阅读 ${here.n} 次` : "以前没读过"}<br>这页归到哪条线（改归类，不是筛选）：${sel(here.url, here.line, here.title)}`
      : `还没有阅读记录（不在阅读清单里、也还没划线）。要算作论文阅读，选一条线：${sel(t.url, "", t.title)}`}</div>`;
  }
  // 10-05：只看某条线（筛选，不改归类）
  const used = [...new Set(d.pages.map(p => p.line || ""))];
  if (used.length > 1) html += `<div class="chips"><button data-lf="" class="${!LINEF ? "on" : ""}">全部</button>${used.map(id => `<button data-lf="${id || "-"}" class="${LINEF === (id || "-") ? "on" : ""}">${esc(id ? short(id) : "未归类")}</button>`).join("")}</div>`;
  const shown = d.pages.filter(p => !LINEF || (p.line || "-") === LINEF);
  html += shown.length ? shown.map(p => `<div class="td-row"><a href="${esc(p.url)}" target="_blank">${esc((p.title || p.url).replace(/^HTML阅读-/, "").slice(0, 70))}</a>
      <div class="m">${p.valid ? '<span class="td-ok">✓ 有效</span>' : '<span class="td-no">未满</span>'} · 今天 ${mins(p.active)} 分钟 · 划线 ${p.marks} · 提问 ${p.asks} · ${p.n ? `累计 ${p.n} 次` : "第一次"} · 归到 ${sel(p.url, p.line, p.title)}</div></div>`).join("")
    : '<p class="tip">今天还没有读论文的记录。</p>';
  el.innerHTML = html;
  el.querySelectorAll("[data-lf]").forEach(b => b.onclick = () => { LINEF = b.dataset.lf; renderToday(); });
  el.querySelectorAll("select[data-url]").forEach(s => s.onchange = async () => {
    await fetch(API + "/api/page_line", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: s.dataset.url, line: s.value, title: s.dataset.title }) });
    const tb = await curTab(); tb && chrome.tabs.sendMessage(tb.id, { type: "visit-now" }).catch(() => {});
    renderToday();
  });
}
