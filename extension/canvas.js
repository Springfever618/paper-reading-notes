// 2026-10-06：🗺 阅读画布（像 MarginNote 4 的脑图）。在网页左边的面板里打开；数据格式就是 Obsidian 画布（.canvas）。
// 状态存在本机服务（/api/mindmap_save），“上传到 Obsidian”写进这篇论文笔记所在的文件夹（/api/mindmap_export）。
const API = "http://127.0.0.1:8765";
const COL = { 1: "#e93147", 2: "#ec7500", 3: "#d4a000", 4: "#08b94e", 5: "#00a8a6", 6: "#7852ee" };
const $ = s => document.querySelector(s);
const view = $("#view"), stage = $("#stage"), svg = $("#edges");
let C = { nodes: [], edges: [] }, URL0 = "", T = { x: 40, y: 20, k: 0.8 }, SEL = null, saveT = null, STARONLY = false;
// 10-09：星标。划线卡标题栏的 ☆ 点一下变 ★（存进这条笔记，Obsidian 也认）；工具栏“只看★”只显示带星的卡片和它们的章节
const isNoteCard = n => /^rn-(?!sec|root)/.test(n.id) && !n.rnMine;
function hiddenByStar(n) {
  if (!STARONLY) return false;
  if (isNoteCard(n)) return !n.rnStar;
  if (n.id.startsWith("rn-sec")) return !C.edges.some(e => e.fromNode === n.id && (node(e.toNode) || {}).rnStar);
  return false;
}
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const msg = t => { $("#msg").textContent = t; };
const colorOf = n => COL[n.color] || (/^#/.test(n.color || "") ? n.color : "");
const node = id => C.nodes.find(n => n.id === id);

// ---------- 和网页（content.js）通话 ----------
const ask = (type, extra) => new Promise(res => {
  const id = Math.random().toString(36).slice(2);
  const on = e => { if (e.data && e.data.rnCanvasReply === id) { removeEventListener("message", on); res(e.data); } };
  addEventListener("message", on); parent.postMessage(Object.assign({ rnCanvas: type, rid: id }, extra || {}), "*");
  setTimeout(() => { removeEventListener("message", on); res(null); }, 4000);
});

async function load(sync) {
  msg(sync ? "同步中…" : "载入中…");
  const p = await ask("info");
  if (!p || p.err) { msg("⚠️ " + ((p && p.err) || "网页没响应，刷新网页再试")); return; }
  URL0 = p.url;
  try {
    if (sync) await save(true);
    const r = await (await fetch(API + "/api/mindmap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: p.url, title: p.title, secs: p.secs }) })).json();
    if (!r.ok) { msg("⚠️ " + (r.msg || "没载入")); return; }
    const first = !C.nodes.length; C = r.canvas; draw(); if (first) fit();
    const n = C.nodes.filter(x => x.id.startsWith("rn-") && !x.id.startsWith("rn-sec") && x.id !== "rn-root").length;
    msg(`${n} 条划线 · ${C.nodes.filter(x => x.id.startsWith("rn-sec")).length} 个章节`);
  } catch (e) { msg("⚠️ 连不上本机服务（127.0.0.1:8765）"); }
}
function save(now) {
  clearTimeout(saveT);
  const go = () => fetch(API + "/api/mindmap_save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: URL0, canvas: C }) }).catch(() => msg("⚠️ 没存上：本机服务没连上"));
  if (now) return go();
  saveT = setTimeout(go, 700);
}

// ---------- 画 ----------
function md(t) {   // 只认画布卡片里用到的几种写法
  const lines = String(t || "").split("\n"); let hd = "", out = [], go = "";
  for (const l of lines) {
    let m;
    if ((m = l.match(/^#### (.*)/))) { hd = m[1]; continue; }
    if ((m = l.match(/^\[📍[^\]]*\]\(([^)]+)\)/))) { go = m[1]; continue; }
    if ((m = l.match(/^!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/))) { out.push(`<img src="${API}/api/vaultimg?p=${encodeURIComponent(m[1])}">`); continue; }   // 10-06：粘贴的图片（存在 Obsidian 库里）
    if ((m = l.match(/^!\[[^\]]*\]\((https?:[^)\s]+)\)\s*$/))) { out.push(`<img src="${esc(m[1])}">`); continue; }
    let h = esc(l).replace(/&lt;small&gt;(.*?)&lt;\/small&gt;/g, "<small>$1</small>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    if (/^### |^## /.test(l)) h = `<h3>${h.replace(/^#+ /, "")}</h3>`;
    else if (/^&gt; /.test(h)) h = `<blockquote>${h.slice(5)}</blockquote>`;
    else if (!l.trim()) continue;
    else if (!/^<small>/.test(h)) h = `<p>${h}</p>`;
    out.push(h);
  }
  return { hd, body: out.join(""), go };
}
function draw() {
  stage.querySelectorAll(".node").forEach(e => e.remove());
  for (const n of C.nodes) {
    if (hiddenByStar(n)) continue;
    const el = document.createElement("div"), c = colorOf(n), { hd, body, go } = md(n.text);
    el.className = "node" + (SEL && SEL.n === n.id ? " sel" : ""); el.dataset.id = n.id;
    Object.assign(el.style, { left: n.x + "px", top: n.y + "px", width: n.width + "px", height: n.rnH ? n.height + "px" : "", borderColor: c || "" });
    if (n.rnH) el.classList.add("fixh");   // 拉过高度的卡片：高度固定，字多了在卡片里滚动
    const star = isNoteCard(n) ? `<span class="star${n.rnStar ? " on" : ""}" data-star="${esc(n.id)}" title="${n.rnStar ? "取消星标" : "标星：重要的卡片"}">${n.rnStar ? "★" : "☆"}</span>` : "";
    el.innerHTML = (hd ? `<div class="hd" style="background:${c || "#6b7280"}">${star}${esc(hd.replace(/^★\s*/, ""))}${go ? '<span class="go">📍 点卡片回原文</span>' : ""}</div>` : (star ? `<div class="hd" style="background:${c || "#6b7280"}">${star}</div>` : "")) + `<div class="bd">${body}</div><div class="hdl" title="拖到另一张卡片上＝连线"></div>${RZ}`;
    if (!hd && c) el.querySelector(".bd").style.borderTop = `6px solid ${c}`;
    el.querySelectorAll("img").forEach(im => im.addEventListener("load", () => { if (!n.rnH) n.height = Math.max(40, el.offsetHeight); restack(); drawEdges(); }, { once: true }));
    stage.appendChild(el);
    n.height = Math.max(40, el.offsetHeight);
  }
  restack(); drawEdges(); apply();
}
// 10-06：卡片四边 + 四角的拖动把手
const RZ = ["n", "s", "e", "w"].map(d => `<i class="rz" data-d="${d}" title="拖动调${/[ew]/.test(d) ? "宽度" : "高度"}（双击恢复自动高度）"></i>`).join("") +
  ["nw", "ne", "sw", "se"].map(d => `<i class="rz c" data-d="${d}" title="拖动按比例缩放（按住 Shift 自由缩放；双击恢复自动高度）"></i>`).join("");
// 没被你拖过的章节卡、划线卡（rnAuto）按实际高度排整齐：每章的划线卡一张接一张往下排，下一章接在上一章下面
function restack() {
  const G = 20, kids = id => C.edges.filter(e => e.fromNode === id).map(e => node(e.toNode)).filter(Boolean).sort((a, b) => a.y - b.y);
  const secs = C.nodes.filter(n => n.id.startsWith("rn-sec")).sort((a, b) => a.y - b.y);
  let y = 0;
  for (const s of secs) {
    if (s.rnAuto) s.y = y;
    let cy = s.y;
    for (const k of kids(s.id)) { if (k.rnAuto) { k.y = cy; } cy = Math.max(cy, k.y + k.height + G); }
    y = Math.max(cy, s.y + s.height + G) + G * 2;
  }
  stage.querySelectorAll(".node").forEach(el => { const n = node(el.dataset.id); el.style.top = n.y + "px"; el.style.left = n.x + "px"; });
}
function side(a, b) {   // 连线从哪条边出：看两张卡片的相对位置
  const ax = a.x + a.width / 2, ay = a.y + a.height / 2, bx = b.x + b.width / 2, by = b.y + b.height / 2;
  return Math.abs(bx - ax) > Math.abs(by - ay) ? (bx > ax ? ["right", "left"] : ["left", "right"]) : (by > ay ? ["bottom", "top"] : ["top", "bottom"]);
}
const pt = (n, s) => s === "right" ? [n.x + n.width, n.y + n.height / 2] : s === "left" ? [n.x, n.y + n.height / 2] : s === "top" ? [n.x + n.width / 2, n.y] : [n.x + n.width / 2, n.y + n.height];
function ctrlPts(p, ps, q, qs) {
  const d = Math.max(40, Math.hypot(q[0] - p[0], q[1] - p[1]) / 3), o = s => s === "right" ? [d, 0] : s === "left" ? [-d, 0] : s === "top" ? [0, -d] : [0, d];
  const a = o(ps), b = o(qs);
  return [p, [p[0] + a[0], p[1] + a[1]], [q[0] + b[0], q[1] + b[1]], q];
}
function curve(p, ps, q, qs) { const [A, B, D, E] = ctrlPts(p, ps, q, qs); return `M${A} C${B} ${D} ${E}`; }
const midPt = (p, ps, q, qs) => { const [A, B, D, E] = ctrlPts(p, ps, q, qs); return [0, 1].map(i => (A[i] + 3 * B[i] + 3 * D[i] + E[i]) / 8); };
// 10-06：连线样式（存在连线上：rnW 粗细 1 细 / 2 中 / 3 粗，rnDash 虚线，color 颜色，label 线上的字——label 和 color 是 Obsidian 画布自带的）
const EW = { 1: 1.5, 2: 2.5, 3: 4 };
const edgeW = e => EW[e.rnW] || EW[1];
let ELAB = null;   // 正在编辑字的那根线
function drawEdges() {
  svg.innerHTML = ""; stage.querySelectorAll(".elabel").forEach(x => { if (x.dataset.id !== ELAB) x.remove(); });
  for (const e of C.edges) {
    const a = node(e.fromNode), b = node(e.toNode); if (!a || !b || hiddenByStar(a) || hiddenByStar(b)) continue;
    [e.fromSide, e.toSide] = side(a, b);
    const P = pt(a, e.fromSide), Q = pt(b, e.toSide), d = curve(P, e.fromSide, Q, e.toSide), c = colorOf(e), w = edgeW(e), sel = SEL && SEL.e === e.id;
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d); p.dataset.id = e.id; p.classList.add("vis"); if (sel) p.classList.add("sel");
    p.style.strokeWidth = sel ? w + 2 : w; if (c && !sel) p.style.stroke = c;
    if (e.rnDash) p.style.strokeDasharray = `${w * 4} ${w * 3}`;
    const h = document.createElementNS("http://www.w3.org/2000/svg", "path");   // 看不见的粗线：好点中
    h.setAttribute("d", d); h.dataset.id = e.id; h.classList.add("hit");
    svg.append(p, h);
    if (e.label && e.id !== ELAB) {   // 线上的字：框的线型、粗细、颜色跟着这根线
      const m = midPt(P, e.fromSide, Q, e.toSide), L = document.createElement("div");
      L.className = "elabel" + (sel ? " sel" : ""); L.dataset.id = e.id; L.textContent = e.label;
      Object.assign(L.style, { left: m[0] + "px", top: m[1] + "px", border: `${Math.max(1, w - .5)}px ${e.rnDash ? "dashed" : "solid"} ${c || "var(--ink2)"}` });
      stage.appendChild(L);
    } else if (e.id === ELAB) { const m = midPt(P, e.fromSide, Q, e.toSide), L = stage.querySelector(`.elabel[data-id="${e.id}"]`); if (L) Object.assign(L.style, { left: m[0] + "px", top: m[1] + "px" }); }
  }
}
function editLabel(id) {   // 线上加字 / 改字：直接在线中间打，回车或点别处保存
  const e = C.edges.find(x => x.id === id); if (!e) return;
  ELAB = null; drawEdges(); ELAB = id;
  let L = stage.querySelector(`.elabel[data-id="${id}"]`);
  if (!L) { L = document.createElement("div"); L.className = "elabel"; L.dataset.id = id; stage.appendChild(L); drawEdges(); }
  L.textContent = e.label || ""; L.contentEditable = "true"; L.classList.add("editing"); L.focus();
  const r = document.createRange(); r.selectNodeContents(L); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  $("#ctl").classList.remove("on");
  const done = () => { L.removeEventListener("blur", done); e.label = L.textContent.trim(); if (!e.label) delete e.label; ELAB = null; L.remove(); drawEdges(); save(); setTimeout(ctl, 0); };
  L.addEventListener("blur", done);
  L.addEventListener("keydown", k => { k.stopPropagation(); if (k.key === "Enter" && !k.shiftKey || k.key === "Escape") { k.preventDefault(); L.blur(); } });
  L.addEventListener("pointerdown", k => k.stopPropagation());
}
function apply() { stage.style.transform = `translate(${T.x}px,${T.y}px) scale(${T.k})`; $("#zv").textContent = Math.round(T.k * 100) + "%"; if (SEL) ctl(); }
// 画布缩放按钮（以窗口中心为准）、卡片文字大小（记在本机，下次打开还是这个大小）
function zoomBy(f) { const r = view.getBoundingClientRect(), [x, y] = toStage(r.left + r.width / 2, r.top + r.height / 2), k = Math.max(0.15, Math.min(2.5, T.k * f)); T.x = r.width / 2 - x * k; T.y = r.height / 2 - y * k; T.k = k; apply(); }
let FS = 13; try { FS = +localStorage.getItem("rnCanvasFs") || 13; } catch (e) {}
function setFs(v) { FS = Math.max(10, Math.min(22, v)); document.documentElement.style.setProperty("--fs", FS + "px"); $("#fv").textContent = FS; try { localStorage.setItem("rnCanvasFs", FS); } catch (e) {} if (C.nodes.length) draw(); }
function fit() {
  if (!C.nodes.length) return;
  const x0 = Math.min(...C.nodes.map(n => n.x)), y0 = Math.min(...C.nodes.map(n => n.y));
  const x1 = Math.max(...C.nodes.map(n => n.x + n.width)), y1 = Math.max(...C.nodes.map(n => n.y + n.height));
  const W = view.clientWidth - 40, H = view.clientHeight - 40;
  T.k = Math.max(0.35, Math.min(1, W / (x1 - x0), H / (y1 - y0)));   // 太长时按宽度放下，从顶上开始看
  T.x = 20 - x0 * T.k; T.y = 20 - y0 * T.k; apply();
}
const toStage = (cx, cy) => { const r = view.getBoundingClientRect(); return [(cx - r.left - T.x) / T.k, (cy - r.top - T.y) / T.k]; };
function ctl() {   // 选中卡片上方的操作条
  const b = $("#ctl"), n = SEL && SEL.n && node(SEL.n);
  if (SEL && SEL.e) return ectl(b);
  if (!n || (document.activeElement && document.activeElement.tagName === "TEXTAREA")) { b.classList.remove("on"); return; }
  const isNote = !!noteId(n.id) && !n.rnMine, own = n.id !== "rn-root";
  b.innerHTML = (isNote ? '<button data-a="go" title="网页滚到原文这句">📍 原文</button>' : "") +
    (own ? '<button data-a="note" title="在卡片末尾加一行笔记（同步到 ② 笔记）">✏️ 补充笔记</button>' : "") +
    '<button data-a="edit" title="改卡片上的字">🖊 编辑</button>' +
    (own ? '<button data-a="del" class="del" title="删除这张卡片' + (isNote ? '和这条划线笔记' : "") + '">🗑 删除</button>' : "") +
    '<span class="sep"></span>' + Object.entries(COL).map(([k, v]) => `<i data-c="${k}" style="background:${v}" title="换颜色"></i>`).join("") + '<i data-c="" style="background:var(--card);border:1px solid var(--line)" title="无颜色"></i>';
  b.classList.add("on");
  const r = view.getBoundingClientRect(), x = n.x * T.k + T.x, y = n.y * T.k + T.y;
  b.style.left = Math.max(4, Math.min(x, r.width - b.offsetWidth - 4)) + "px";
  b.style.top = (y - b.offsetHeight - 6 < 4 ? y + n.height * T.k + 6 : y - b.offsetHeight - 6) + "px";
}
// 10-06：选中连线时的操作条（在线的中间）：删除 / 粗细 / 实线虚线 / 线上加字 / 颜色
function ectl(b) {
  const e = C.edges.find(x => x.id === SEL.e), a = e && node(e.fromNode), t = e && node(e.toNode);
  if (!e || !a || !t || ELAB) { b.classList.remove("on"); return; }
  const on = (k, v) => (k === "w" ? String(e.rnW || 1) === v : k === "d" ? !!e.rnDash === (v === "1") : false) ? " on" : "";
  b.innerHTML = '<button data-ea="del" class="del" title="删除这根连线（卡片不动）">🗑 删除</button><span class="sep"></span>' +
    [["1", "细"], ["2", "中"], ["3", "粗"]].map(([v, l]) => `<button data-ea="w" data-v="${v}" class="${on("w", v)}" title="线的粗细">${l}</button>`).join("") + '<span class="sep"></span>' +
    `<button data-ea="d" data-v="0" class="${on("d", "0")}" title="实线">━ 实线</button><button data-ea="d" data-v="1" class="${on("d", "1")}" title="虚线">┅ 虚线</button><span class="sep"></span>` +
    `<button data-ea="lab" title="在线中间写字（也可以双击连线）">✏️ ${e.label ? "改字" : "加字"}</button><span class="sep"></span>` +
    Object.entries(COL).map(([k, v]) => `<i data-ec="${k}" style="background:${v}" title="线的颜色"></i>`).join("") + '<i data-ec="" style="background:var(--card);border:1px solid var(--line)" title="默认颜色"></i>';
  b.classList.add("on");
  const m = midPt(pt(a, e.fromSide), e.fromSide, pt(t, e.toSide), e.toSide), r = view.getBoundingClientRect(), x = m[0] * T.k + T.x, y = m[1] * T.k + T.y;
  b.style.left = Math.max(4, Math.min(x - b.offsetWidth / 2, r.width - b.offsetWidth - 4)) + "px";
  b.style.top = (y - b.offsetHeight - 22 < 4 ? y + 22 : y - b.offsetHeight - 22) + "px";
}
$("#ctl").addEventListener("pointerdown", e => e.stopPropagation());
$("#ctl").addEventListener("click", async e => {
  if (SEL && SEL.e) {
    const ed = C.edges.find(x => x.id === SEL.e); if (!ed) return;
    const t = e.target.closest("[data-ea],[data-ec]"); if (!t) return;
    const ea = t.dataset.ea, v = t.dataset.v;
    if (t.dataset.ec !== undefined) { if (t.dataset.ec) ed.color = t.dataset.ec; else delete ed.color; }
    else if (ea === "del") { C.edges = C.edges.filter(x => x !== ed); select(null); drawEdges(); save(); return; }
    else if (ea === "w") { if (v === "1") delete ed.rnW; else ed.rnW = +v; }
    else if (ea === "d") { if (v === "1") ed.rnDash = true; else delete ed.rnDash; }
    else if (ea === "lab") { editLabel(ed.id); return; }
    drawEdges(); save(); ctl(); return;
  }
  const n = SEL && SEL.n && node(SEL.n); if (!n) return;
  const a = e.target.dataset.a, c = e.target.dataset.c, el = stage.querySelector(`.node[data-id="${n.id}"]`);
  if (c !== undefined) { if (c) n.color = c; else delete n.color; draw(); save(); return; }
  if (a === "go") parent.postMessage({ rnCanvas: "goto", id: noteId(n.id) }, "*");
  if (a === "edit") edit(n, el);
  if (a === "note") { if (!n.rnMine && !/\n✏️ /.test("\n" + (n.text || ""))) n.text = (n.text || "").replace(/\n*(\[📍[^\n]*)$/, "\n\n✏️ \n\n$1"); edit(n, el, "note"); }
  if (a === "del") delNode(n.id);
});
function select(s) { SEL = s; setTimeout(ctl, 0); stage.querySelectorAll(".node").forEach(e => e.classList.toggle("sel", !!s && s.n === e.dataset.id)); drawEdges(); }

// ---------- 操作 ----------
view.addEventListener("pointerdown", ev => {
  try { window.focus(); } catch (e) {}   // 10-06：点画布就把键盘交给画布（⌘V 贴图片、Delete 删卡片才收得到）
  const el = ev.target.closest(".node"), path = ev.target.closest("path");
  if (ev.target.closest("textarea,a")) return;
  if (document.activeElement && document.activeElement.tagName === "TEXTAREA") document.activeElement.blur();   // 点别处＝改完了
  const lab = ev.target.closest(".elabel");
  if (lab && lab.isContentEditable) return;
  if (path || lab) { select({ e: (path || lab).dataset.id }); return; }   // 点线或线上的字＝选中这根线
  if (ev.target.classList.contains("rz")) {   // 10-06：边＝单向拉伸，角＝按比例缩放（Shift 自由）；左边、上边拉时卡片位置跟着动
    ev.preventDefault(); select({ n: el.dataset.id });
    const n = node(el.dataset.id), d = ev.target.dataset.d, sx = ev.clientX, sy = ev.clientY, x0 = n.x, y0 = n.y, w0 = n.width, h0 = el.offsetHeight;
    let moved = false;
    const mv = e => {
      const dx = (e.clientX - sx) / T.k, dy = (e.clientY - sy) / T.k;
      if (!moved && Math.hypot(dx, dy) < 3) return; moved = true;
      let w = w0 + (d.includes("e") ? dx : d.includes("w") ? -dx : 0), h = h0 + (d.includes("s") ? dy : d.includes("n") ? -dy : 0);
      if (d.length === 2 && !e.shiftKey) { const f = Math.max(0.2, (w / w0 + h / h0) / 2); w = w0 * f; h = h0 * f; }
      w = Math.round(Math.max(120, w)); h = Math.round(Math.max(40, h));
      if (/[ew]/.test(d)) { n.width = w; if (d.includes("w")) n.x = x0 + w0 - w; }
      if (/[ns]/.test(d)) { n.height = h; n.rnH = true; el.classList.add("fixh"); el.style.height = h + "px"; if (d.includes("n")) { n.y = y0 + h0 - h; delete n.rnAuto; } }
      if (d.includes("w")) delete n.rnAuto;
      Object.assign(el.style, { width: n.width + "px", left: n.x + "px", top: n.y + "px" }); if (!n.rnH) n.height = el.offsetHeight;
      drawEdges(); ctl();
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); if (moved) { draw(); save(); } };   // 没拖动不重画，不然双击把手接不住
    addEventListener("pointermove", mv); addEventListener("pointerup", up); return;
  }
  if (ev.target.classList.contains("hdl")) {   // 从蓝点拖出一条线
    ev.preventDefault(); const a = node(el.dataset.id), tmp = document.createElementNS("http://www.w3.org/2000/svg", "path"); tmp.classList.add("tmp"); svg.appendChild(tmp);
    const mv = e => { const [x, y] = toStage(e.clientX, e.clientY); tmp.setAttribute("d", curve(pt(a, "right"), "right", [x, y], "left")); };
    const up = e => {
      removeEventListener("pointermove", mv); removeEventListener("pointerup", up); tmp.remove();
      const t = document.elementFromPoint(e.clientX, e.clientY), b = t && t.closest(".node");
      if (b && b.dataset.id !== a.id && !C.edges.some(x => x.fromNode === a.id && x.toNode === b.dataset.id)) {
        link(a.id, b.dataset.id); drawEdges(); save();
      } else if (!b && t && t.closest("#view")) {   // 10-06：拖到空白处松手＝在那里新建一张卡片并连上，直接开始打字
        const [x, y] = toStage(e.clientX, e.clientY); addCard(x, y - 30, a.id);
      }
    };
    addEventListener("pointermove", mv); addEventListener("pointerup", up); return;
  }
  ev.preventDefault();
  const sx = ev.clientX, sy = ev.clientY; let moved = false;
  if (el) {   // 拖卡片；没拖动就是单击＝跳到原文
    const n = node(el.dataset.id), ox = n.x, oy = n.y; select({ n: n.id });
    const mv = e => { const dx = (e.clientX - sx) / T.k, dy = (e.clientY - sy) / T.k; if (!moved && Math.hypot(dx, dy) < 4) return; moved = true; n.x = Math.round(ox + dx); n.y = Math.round(oy + dy); delete n.rnAuto; el.style.left = n.x + "px"; el.style.top = n.y + "px"; drawEdges(); };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); if (moved) { settle(n); draw(); save(); } else if (/^rn-(?!sec|root)/.test(n.id)) parent.postMessage({ rnCanvas: "goto", id: n.id.slice(3) }, "*"); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up); return;
  }
  select(null); view.classList.add("pan"); const ox = T.x, oy = T.y;   // 拖空白处＝平移
  const mv = e => { T.x = ox + e.clientX - sx; T.y = oy + e.clientY - sy; apply(); };
  const up = () => { view.classList.remove("pan"); removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
  addEventListener("pointermove", mv); addEventListener("pointerup", up);
});
// 10-06：鼠标滚轮＝缩放（以鼠标所在点为中心）；触控板两指滑＝平移，两指捏合＝缩放；按住 Shift 滚轮＝左右平移
// 鼠标滚轮和触控板都发 wheel 事件：鼠标一格是整数、幅度大、没有横向；触控板是连续的小数
const isMouseWheel = e => e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);
view.addEventListener("wheel", e => {
  e.preventDefault();
  if (e.shiftKey && !e.ctrlKey && !e.metaKey) { T.x -= e.deltaY || e.deltaX; apply(); return; }
  if (e.ctrlKey || e.metaKey || isMouseWheel(e)) { const [x, y] = toStage(e.clientX, e.clientY), k = Math.max(0.15, Math.min(2, T.k * Math.exp(-e.deltaY / 300))); const r = view.getBoundingClientRect(); T.x = e.clientX - r.left - x * k; T.y = e.clientY - r.top - y * k; T.k = k; }
  else { T.x -= e.deltaX; T.y -= e.deltaY; }
  apply();
}, { passive: false });
function edit(n, el, where) {
  const ta = document.createElement("textarea"); ta.value = n.text || ""; el.innerHTML = ""; el.style.height = ""; el.classList.remove("fixh");   // 编辑时先放开高度，改完按原来的高度画回去
  el.appendChild(ta); ta.focus(); $("#ctl").classList.remove("on");
  const at = where === "note" ? ta.value.lastIndexOf("✏️ ") : -1;   // 补充笔记：光标放到 ✏️ 那一行末尾
  const pos = at >= 0 ? (ta.value.indexOf("\n", at) < 0 ? ta.value.length : ta.value.indexOf("\n", at)) : ta.value.length;
  ta.setSelectionRange(pos, pos); ta.style.height = Math.max(120, ta.scrollHeight + 10) + "px";
  ta.addEventListener("pointerdown", e => e.stopPropagation());
  ta.addEventListener("blur", () => {
    const old = n.text; n.text = ta.value;
    if (n.id.startsWith("my") && !n.text.trim()) { C.nodes = C.nodes.filter(x => x !== n); C.edges = C.edges.filter(x => x.fromNode !== n.id && x.toNode !== n.id); select(null); draw(); save(); return; }   // 10-06：新卡片什么都没写就点走了＝不要了
    draw(); save(); if (old !== n.text) syncNote(n);
  });
  ta.addEventListener("keydown", e => { if (e.key === "Escape") ta.blur(); e.stopPropagation(); });
}
function addCard(x, y, from) {
  const n = { id: "my" + Math.random().toString(36).slice(2, 10), type: "text", x: Math.round(x), y: Math.round(y), width: 240, height: 80, text: "" };
  C.nodes.push(n); if (from) link(from, n.id);
  settle(n); draw(); select({ n: n.id }); edit(n, stage.querySelector(`.node[data-id="${n.id}"]`));
}
const link = (a, b) => C.edges.push({ id: "e" + Math.random().toString(36).slice(2, 10), fromNode: a, fromSide: "right", toNode: b, toSide: "left" });

// 10-06：拖完卡片后自动整理，不叠在一起
// 拖回同一列附近（章节卡那一列 / 某章划线卡那一列）＝调顺序：插到松手的位置，这一列重新一张接一张排好
// 拖到别处＝自由摆放：压到别的卡片就往下挪到空处
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
function settle(n) {
  const par = C.edges.find(e => e.toNode === n.id && (e.fromNode === "rn-root" || e.fromNode.startsWith("rn-sec")));
  const sibs = par ? C.edges.filter(e => e.fromNode === par.fromNode && e.toNode !== n.id).map(e => node(e.toNode)).filter(s => s && s.rnAuto) : [];
  if (sibs.length) {
    const xs = sibs.map(s => s.x).sort((a, b) => a - b), colX = xs[xs.length >> 1];
    if (Math.abs(n.x - colX) < Math.max(n.width, 200) * 0.6) { n.x = colX; n.rnAuto = true; return; }
  }
  for (let k = 0; k < 60; k++) {
    const o = C.nodes.find(o => o !== n && overlap({ x: n.x, y: n.y, width: n.width, height: n.height }, o));
    if (!o) break; n.y = o.y + o.height + 20;
  }
}

// 10-06：⌘V / Ctrl+V 贴图片（截图、复制的图都行），也可以把图片文件拖进画布
// 选着一张卡片时，新图片接在它右边并连上线；没选就放在画面中间。图片存进 Obsidian 库，双击图片卡可以加描述
async function addImage(file, at) {
  if (!file || !/^image\//.test(file.type)) return false;
  msg("图片上传中…");
  const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
  let r; try { r = await (await fetch(API + "/api/mindmap_img", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) })).json(); } catch (e) { msg("⚠️ 连不上本机服务"); return true; }
  if (!r.ok) { msg("⚠️ " + (r.msg || "图片没存上")); return true; }
  const from = SEL && SEL.n && node(SEL.n), vr = view.getBoundingClientRect();
  const [cx, cy] = at || toStage(vr.left + vr.width / 2 - 140, vr.top + vr.height / 2 - 80);
  const n = { id: "im" + Math.random().toString(36).slice(2, 10), type: "text", x: Math.round(from && !at ? from.x + from.width + 80 : cx), y: Math.round(from && !at ? from.y : cy), width: 280, height: 160, text: `![[${r.path}]]` };
  C.nodes.push(n); if (from) link(from.id, n.id);
  settle(n); draw(); select({ n: n.id }); save();
  msg("✅ 已贴上图片" + (from ? "，并连到选中的卡片" : "") + " · 双击图片卡可加描述");
  return true;
}
addEventListener("paste", async e => {
  if (e.target && e.target.tagName === "TEXTAREA") return;   // 正在打字时照常粘贴文字
  const f = [...(e.clipboardData ? e.clipboardData.items : [])].find(i => i.kind === "file" && /^image\//.test(i.type));
  if (f) { e.preventDefault(); addImage(f.getAsFile()); }
});
view.addEventListener("dragover", e => { if ([...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
view.addEventListener("drop", e => {
  const f = [...e.dataTransfer.files].find(f => /^image\//.test(f.type)); if (!f) return;
  e.preventDefault(); addImage(f, toStage(e.clientX, e.clientY));
});
view.addEventListener("dblclick", e => {
  const el = e.target.closest(".node"), ep = e.target.closest("path.hit, .elabel");
  if (ep && !(ep.isContentEditable)) { select({ e: ep.dataset.id }); editLabel(ep.dataset.id); return; }   // 双击连线＝在线上写字
  if (el && e.target.classList.contains("rz")) { delete node(el.dataset.id).rnH; draw(); save(); return; }   // 双击把手＝恢复自动高度
  if (el) edit(node(el.dataset.id), el); else { const [x, y] = toStage(e.clientX, e.clientY); addCard(x, y); }
});
addEventListener("keydown", e => {
  if (!SEL || e.target.tagName === "TEXTAREA" || !["Delete", "Backspace"].includes(e.key)) return;
  if (SEL.e) { C.edges = C.edges.filter(x => x.id !== SEL.e); select(null); draw(); save(); }
  if (SEL && SEL.n) delNode(SEL.n);
});
async function delNode(id) {
  {
    if (id === "rn-root") return;
    const nid = noteId(id);
    if (nid) {   // 划线卡：连笔记一起删（网页上的划线、② 笔记都会去掉）
      if (!confirm("删掉这张卡片，同时删掉这条划线笔记？\n（网页上的划线、② 笔记里的这条都会去掉）")) return;
      await fetch(API + "/api/webnote_update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: URL0, id: nid, delete: true }) }).catch(() => {});
      parent.postMessage({ rnCanvas: "changed" }, "*");
    }
    C.nodes = C.nodes.filter(x => x.id !== id); C.edges = C.edges.filter(x => x.fromNode !== id && x.toNode !== id);
  }
  select(null); draw(); save(); lastSig = null;
}
// 画布卡片 ↔ 笔记：rn-笔记id 的卡片就是一条笔记
const noteId = id => /^rn-(?!sec|root)/.test(id) ? id.slice(3) : null;
async function syncNote(n) {
  const H = { "Content-Type": "application/json" }, nid = noteId(n.id);
  try {
    if (nid) {   // 改了划线卡：“✏️”后面的字就是笔记
      const note = n.rnMine ? n.text : (n.text || "").split("\n").filter(l => l.startsWith("✏️")).map(l => l.replace(/^✏️\s*/, "")).join("\n");
      await fetch(API + "/api/webnote_update", { method: "POST", headers: H, body: JSON.stringify({ url: URL0, id: nid, note }) });
    } else if (n.id.startsWith("my") && (n.text || "").trim()) {   // 新卡片：同时记一条笔记（没有划线位置的那种）
      const r = await (await fetch(API + "/api/webnote", { method: "POST", headers: H, body: JSON.stringify({ url: URL0, quote: "", note: n.text, color: "g" }) })).json();
      if (r.ok) { const old = n.id; n.id = "rn-" + r.note.id; n.rnMine = true; C.edges.forEach(e => { if (e.fromNode === old) e.fromNode = n.id; if (e.toNode === old) e.toNode = n.id; }); draw(); save(); }
    } else return;
    parent.postMessage({ rnCanvas: "changed" }, "*"); msg("✅ 已同步到笔记");
  } catch (e) { msg("⚠️ 没同步上：本机服务没连上"); }
}
$("#sync").onclick = () => load(true);
$("#staronly").onclick = () => { STARONLY = !STARONLY; $("#staronly").classList.toggle("on", STARONLY); $("#staronly").textContent = STARONLY ? "★ 只看星标" : "☆ 只看星标"; select(null); draw(); fit(); };
stage.addEventListener("pointerdown", e => { if (e.target.closest("[data-star]")) e.stopPropagation(); }, true);
stage.addEventListener("click", async e => {
  const b = e.target.closest("[data-star]"); if (!b) return;
  e.stopPropagation(); e.preventDefault();
  const n = node(b.dataset.star); if (!n) return;
  n.rnStar = !n.rnStar; draw();
  try { await fetch(API + "/api/webnote_update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: URL0, id: noteId(n.id), star: n.rnStar }) }); msg(n.rnStar ? "★ 已标星" : "已取消星标"); }
  catch (err) { msg("⚠️ 没存上：本机服务没连上"); }
}, true);
$("#fit").onclick = fit;
$("#zi").onclick = () => zoomBy(1.2); $("#zo").onclick = () => zoomBy(1 / 1.2);
$("#fi").onclick = () => setFs(FS + 1); $("#fo").onclick = () => setFs(FS - 1); setFs(FS);
$("#add").onclick = () => { const r = view.getBoundingClientRect(); const [x, y] = toStage(r.left + r.width / 2 - 150, r.top + r.height / 2 - 40); addCard(x, y); };
$("#up").onclick = async () => {
  msg("上传中…"); await save(true);
  try {
    const r = await (await fetch(API + "/api/mindmap_export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: URL0, canvas: C }) })).json();
    if (r.ok && r.canvas) { C = r.canvas; draw(); }   // 上传前先合并了 Obsidian 里的改动，画面跟着更新
    msg(r.ok ? "✅ 已上传：" + r.file + (r.note ? "（论文笔记里加了链接）" : "") : "⚠️ " + (r.msg || "没上传上"));
  } catch (e) { msg("⚠️ 连不上本机服务"); }
};
addEventListener("message", e => { if (e.data && e.data.rnCanvas === "shown" && C.nodes.length) load(true); });
// 自动同步：每 4 秒看一眼这页的笔记有没有变（新划线、改笔记、删笔记），变了就补进画布；正在打字、拖动、画布没显示时不动
let lastSig = null, busy = false;
addEventListener("pointerdown", () => { busy = true; }, true); addEventListener("pointerup", () => { setTimeout(() => { busy = false; }, 300); }, true);
setInterval(async () => {
  if (!URL0 || busy || !view.clientHeight || (document.activeElement && document.activeElement.tagName === "TEXTAREA")) return;
  try {
    const d = await (await fetch(API + "/api/webnotes?url=" + encodeURIComponent(URL0))).json();
    const sig = (d.notes || []).map(n => n.id + ":" + (n.note || "").length + ":" + (n.quote || "").length).join("|");
    if (lastSig !== null && sig !== lastSig) { lastSig = sig; await load(true); } else lastSig = sig;
  } catch (e) {}
}, 4000);   // 每次拉开面板，顺手补上新划线
// 顶栏放不下会换行：画布区域跟着顶栏的实际高度往下让
const fitBar = () => { view.style.top = $("#bar").offsetHeight + "px"; };
new ResizeObserver(fitBar).observe($("#bar")); fitBar();
load(false);
