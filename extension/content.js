// 网页笔记：划线 / 写笔记 / 收藏；下次打开同一网页自动显示。数据经后台存到本机服务（127.0.0.1:8765），不上传任何地方。
(() => {
  if (window.__rnLoaded) return; window.__rnLoaded = true;
  const call = (msg) => new Promise(res => chrome.runtime.sendMessage(msg, r => res(r || { ok: false })));
  let NOTES = [];
  const VER = "1.9.6";
  // 插件自己的界面不让 Chrome / 翻译插件翻译（否则“波浪线”会被翻成“河线”）
  const noTr = el => { el.setAttribute("translate", "no"); el.classList.add("notranslate"); return el; };
  // 样式：颜色 × 类型（高亮 / 下划线 / 波浪线 / 方框）× 粗细
  const PAL = { yellow: "255,212,0", green: "95,178,54", blue: "59,111,216", red: "229,72,77", pink: "255,111,174", purple: "142,92,217", orange: "242,153,74" };
  const PAL_NAME = { yellow: "黄", green: "绿", blue: "蓝", red: "红", pink: "粉", purple: "紫", orange: "橙" };
  const DEF = { y: { c: "yellow", t: "hl", w: 2 }, g: { c: "green", t: "hl", w: 2 }, n: { c: "blue", t: "ul", w: 2 }, q: { c: "orange", t: "wave", w: 2 } };
  const styOf = n => Object.assign({}, DEF[n.color] || DEF.y, n.sty || {});
  function applyStyle(m, sty) {
    const rgb = PAL[sty.c] || PAL.yellow, w = sty.w || 2, set = (k, v) => m.style.setProperty(k, v, "important");
    ["background", "text-decoration", "text-decoration-line", "text-decoration-style", "text-decoration-color", "text-decoration-thickness", "text-underline-offset", "outline", "outline-offset", "border-bottom"].forEach(k => m.style.removeProperty(k));
    set("color", "inherit");
    if (sty.t === "hl") set("background", `rgba(${rgb},${[0, .25, .4, .6][w]})`);
    else if (sty.t === "box") { set("background", "transparent"); set("outline", `${w}px solid rgb(${rgb})`); set("outline-offset", "1px"); }
    else {
      set("background", "transparent"); set("text-decoration-line", "underline");
      set("text-decoration-style", sty.t === "wave" ? "wavy" : "solid");
      set("text-decoration-color", `rgb(${rgb})`); set("text-decoration-thickness", `${w}px`); set("text-underline-offset", sty.t === "wave" ? "3px" : "2px");
    }
  }

  // ---------- 10-05：开着翻译时也能跳到原句所在段落 ----------
  // 网页是英文（没开翻译）时，把每个段落元素的英文存一份；Chrome 翻译只换文字、不改段落结构，所以第几段对得上
  const isTr = () => /translated-(ltr|rtl)/.test(document.documentElement.className);
  const PARA_SEL = "p,li,h1,h2,h3,h4,h5,figcaption,td,dd,blockquote";
  const paraEls = () => [...document.querySelectorAll(PARA_SEL)].filter(e => !e.closest("#rn-bar,#rn-pop,#rn-tip,#rn-rail,#rn-toast,#rn-drawer-host"));
  const PKEY = "rnPara:" + location.href.split("#")[0];
  let PARA = null;
  function paraSnap() {
    if (isTr() || window.top !== window) return;
    const els = paraEls(); if (els.length < 5) return;
    PARA = els.map(e => norm(e.textContent || "").toLowerCase());
    try { chrome.storage.local.set({ [PKEY]: { n: els.length, t: PARA, at: Date.now() } }); } catch (e) {}
  }
  function paraFind(want) {
    const els = paraEls(); if (!PARA || PARA.length !== els.length) return null;
    const keys = [want, want.slice(0, 80), want.slice(-80)].filter(k => k.length >= 12);
    for (const k of keys) { const i = PARA.findIndex(t => t.includes(k)); if (i >= 0) return els[i]; }
    return null;
  }
  try { chrome.storage.local.get(PKEY).then(v => { const x = v[PKEY]; if (x && !PARA) PARA = x.t; }); } catch (e) {}
  setTimeout(paraSnap, 0); setTimeout(paraSnap, 2500); setTimeout(paraSnap, 8000);   // 等本脚本全部加载完再拍（10-05 修：直接调用会在 norm 定义前运行、整个插件报错停掉）
  function flashEl(el) {
    const b = el.getBoundingClientRect(), f = noTr(document.createElement("div")); f.className = "rn-flash";
    Object.assign(f.style, { left: b.left - 3 + "px", top: b.top - 3 + "px", width: b.width + 6 + "px", height: Math.min(b.height, innerHeight * .8) + 6 + "px" });
    document.body.appendChild(f); setTimeout(() => f.remove(), 2600);
  }

  // ---------- 在页面里按原文找到并标出 ----------
  // 10-09：看不见的文字不进索引——Cell 等网站在每个引用编号 [36] 后面藏着整条参考文献（display:none），
  // 选中的文字里没有它，索引里却有，带引用编号的句子（多行的基本都带）就对不上、画不出高亮
  const HID = new WeakMap();
  function hiddenEl(el) {
    if (HID.has(el)) return HID.get(el);
    let h = false;
    try { h = el.checkVisibility ? !el.checkVisibility({ checkVisibilityCSS: true }) : (getComputedStyle(el).display === "none"); } catch (e) {}
    HID.set(el, h); return h;
  }
  function textIndex(root) {
    const w = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, { acceptNode: n =>
      (!n.parentElement || n.parentElement.closest("script,style,noscript,#rn-bar,#rn-pop,#rn-tip,#rn-rail,#rn-toast,.rn-ico,.rn-tgico,.rn-guide,.rn-tr") || hiddenEl(n.parentElement)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    let s = "", map = [], n, prevSpace = true;
    while ((n = w.nextNode())) {
      const t = n.nodeValue;
      for (let i = 0; i < t.length; i++) {
        const sp = /\s/.test(t[i]);
        if (sp && prevSpace) continue;
        s += sp ? " " : t[i]; map.push([n, i]); prevSpace = sp;
      }
    }
    return { s, map };
  }
  const norm = q => q.replace(/\s+/g, " ").trim();
  function highlight(note) {
    if (document.querySelector(`mark.rn-hl[data-id="${note.id}"]`)) return true;
    // 10-05：一条笔记记着两种语言的原句（划线时的 quote、英文原句 en、翻译后的中文 zh），切换翻译后用当前页面上那种语言去找
    const cands = [...new Set([note.quote, note.en, note.zh].map(x => norm(x || "")).filter(x => x.length >= 2))];
    if (!cands.length) return false;
    let { s, map } = textIndex(); let q = cands[0], at = -1;
    for (const c of cands) { const i = s.indexOf(c); if (i >= 0) { q = c; at = i; break; } }
    let len = q.length, approx = false;
    const para = document.querySelector(`.rn-ico.para-note[data-id="${note.id}"]`);
    if (at < 0) {   // 两种语言的原句都找不到（多半是刚切换了翻译）：不按位置硬估——那样必然画错——只在那一段开头放一个小图标
      if (para) return true;
      const a = note.anchor, el = a && document.getElementById(a.id);
      if (!el) return false;
      const ico = noTr(document.createElement("span")); ico.className = "rn-ico para-note " + kindOf(note); ico.dataset.id = note.id;
      ico.textContent = { ask: "?", solved: "✓", note: "✎" }[kindOf(note)]; ico.title = "这一段有笔记（切换翻译后找不到原句，只标到段落）";
      el.insertBefore(ico, el.firstChild); drawRail(); return true;
    }
    if (para) para.remove();   // 原句又找到了（比如切回原文）：去掉段落小图标，正常划线
    if (at >= 0 && q === norm(note.quote || "") && s.indexOf(q, at + 1) >= 0) {   // 页面上出现不止一次：用存下的前文 / 后文 / 第几次出现挑对的那一处
      const all = []; for (let i = at; i >= 0; i = s.indexOf(q, i + 1)) all.push(i);
      const pre = norm(note.prefix || "").slice(-12), suf = norm(note.suffix || "").slice(0, 12);
      const score = i => (pre && s.slice(Math.max(0, i - pre.length), i).endsWith(pre) ? 2 : 0) + (suf && s.slice(i + q.length).startsWith(suf) ? 1 : 0);
      let pick = all[Number.isInteger(note.occ) && note.occ < all.length ? note.occ : 0], ps = score(pick);
      for (const i of all) { const sc = score(i); if (sc > ps) { pick = i; ps = sc; } }
      at = pick;
    }
    const parts = []; let cur = null;
    for (let k = at; k < at + len; k++) {
      const [node, off] = map[k];
      if (!cur || cur.node !== node) { cur = { node, start: off, end: off + 1 }; parts.push(cur); } else cur.end = off + 1;
    }
    for (const p of parts.reverse()) {
      try {
        const r = document.createRange(); r.setStart(p.node, p.start); r.setEnd(p.node, p.end);
        const m = document.createElement("mark");
        m.className = "rn-hl"; m.dataset.id = note.id; if (approx) m.dataset.approx = "1";
        r.surroundContents(m);
      } catch (e) {}
    }
    decorate(note);
    // 页面没开翻译、标出来的是英文：记下英文原句（以后在 PDF 上对齐用）
    const tr = document.documentElement.className.match(/translated-(ltr|rtl)/);
    if (!tr && !approx) {   // 只有在英文原页上“原句精确找到”时才记英文；按位置估出来的不算（短词容易估错）
      const en = norm([...document.querySelectorAll(`mark.rn-hl[data-id="${note.id}"]`)].map(m => m.textContent).join(""));
      const asc = en.length ? [...en].filter(ch => ch.charCodeAt(0) < 128).length / en.length : 0;
      if (en.length > 8 && asc > 0.85 && en !== note.en && en !== norm(note.quote || "")) { note.en = en; call({ type: "update", url: location.href, id: note.id, en }); }
    }
    if (tr && !approx) rememberZh(note);
    if (!approx && !note.anchor) {   // 老笔记：这次找到了原句，顺手补记段落位置
      const an = anchorOfEl(document.querySelector(`mark.rn-hl[data-id="${note.id}"]`), q);
      if (an) { note.anchor = an; call({ type: "update", url: location.href, id: note.id, anchor: an }); }
    }
    return true;
  }
  // 10-05：页面开着翻译、划线还在（Chrome 翻译常常保留我们的 mark）：把 mark 里现在的中文记成 zh，下次切到中文时直接找
  function rememberZh(note) {
    const t = norm([...document.querySelectorAll(`mark.rn-hl[data-id="${note.id}"]`)].map(m => m.textContent).join(""));
    if (t.length < 2 || t === norm(note.quote || "") || t === norm(note.zh || "")) return;
    const cjk = [...t].filter(ch => /[\u3400-\u9fff]/.test(ch)).length / t.length;
    if (cjk < 0.3) return;
    note.zh = t; call({ type: "update", url: location.href, id: note.id, zh: t });
  }
  // 记下划线所在元素（最近一个带 id 的元素）和在它文字里的起止比例
  function anchorOfEl(startNode, quote) {
    try {
      const el = (startNode.nodeType === 1 ? startNode : startNode.parentElement).closest("[id]:not(mark):not(body):not(html)");
      if (!el) return null;
      const { s } = textIndex(el), qq = norm(quote), i = s.indexOf(qq);
      if (i < 0 || !s.length) return null;
      return { id: el.id, s: i / s.length, e: (i + qq.length) / s.length };
    } catch (e) { return null; }
  }
  // 选中的文字在整页里是哪一处：记前文、后文、第几次出现（同一段字出现多次时用来找对位置，10-04）
  function whereSel(range, quote) {
    try {
      const qq = norm(quote); if (!qq) return {};
      let node = range.startContainer, off = range.startOffset;
      if (node.nodeType !== 3) {   // 选区从元素开始：取它里面第一个文字节点
        const w = document.createTreeWalker(node.childNodes[off] || node, NodeFilter.SHOW_TEXT); node = w.nextNode() || node; off = 0;
      }
      const { s, map } = textIndex();
      let p = map.findIndex(([nd, i]) => nd === node && i >= off);
      if (p < 0) return {};
      while (p < s.length && s[p] === " ") p++;
      let best = -1, k = 0, occ = 0, i = s.indexOf(qq);
      while (i >= 0) { if (best < 0 || Math.abs(i - p) < Math.abs(best - p)) { best = i; occ = k; } k++; i = s.indexOf(qq, i + 1); }
      if (best < 0) return {};
      return { prefix: s.slice(Math.max(0, best - 30), best), suffix: s.slice(best + qq.length, best + qq.length + 30), occ };
    } catch (e) { return {}; }
  }
  async function loadNotes() {
    const r = await call({ type: "list", url: location.href });
    if (!Array.isArray(r.notes)) return;   // 连不上本机服务时什么都不动，免得把已标的划线抹掉
    NOTES = r.notes;
    const ids = new Set(NOTES.map(n => n.id));
    document.querySelectorAll("mark.rn-hl").forEach(m => {
      const n = NOTES.find(x => x.id === m.dataset.id);
      if (!ids.has(m.dataset.id)) { m.replaceWith(...m.childNodes); return; }
    });
    document.querySelectorAll(".rn-ico").forEach(i => { if (!ids.has(i.dataset.id)) i.remove(); });
    NOTES.forEach(n => document.querySelector(`mark.rn-hl[data-id="${n.id}"]`) && decorate(n));
    NOTES.forEach(highlight);
    if (NOTES.length) { sendPage(); setTimeout(sendPage, 8000); }   // 有笔记的论文页：把全文存一份在本机，问 Claude 用
  }

  // ---------- 主题：跟随系统 / 白天 / 黑夜 ----------
  let THEME = "auto";
  const isDark = () => THEME === "dark" || (THEME === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  const themed = el => { el.classList.toggle("rn-dark", isDark()); return el; };
  const reTheme = () => { document.querySelectorAll("#rn-bar,#rn-pop,#rn-tip,#rn-rail,#rn-toast").forEach(themed); };
  try { chrome.storage.local.get("rnTheme").then(v => { THEME = v.rnTheme || "auto"; reTheme(); }); } catch (e) {}
  try { chrome.storage.onChanged.addListener(c => { if (c.rnTheme) { THEME = c.rnTheme.newValue || "auto"; reTheme(); } }); } catch (e) {}
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", reTheme);
  function toastAct(msg, acts) {
    document.querySelectorAll("#rn-toast").forEach(t => t.remove());
    const t = themed(noTr(document.createElement("div"))); t.id = "rn-toast"; t.textContent = msg;
    acts.forEach(([l, fn]) => { const b = document.createElement("button"); b.textContent = l; b.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); t.remove(); fn(); }); t.appendChild(b); });
    document.body.appendChild(t); setTimeout(() => t.remove(), 5000);
  }
  function toast(msg) {
    document.querySelectorAll("#rn-toast").forEach(t => t.remove());
    const t = themed(noTr(document.createElement("div"))); t.id = "rn-toast"; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
  }

  // ---------- 选中文字 → 小工具条：📝 写笔记 / ❓ 没看懂 / 💡 有意思 ----------
  let bar = null, pop = null, popAt = 0;
  const kill = () => { bar && bar.remove(); bar = null; };
  const killPop = () => { pop && pop.remove(); pop = null; };
  window.addEventListener("mouseup", e => {
    if (pop || (e.target.closest && e.target.closest("#rn-bar,#rn-pop,#rn-rail"))) return;
    setTimeout(() => {
      const sel = window.getSelection(); const q = sel && sel.toString().trim();
      kill(); if (!q || q.length < 2) return;
      const range = sel.getRangeAt(0), rect = range.getBoundingClientRect();
      bar = themed(noTr(document.createElement("div"))); bar.id = "rn-bar";
      bar.innerHTML = `<div class="r1"><span class="lab">划线</span>${Object.keys(PAL).map(c => `<button data-pen="${c}" class="sw" title="用${PAL_NAME[c]}色划线（默认归到“未归档”）" style="background:rgb(${PAL[c]}) !important"></button>`).join("")}<span class="sep"></span>${[["hl", "高亮"], ["ul", "下划线"], ["wave", "波浪"], ["box", "方框"]].map(([t, l]) => `<button data-pt="${t}" class="pt">${l}</button>`).join("")}</div>
        <div class="r2"><button data-c="n">📝 写笔记</button><button data-c="a">💬 问 Claude</button><button data-c="q">❓ 没看懂</button><span class="v">v${VER}</span></div>`;
      bar.style.top = Math.min(innerHeight - 80, rect.bottom + 8) + "px"; bar.style.left = Math.max(8, Math.min(innerWidth - 400, rect.left)) + "px";
      const paintPen = () => bar && bar.querySelectorAll("[data-pt]").forEach(b => b.classList.toggle("on", b.dataset.pt === PEN.t));
      paintPen();
      document.body.appendChild(bar);
      bar.addEventListener("pointerdown", async ev => {
        ev.preventDefault(); ev.stopPropagation();
        const b = ev.target.closest("button"); if (!b) return;
        if (b.dataset.pt) { PEN.t = b.dataset.pt; try { chrome.storage.local.set({ rnPen: PEN }); } catch (e) {} paintPen(); return; }   // 换线型，小条不关
        if (b.dataset.pen) {   // 点颜色 = 直接划好（未归档），不弹编辑框
          kill();
          const note = await save({ quote: q, isNew: true, anchor: anchorOfEl(range.startContainer, q), ctx: ctxOf(sel), color: "n", note: "", tags: [], sty: { c: b.dataset.pen, t: PEN.t, w: PEN.w }, ...whereSel(range, q) });
          window.getSelection().removeAllRanges();
          if (note) toastAct("已划线 · 未归档", [["🏷 加标签 / 写笔记", () => { const m = document.querySelector(`mark.rn-hl[data-id="${note.id}"]`); openEditor(note, m ? m.getBoundingClientRect() : rect); }]]);
          else toast("⚠️ 没存上：连不上本机服务");
          return;
        }
        const c = b.dataset.c; if (!c) return;
        kill();
        const anchor = anchorOfEl(range.startContainer, q), ctx = ctxOf(sel);
        let last = null; try { last = (await chrome.storage.local.get("lastSty")).lastSty; } catch (e) {}
        const base = { quote: q, isNew: true, anchor, ctx, ...whereSel(range, q) };
        if (c === "n") openEditor({ ...base, color: "n", sty: last || undefined }, rect);
        if (c === "a") {   // 直接问：先存成一条普通笔记，再打开它的对话框
          const note = await save({ ...base, color: "n", note: "", sty: last || undefined });
          window.getSelection().removeAllRanges();
          if (note) { const m = document.querySelector(`mark.rn-hl[data-id="${note.id}"]`); openEditor(note, m ? m.getBoundingClientRect() : rect, null, true); }
          else toast("⚠️ 没存上：连不上本机服务");
        }
        if (c === "q") openEditor({ ...base, color: "q" }, rect);
      }, true);
    }, 10);
  }, true);   // 捕获阶段：别的插件（沉浸式翻译等）拦截事件也能收到
  // 后台进行中的提问：关掉编辑框照样进行，回来打开接着显示；答好了弹提示
  const LIVE = {};
  async function startAsk(n, qtext, model, effort, ctx, explain, label) {
    const r = await call({ type: "ask_start", url: location.href, id: n.id, question: qtext, model, effort, page: pageText(), ctx, explain });
    LIVE[n.id] = { q: qtext, model: label, text: "", secs: 0, jid: r.jid };
    if (!r.ok) { LIVE[n.id].err = r.err || (r.offline ? "连不上本机服务" : "出错了"); redrawLive(n.id); setTimeout(() => { delete LIVE[n.id]; }, 4000); return; }
    decorate(n); redrawLive(n.id); pollAsk(n.id);
  }
  function redrawLive(nid) { if (pop && pop.dataset.nid === nid && pop._drawQA) pop._drawQA(LIVE[nid]); }
  async function pollAsk(nid) {
    while (LIVE[nid]) {
      await new Promise(res => setTimeout(res, 700));
      const L = LIVE[nid]; if (!L) return;
      const p = await call({ type: "ask_poll", jid: L.jid });
      if (!p.ok) { L.err = p.err || "连不上本机服务"; }
      else { L.text = p.text; L.secs = p.secs; if (p.model) L.model = p.model; if (p.err) L.err = p.err; }
      if (p.ok && !p.done) { redrawLive(nid); continue; }
      const n = NOTES.find(x => x.id === nid); delete LIVE[nid];
      if (p.ok && p.qa && n) {
        n.qa = p.qa; decorate(n);
        if (pop && pop.dataset.nid === nid && pop._drawQA) pop._drawQA();
        else toastAct("✅ Claude 回答好了：“" + n.quote.slice(0, 18) + (n.quote.length > 18 ? "…”" : "”"), [["打开看", () => { const m = document.querySelector(`mark.rn-hl[data-id="${nid}"]`); openEditor(n, m ? m.getBoundingClientRect() : { left: innerWidth / 3, bottom: 120 }); }]]);
      } else if (n) { LIVE[nid] = L; L.err = L.err || "没有回答"; redrawLive(nid); delete LIVE[nid]; if (n) decorate(n); }
      return;
    }
  }
  async function resumeAsks() {   // 刷新网页后：还在进行的提问接着显示
    const r = await call({ type: "jobs_for", url: location.href });
    (r.jobs || []).forEach(j => { if (!j.done && !LIVE[j.nid]) { LIVE[j.nid] = { q: j.q, model: "", text: "", secs: j.secs, jid: j.jid }; const n = NOTES.find(x => x.id === j.nid); if (n) decorate(n); pollAsk(j.nid); } });
  }
  let PEN = { t: "hl", w: 2 };
  try { chrome.storage.local.get("rnPen").then(v => { if (v.rnPen) PEN = v.rnPen; }); } catch (e) {}
  async function save(n) {
    const ael = n.anchor && n.anchor.id && document.getElementById(n.anchor.id);
    const r = await call({ type: "add", url: location.href, title: document.title, quote: n.quote, color: n.color, note: n.note, tags: n.tags || [], sty: n.sty, actx: ael ? (ael.innerText || "").slice(0, 4000) : "", ctx: n.ctx || "", meta: pageMeta(), anchor: n.anchor || null,
      prefix: n.prefix || "", suffix: n.suffix || "", occ: n.occ });
    if (r.ok && r.note) { const note = Object.assign(n.sty ? { sty: n.sty } : {}, r.note); NOTES.push(note); highlight(note); return note; }
    return null;
  }
  // 论文身份（用来认出同一篇论文）：DOI、arXiv 号、论文标题
  function pageMeta() {
    const m = n => (document.querySelector(`meta[name="${n}"]`) || {}).content || "";
    const ax = (location.href.match(/arxiv\.org\/(?:abs|html|pdf)\/(\d{4}\.\d{4,5})/) || [])[1] || m("citation_arxiv_id").replace(/v\d+$/, "");
    const doi = m("citation_doi") || m("dc.identifier").replace(/^doi:/i, "") || (location.href.match(/doi\.org\/(10\.[^?#]+)/) || [])[1] || "";
    return { doi, arxiv: ax, ctitle: m("citation_title") };
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
  // 整篇网页文字（去掉插件自己的界面），问 Claude 时一起发，让它能看到上下文（比如 S1 / S2 在前面哪里定义）
  function pageText() {
    try {
      const c = document.body.cloneNode(true);
      c.querySelectorAll("script,style,noscript,#rn-bar,#rn-pop,#rn-tip,#rn-rail,#rn-toast,#rn-drawer-host,.rn-ico,.rn-tgico,.rn-guide,nav,header,footer").forEach(x => x.remove());
      return (c.innerText || c.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 120000);
    } catch (e) { return ""; }
  }
  let pageSent = 0;
  function enParas() {   // 没开翻译时：每个带编号的段落的英文原文（给“中文译文 ↔ 英文原文”按句对齐用）
    if (document.documentElement.className.match(/translated-(ltr|rtl)/)) return null;
    const out = {};
    document.querySelectorAll("div[id],p[id],li[id],figcaption[id],figure[id],td[id]").forEach(el => {
      if (el.closest("#rn-pop,#rn-drawer-host")) return;
      const t = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (t.length < 30 || t.length > 4000) return;
      if ([...el.querySelectorAll("div[id],p[id],li[id]")].some(x => !hiddenEl(x))) return;   // 只要最里层的段落（10-09：藏起来的参考文献弹窗不算）
      out[el.id] = t;
    });
    return Object.keys(out).length ? out : null;
  }
  function sendPage() { if (window.top !== window || pageSent > 3) return; pageSent++; call({ type: "pagetext", url: location.href, text: pageText(), paras: enParas() }); }
  // 选中文字所在的整段（给 Claude 当上下文）
  function ctxOf(sel) {
    try {
      let el = sel.getRangeAt(0).commonAncestorContainer; if (el.nodeType !== 1) el = el.parentElement;
      const blk = el.closest("p,li,td,figcaption,blockquote,section,article,div") || el;
      return (blk.innerText || blk.textContent || "").replace(/\s+/g, " ").trim().slice(0, 3000);
    } catch (e) { return ""; }
  }

  // ---------- 记过笔记的地方：小圆标 + 悬浮气泡 ----------
  const kindOf = n => n.color === "q" ? (n.solved ? "solved" : "ask") : "note";
  const KIND = { ask: "❓ 没看懂 · 待解决", solved: "✅ 已解决", note: "📝 笔记" };
  const tagLine = n => (n.tags || []).length ? n.tags.map(t => "🏷 " + t).join(" ") : "未归档";
  function decorate(n) {
    const ms = document.querySelectorAll(`mark.rn-hl[data-id="${n.id}"]`);
    ms.forEach(m => { m.className = "rn-hl"; m.removeAttribute("title"); applyStyle(m, styOf(n)); });
    document.querySelectorAll(`.rn-ico[data-id="${n.id}"]`).forEach(i => i.remove());
    const k = kindOf(n);
    if (ms.length && (n.note || k !== "note" || (n.qa || []).length || LIVE[n.id])) {
      const ico = noTr(document.createElement("span")); ico.className = "rn-ico " + k + (LIVE[n.id] ? " thinking" : ""); ico.dataset.id = n.id;
      ico.textContent = { ask: "?", solved: "✓", note: "✎" }[k];
      ms[ms.length - 1].after(ico);
    }
    drawRail();
  }
  let tip = null, tipT = null;
  const hideTip = () => { clearTimeout(tipT); tip && tip.remove(); tip = null; };
  const hideTipSoon = () => { clearTimeout(tipT); tipT = setTimeout(hideTip, 200); };   // 离开后停一会儿再关，来得及把鼠标移到卡片上
  // 钉住的卡片：不会自动消失；拖顶上那条移动，拖右下角拉伸，✕ 关掉。可以同时钉好几张
  function pinTip(t) {
    const r = t.getBoundingClientRect();
    const p = themed(noTr(document.createElement("div"))); p.className = "rn-pin";
    p.innerHTML = `<div class="pbar"><span>📌 已钉住 · 拖这里移动</span><button class="px" title="关掉">✕</button></div><div class="pbody"></div><div class="pres" title="拖动拉伸"></div>`;
    const body = p.querySelector(".pbody"); [...t.childNodes].forEach(c => body.appendChild(c));
    Object.assign(p.style, { left: r.left + "px", top: Math.max(8, r.top - 30) + "px", width: Math.max(300, r.width) + "px", height: Math.min(innerHeight - 40, r.height + 34) + "px" });
    document.body.appendChild(p); hideTip();
    const drag = (e, fn) => { e.preventDefault(); e.stopPropagation(); const r0 = p.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
      const mv = e2 => fn(r0, e2.clientX - x0, e2.clientY - y0); const up = () => { removeEventListener("pointermove", mv, true); removeEventListener("pointerup", up, true); };
      addEventListener("pointermove", mv, true); addEventListener("pointerup", up, true); };
    p.querySelector(".pbar").addEventListener("pointerdown", e => { if (e.target.closest(".px")) return;
      drag(e, (r0, dx, dy) => { p.style.left = Math.max(0, Math.min(innerWidth - 80, r0.left + dx)) + "px"; p.style.top = Math.max(0, Math.min(innerHeight - 40, r0.top + dy)) + "px"; }); });
    p.querySelector(".pres").addEventListener("pointerdown", e => drag(e, (r0, dx, dy) => { p.style.width = Math.max(240, r0.width + dx) + "px"; p.style.height = Math.max(120, r0.height + dy) + "px"; }));
    p.querySelector(".px").addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); p.remove(); });
    p.addEventListener("pointerdown", e => {
      const o = e.target.closest && e.target.closest("[data-open]"); if (!o) return;
      e.preventDefault(); e.stopPropagation();
      const n = NOTES.find(x => x.id === o.dataset.open), m = n && document.querySelector(`mark.rn-hl[data-id="${n.id}"]`);
      if (n) openEditor(n, m ? m.getBoundingClientRect() : p.getBoundingClientRect());
    });
  }
  function tipKeep(t) {   // 鼠标在卡片上就不关；卡片里点“打开看全部”
    t.addEventListener("mouseenter", () => clearTimeout(tipT));
    t.addEventListener("mouseleave", hideTipSoon);
    t.addEventListener("pointerdown", e => {
      const o = e.target.closest && e.target.closest("[data-open]");
      if (!o) { e.preventDefault(); e.stopPropagation(); pinTip(t); return; }   // 点卡片正文 = 钉住（可拖动、可拉伸）
      e.preventDefault(); e.stopPropagation();
      const n = NOTES.find(x => x.id === o.dataset.open), m = n && document.querySelector(`mark.rn-hl[data-id="${n.id}"]`);
      hideTip(); if (n) openEditor(n, m ? m.getBoundingClientRect() : t.getBoundingClientRect());
    });
  }
  document.addEventListener("mouseover", e => {
    if (e.target.closest && e.target.closest("#rn-tip,.rn-pin")) { clearTimeout(tipT); return; }
    const el = e.target.closest && e.target.closest("mark.rn-hl,.rn-ico,.rn-dot"); if (!el || pop) return;
    const n = NOTES.find(x => x.id === el.dataset.id); if (!n) return;
    if (tip && tip.dataset.for === n.id) { clearTimeout(tipT); return; }
    hideTip(); tip = themed(noTr(document.createElement("div"))); tip.id = "rn-tip"; tip.dataset.for = n.id; tipKeep(tip); tip.dataset.v = VER;
    const body = document.createElement("div"); body.className = "b";
    const qa = n.qa || [];
    if (el.classList.contains("rn-dot")) body.textContent = "“" + n.quote.slice(0, 120) + (n.quote.length > 120 ? "……”" : "”");
    else body.innerHTML =   // 备注在最上面；所有轮次按顺序都显示（每轮最多 900 字，看全文点“打开看全部”）
      (n.note ? `<div class="tn">✎ ${md(n.note)}</div>` : "") +
      qa.map((x, k) => `<div class="tr"><div class="tq">第 ${k + 1} 轮 · 🙋 ${md(x.q.length > 60 ? x.q.slice(0, 60) + "…" : x.q)}</div><div class="ta">${md(x.a.length > 900 ? x.a.slice(0, 900) + "……" : x.a)}</div></div>`).join("") +
      (!n.note && !qa.length ? md(n.color === "q" ? "（没写具体哪里不懂）" : "（还没写备注）") : "");
    const foot = document.createElement("div"); foot.className = "f";
    foot.innerHTML = `${KIND[kindOf(n)]} · ${md(tagLine(n))}${(n.qa || []).length ? ` · 💬 ${n.qa.length} 次问答` : ""} · ${(n.time || "").slice(0, 11)} · 点卡片可钉住 <a class="open" data-open="${n.id}">打开看全部 →</a>`;
    tip.append(body, foot); document.body.appendChild(tip);
    const r = el.getBoundingClientRect(), h = tip.offsetHeight, w = tip.offsetWidth;
    if (el.classList.contains("rn-dot")) { tip.style.top = Math.max(8, Math.min(innerHeight - h - 8, r.top - h / 2)) + "px"; tip.style.left = Math.max(8, r.left - w - 10) + "px"; }
    else { let tp = r.top - h - 8 > 4 ? r.top - h - 8 : r.bottom + 8; tp = Math.max(8, Math.min(innerHeight - h - 8, tp)); tip.style.top = tp + "px"; tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + "px"; }
    { const tt = tip, fit = () => { if (!tt.isConnected) return; const b = tt.getBoundingClientRect(); if (b.bottom > innerHeight - 8) tt.style.top = Math.max(8, innerHeight - b.height - 8) + "px"; };
      new ResizeObserver(fit).observe(tt); setTimeout(fit, 60); setTimeout(fit, 300); }   // 卡片长高后：整张卡都留在窗口里
  }, true);
  document.addEventListener("mouseout", e => { if (e.target.closest && e.target.closest("mark.rn-hl,.rn-ico,.rn-dot")) hideTipSoon(); }, true);

  // ---------- 右边刻度条：整页笔记的位置一眼看到，点一下跳过去 ----------
  let rail = null, railT = null;
  function drawRail() {
    clearTimeout(railT);
    railT = setTimeout(() => {
      if (window.top !== window) return;
      if (!rail) { rail = themed(noTr(document.createElement("div"))); rail.id = "rn-rail"; document.body.appendChild(rail); }
      rail.innerHTML = "";
      const H = Math.max(document.documentElement.scrollHeight, 1);
      NOTES.forEach(n => {
        const m = document.querySelector(`mark.rn-hl[data-id="${n.id}"]`); if (!m) return;
        const y = m.getBoundingClientRect().top + scrollY;
        const d = noTr(document.createElement("span")); d.className = "rn-dot " + kindOf(n); d.dataset.id = n.id;
        d.style.top = `calc(${(y / H * 100).toFixed(3)}% - 4px)`;
        rail.appendChild(d);
      });
      if (SHOW_GUIDE) document.querySelectorAll(".rn-guide").forEach(g => {
        const y = g.getBoundingClientRect().top + scrollY;
        const d = noTr(document.createElement("span")); d.className = "rn-dot guide"; d.dataset.gk = g.dataset.gk; d.title = g.textContent;
        d.style.top = `calc(${(y / H * 100).toFixed(3)}% - 4px)`; rail.appendChild(d);
      });
      TARGETS.forEach(t => {
        const tg = t.card + ":" + t.idx + ":" + (t.j || 0), m = document.querySelector(`mark.rn-tg[data-tg="${tg}"]`) || [...document.querySelectorAll(".rn-tgico.para")].find(i => (i.dataset.tgs || "").split("|").includes(tg)); if (!m) return;
        const y = m.getBoundingClientRect().top + scrollY;
        const d = noTr(document.createElement("span")); d.className = "rn-dot target"; d.dataset.tg = tg;
        d.style.top = `calc(${(y / H * 100).toFixed(3)}% - 5px)`;
        rail.appendChild(d);
      });
      rail.style.display = rail.childElementCount ? "" : "none";
    }, 200);
  }
  window.addEventListener("resize", drawRail);
  window.addEventListener("pointerdown", e => {
    const d = e.target.closest && e.target.closest(".rn-dot"); if (!d) return;
    e.preventDefault(); e.stopPropagation(); hideTip();
    if (d.dataset.gk) { const g = document.querySelector(`.rn-guide[data-gk="${d.dataset.gk}"]`); g && g.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    d.dataset.tg ? gotoTarget(d.dataset.tg) : gotoNote(d.dataset.id);
  }, true);
  function gotoNote(id) {
    const el = document.querySelector(`mark.rn-hl[data-id="${id}"]`);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.animate([{ outline: "3px solid #3b6fd8" }, { outline: "3px solid transparent" }], { duration: 1600 }); }
    return !!el;
  }
  // 10-06：🗺 生成画布用——每条划线在哪一章（最近的上一个大标题）、哪一小节、原文里的先后顺序
  function noteSections() {
    const skip = "nav,.ltx_TOC,.ltx_page_header,header,footer,[class*='rn-'],.immersive-translate-target-wrapper";
    const heads = [...document.querySelectorAll("h1,h2,h3,h4")].filter(h => !h.closest(skip) && h.textContent.trim());
    const lv = h => +h.tagName[1];
    // 章节用页面里出现过的“第二级”标题（多数论文是 h2；整页只有一个 h1 当题目时跳过它）
    const levels = [...new Set(heads.map(lv))].sort();
    const top = levels.length > 1 && heads.filter(h => lv(h) === levels[0]).length === 1 ? levels[1] : levels[0];
    const txt = h => { const c = h.cloneNode(true); c.querySelectorAll(".immersive-translate-target-wrapper").forEach(x => x.remove()); return norm(c.textContent); };
    const zh = h => norm([...h.querySelectorAll(".immersive-translate-target-wrapper")].map(x => x.textContent).join(" "));
    const out = {};
    const marks = [...document.querySelectorAll("mark.rn-hl[data-id]")];
    NOTES.forEach(n => {
      const m = marks.find(x => x.dataset.id === n.id); if (!m) return;
      let sec = null, sub = null;
      for (const h of heads) {
        if (!(h.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
        if (lv(h) <= top) { sec = h; sub = null; } else sub = h;
      }
      out[n.id] = { h: sec ? txt(sec) : "正文", zh: sec ? zh(sec) : "", sub: sub ? txt(sub) : "", order: marks.indexOf(m) };
    });
    return out;
  }
  window.__rnSections = noteSections; window.__rnGoto = gotoNote;   // 给下面的 🗺 画布面板用
  // 10-06：🌐 对照翻译（我们自己的，Chrome 和 Obsidian 都能用）：只翻正文段落，表格 / 图注 / 公式不碰；滚到哪翻到哪；翻过的本机服务记着
  const TR = { on: false, io: null, q: [], busy: false };
  const TR_SKIP = "table,figure,figcaption,nav,header,footer,pre,code,math,.ltx_equation,.ltx_TOC,.ltx_bibliography,.ltx_page_header,[class*='rn-'],.immersive-translate-target-wrapper,#rn-drawer-host";
  function trParas() {
    return [...document.querySelectorAll("p,li,dd,blockquote")].filter(el => {
      if (el.closest(TR_SKIP) || el.dataset.rnTr) return false;
      if (el.querySelector("p,li,dd,blockquote")) return false;   // 只要最里层的段落
      if (el.querySelector(".immersive-translate-target-wrapper")) return false;   // 沉浸式翻译已经翻过的（快照里常见）不再翻
      const t = norm(el.innerText || ""); if (t.length < 40) return false;
      const lat = (t.match(/[A-Za-z]/g) || []).length; return lat / t.length > 0.5;   // 本来就是中文的不翻
    });
  }
  async function trPump() {
    if (TR.busy || !TR.q.length) return; TR.busy = true;
    const batch = TR.q.splice(0, 8);
    const r = await call({ type: "translate", texts: batch.map(el => norm(el.innerText)) });
    if (r.err && !TR.warned) { TR.warned = true; toast("⚠️ " + r.err); }
    (r.out || []).forEach((zh, i) => {
      const el = batch[i]; if (!zh || !el.isConnected) { el && delete el.dataset.rnTr; return; }
      const d = noTr(document.createElement("div")); d.className = "rn-tr notranslate"; d.textContent = zh;
      if (el.tagName === "LI" || el.tagName === "DD") el.appendChild(d); else el.after(d);
    });
    TR.busy = false; trPump();
  }
  function trSet(on) {
    TR.on = on; document.documentElement.classList.toggle("rn-tr-off", !on);
    try { chrome.storage.local.set({ rnTrOn: on }); } catch (e) {}
    window.dispatchEvent(new CustomEvent("rn-tr-state", { detail: on }));
    if (!on) return;
    if (!TR.io) TR.io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && !e.target.dataset.rnTr) { e.target.dataset.rnTr = 1; TR.q.push(e.target); TR.io.unobserve(e.target); } }) || trPump(), { rootMargin: "600px 0px" });
    trParas().forEach(el => TR.io.observe(el));
    setTimeout(trPump, 300);
  }
  window.addEventListener("rn-tr-toggle", () => trSet(!TR.on));
  try { chrome.storage.local.get("rnTrOn").then(v => { if (v && v.rnTrOn) setTimeout(() => trSet(true), 2500); }); } catch (e) {}
  // 10-06：画布卡片上“📍 回到原文”的网址带 #rn-goto=笔记id，打开后自动滚到这句
  function gotoFromHash() {
    const g = (location.hash.match(/rn-goto=([\w-]+)/) || [])[1];
    if (g && gotoNote(g)) { history.replaceState(null, "", location.href.split("#")[0]); call({ type: "jump_done" }); }
  }
  // 10-09：情绪实验地图卡片的网址带 #rn-find=原文句子，打开后滚到这句并黄底闪一下（不需要事先划过线）
  function findFromHash() {
    const g = (location.hash.match(/rn-find=([^&:]+)/) || [])[1]; if (!g) return false;   // 后面的 :~:text= 是 Chrome 文字片段，不要
    const want = norm(decodeURIComponent(g)).toLowerCase(), { s, map } = textIndex(), low = s.toLowerCase();
    let at = low.indexOf(want), len = want.length;
    if (at < 0) { const w = want.split(" ").slice(0, 6).join(" "); at = low.indexOf(w); len = w.length; }   // 整句对不上（引号、破折号不同）就用开头几个词
    if (at < 0 || !map[at] || !map[at + len - 1]) return false;
    const r = document.createRange(); r.setStart(map[at][0], map[at][1]); r.setEnd(map[at + len - 1][0], map[at + len - 1][1] + 1);
    const el = map[at][0].parentElement; el.scrollIntoView({ block: "center", behavior: "smooth" });
    try { CSS.highlights.set("rn-find", new Highlight(r)); setTimeout(() => CSS.highlights.delete("rn-find"), 12000); } catch (e) {}
    if (!document.getElementById("rn-find-css")) { const st = document.createElement("style"); st.id = "rn-find-css"; st.textContent = "::highlight(rn-find){background:#ffe36e;color:inherit}"; document.head.appendChild(st); }
    history.replaceState(null, "", location.href.split("#")[0]); call({ type: "jump_done" }); return true;
  }
  // 10-09：网页转址把 #rn-goto / #rn-find 弄丢了（Cell 全文页转摘要页、doi.org 跳出版社、登录后才进全文页）→ 去本机服务取回来再跳
  async function pendingJump() {
    if (window.top !== window || /rn-(goto|find)=/.test(location.hash)) return;
    const m = document.querySelector('meta[name="citation_doi"], meta[name="dc.identifier"], meta[name="DC.Identifier"], meta[name="prism.doi"]');
    const r = await call({ type: "jump_take", url: location.href, doi: m ? m.content.replace(/^doi:/i, "") : "" });
    if (!r || !r.hash) return;
    history.replaceState(null, "", location.href.split("#")[0] + r.hash);
    const f = /rn-find=/.test(r.hash) ? findFromHash : gotoFromHash;
    [1500, 4000, 8000, 12000].forEach(t => setTimeout(() => /rn-(goto|find)=/.test(location.hash) && f(), t));
  }
  // 定位链接：对方用 Chrome 打开会直接滚到这句并高亮（不用装插件）
  function fragLink(n) {
    const t = norm(n.en || n.quote || ""); const w = t.split(" ");
    const enc = x => encodeURIComponent(x).replace(/-/g, "%2D").replace(/,/g, "%2C");
    const frag = w.length > 12 ? enc(w.slice(0, 5).join(" ")) + "," + enc(w.slice(-5).join(" ")) : enc(t);
    return location.href.split("#")[0] + "#:~:text=" + frag;
  }

  // ---------- 🎯 答题卡的答案位置（只有提交批改后才标出来）----------
  let TARGETS = [];
  const VS = { ok: "✅ 答对了", part: "⚠️ 部分对", no: "❌ 不对" };
  async function loadTargets() {
    if (window.top !== window) return;
    const r = await call({ type: "targets", url: location.href });
    if (!Array.isArray(r.targets)) return;
    TARGETS = r.targets; TARGETS.forEach(markTarget);
    GUIDE = r.guide || []; drawGuide(); drawRail();
  }
  // 📍 读前导航：在“最该看的段落”前面放一个小标签（可以在抽屉顶上关掉）
  let GUIDE = [], SHOW_GUIDE = true;
  try { chrome.storage.local.get("rnGuide").then(v => { SHOW_GUIDE = v.rnGuide !== false; drawGuide(); drawRail(); }); } catch (e) {}
  try { chrome.storage.onChanged.addListener(c => { if (c.rnGuide) { SHOW_GUIDE = c.rnGuide.newValue !== false; drawGuide(); drawRail(); } }); } catch (e) {}
  function drawGuide() {
    document.querySelectorAll(".rn-guide").forEach(x => x.remove());
    if (!SHOW_GUIDE) return;
    GUIDE.forEach((g, k) => {
      const el = document.getElementById(g.el); if (!el) return;
      const tag = noTr(document.createElement("span")); tag.className = "rn-guide"; tag.dataset.gk = k;
      tag.textContent = `📍 ${g.task} · ${g.why}`;
      el.insertBefore(tag, el.firstChild);
    });
  }
  function markTarget(t) {
    const tg = t.card + ":" + t.idx + ":" + (t.j || 0);
    if (document.querySelector(`mark.rn-tg[data-tg="${tg}"]`) || [...document.querySelectorAll(".rn-tgico.para")].some(i => (i.dataset.tgs || "").split("|").includes(tg))) return true;
    const root = (t.el && document.getElementById(t.el)) || document.body;
    const { s, map } = textIndex(root); const q = norm(t.key || "");
    let at = s.indexOf(q), len = q.length;
    if (at < 0) {   // 开着翻译找不到原句：不整段包起来，只在这一段开头放一个 🎯（几道题共用一个）
      if (root === document.body || !s.length) return false;
      let ico = root.querySelector(":scope > .rn-tgico.para") || null;
      if (!ico) { ico = noTr(document.createElement("span")); ico.className = "rn-tgico para"; ico.textContent = "🎯"; ico.dataset.tgs = ""; root.insertBefore(ico, root.firstChild); }
      const list = ico.dataset.tgs ? ico.dataset.tgs.split("|") : [];
      if (!list.includes(tg)) list.push(tg);
      ico.dataset.tgs = list.join("|"); ico.dataset.tg = list[0];
      if (list.length > 1) ico.dataset.n = list.length;
      return true;
    }
    const approx = false;
    const parts = []; let cur = null;
    for (let k = at; k < at + len && k < map.length; k++) {
      const [node, off] = map[k];
      if (!cur || cur.node !== node) { cur = { node, start: off, end: off + 1 }; parts.push(cur); } else cur.end = off + 1;
    }
    let last = null;
    for (const p of parts.reverse()) {
      try {
        const r = document.createRange(); r.setStart(p.node, p.start); r.setEnd(p.node, p.end);
        const m = document.createElement("mark"); m.className = "rn-tg"; m.dataset.tg = tg; if (approx) m.dataset.approx = "1";
        r.surroundContents(m); if (!last) last = m;
      } catch (e) {}
    }
    const ms = document.querySelectorAll(`mark.rn-tg[data-tg="${tg}"]`);
    if (ms.length) {   // 平时只在句首放一个 🎯，不整段上色；鼠标放到 🎯 上才临时高亮这句
      const ico = noTr(document.createElement("span")); ico.className = "rn-tgico"; ico.dataset.tg = tg; ico.textContent = "🎯";
      ms[0].before(ico);
      ico.addEventListener("mouseenter", () => ms.forEach(m => m.classList.add("show")));
      ico.addEventListener("mouseleave", () => ms.forEach(m => m.classList.remove("show")));
    }
    return !!last;
  }
  function gotoTarget(tg) {
    const el = document.querySelector(`mark.rn-tg[data-tg="${tg}"]`) || [...document.querySelectorAll(".rn-tgico.para")].find(i => (i.dataset.tgs || "").split("|").includes(tg));
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (el.classList.contains("para")) { const p = el.parentElement; p.animate([{ boxShadow: "0 0 0 3px rgba(58,155,98,.5)" }, { boxShadow: "0 0 0 3px rgba(58,155,98,0)" }], { duration: 2400 }); return true; }
      const ms = document.querySelectorAll(`mark.rn-tg[data-tg="${tg}"]`);
      ms.forEach(m => m.classList.add("show")); setTimeout(() => ms.forEach(m => m.classList.remove("show")), 2600);   // 跳过去时亮一下再淡掉
    }
    return !!el;
  }
  document.addEventListener("mouseover", e => {
    const el = e.target.closest && e.target.closest(".rn-tgico,.rn-dot.target"); if (!el || pop) return;
    const tgs = el.dataset.tgs ? el.dataset.tgs.split("|") : [el.dataset.tg];
    const ts = tgs.map(g => TARGETS.find(x => x.card + ":" + x.idx + ":" + (x.j || 0) === g)).filter(Boolean);
    const t = ts[0]; if (!t) return;
    hideTip(); tip = themed(noTr(document.createElement("div"))); tip.id = "rn-tip"; tipKeep(tip);
    const body = document.createElement("div"); body.className = "b"; body.textContent = ts.length > 1
      ? "🎯 这一段和答题卡这几道题有关：\n" + [...new Set(ts.map(x => x.q))].join("\n") + "\n（开着翻译找不到英文原句，只能标到段落）"
      : "🎯 答题卡这道题的答案相关：\n" + t.q + (t.why ? "\n（" + t.why + "）" : "");
    const foot = document.createElement("div"); foot.className = "f"; foot.textContent = `你的批改：${VS[t.v] || ""}${el.matches("mark[data-approx]") ? " · 开着翻译，只能标出整段" : ""}`;
    tip.append(body, foot); document.body.appendChild(tip);
    const r = el.getBoundingClientRect(), h = tip.offsetHeight, w = tip.offsetWidth;
    if (el.classList.contains("rn-dot")) { tip.style.top = Math.max(8, Math.min(innerHeight - h - 8, r.top - h / 2)) + "px"; tip.style.left = Math.max(8, r.left - w - 10) + "px"; }
    else { let tp = r.top - h - 8 > 4 ? r.top - h - 8 : r.bottom + 8; tp = Math.max(8, Math.min(innerHeight - h - 8, tp)); tip.style.top = tp + "px"; tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + "px"; }
    { const tt = tip, fit = () => { if (!tt.isConnected) return; const b = tt.getBoundingClientRect(); if (b.bottom > innerHeight - 8) tt.style.top = Math.max(8, innerHeight - b.height - 8) + "px"; };
      new ResizeObserver(fit).observe(tt); setTimeout(fit, 60); setTimeout(fit, 300); }   // 卡片长高后：整张卡都留在窗口里
  }, true);
  document.addEventListener("mouseout", e => { if (e.target.closest && e.target.closest(".rn-tgico,.rn-dot.target")) hideTipSoon(); }, true);

  // ---------- 点划线 / 图标 → 编辑框 ----------
  window.addEventListener("scroll", () => { kill(); if (!(tip && tip.matches(":hover"))) hideTip(); }, { passive: true });
  window.addEventListener("pointerdown", e => {
    if (pop || !(e.target.closest && e.target.closest(".rn-ico"))) return;
    const m = e.target.closest(".rn-ico"); const n = NOTES.find(x => x.id === m.dataset.id);
    if (n) { e.preventDefault(); hideTip(); openEditor(n, m.getBoundingClientRect()); }
  }, true);
  let downAt = null;
  window.addEventListener("pointerdown", e => { downAt = { x: e.clientX, y: e.clientY, t: e.target }; }, true);
  window.addEventListener("pointerup", e => {
    const d = downAt; downAt = null; if (!d || pop) return;
    const m = e.target.closest && e.target.closest("mark.rn-hl"); if (!m || !(d.t.closest && d.t.closest("mark.rn-hl"))) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) return;
    setTimeout(() => {
      const sel = window.getSelection(); if (sel && !sel.isCollapsed && sel.toString().trim().length > 1) return;
      const n = NOTES.find(x => x.id === m.dataset.id); if (n) { hideTip(); kill(); openEditor(n, m.getBoundingClientRect()); }
    }, 20);
  }, true);
  // 在编辑框里按下鼠标（比如拖着选字），在框外松开：不算“点了外面”，别把框关掉
  let downInPop = false;
  window.addEventListener("pointerdown", e => { downInPop = !!(pop && e.composedPath().includes(pop)); }, true);
  window.addEventListener("click", e => {
    if (downInPop) { downInPop = false; return; }
    if (Date.now() - popAt < 500 || !e.target.isConnected || (e.target.closest && e.target.closest("#rn-bar,#rn-pop,#rn-rail"))) return;
    if (e.target.closest && e.target.closest("mark.rn-hl,.rn-ico")) return;
    killPop();
  }, true);

  const MODEL_OPTS = [["sonnet", "Sonnet 5.5 · 快"], ["opus", "Opus 5.5 · 最强"], ["haiku", "Haiku 4.5 · 最快"]];
  const EFF_OPTS = [["low", "低"], ["medium", "中"], ["high", "高"], ["xhigh", "很高"], ["max", "最高"]];
  const CTX_OPTS = [["auto", "上下文：自动"], ["full", "上下文：全文（最准）"], ["rel", "上下文：相关片段（省）"]];
  function openEditor(n, rect, autoAsk, focusAsk) {
    killPop(); popAt = Date.now(); pop = themed(noTr(document.createElement("div"))); pop.id = "rn-pop";
    const me = pop, cur = styOf(n);
    const kind = () => n.isNew ? (n.color === "q" ? "新笔记 · ❓ 没看懂" : "新笔记") : KIND[kindOf(n)];
    n.tags = n.tags || [];
    pop.innerHTML = `
      <div class="hd"><span class="kind"></span><span class="tm">${n.isNew ? "" : (n.time || "").slice(0, 11)}</span><button data-a="sty" title="颜色 / 样式 / 粗细">🎨</button><button data-a="cancel" title="关闭（Esc）">✕</button></div>
      <div class="mid">
      <div class="q"></div>
      <div class="sty" hidden>
        <div class="r"><span class="lab">颜色</span>${Object.keys(PAL).map(c => `<button data-sc="${c}" class="sw" title="${PAL_NAME[c]}" style="background:rgb(${PAL[c]}) !important"></button>`).join("")}</div>
        <div class="r"><span class="lab">样式</span><button data-st="hl">高亮</button><button data-st="ul">下划线</button><button data-st="wave">波浪线</button><button data-st="box">方框</button></div>
        <div class="r"><span class="lab">粗细</span><button data-sw="1">细</button><button data-sw="2">中</button><button data-sw="3">粗</button><span class="prev">示例文字</span></div>
      </div>
      ${n.isNew ? "" : `<div class="sec">💬 和 Claude 的对话<span class="cnt"></span></div><div class="qa"></div>
      <div class="askrow"><textarea class="askbox" placeholder="问 Claude，比如：这句话什么意思？（⌘+回车 发送）"></textarea>
        <div class="askbar"><select class="model">${MODEL_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select><select class="effort" title="思考强度：越高越慢、越耗额度">${EFF_OPTS.map(([v, l]) => `<option value="${v}">强度 ${l}</option>`).join("")}</select><select class="ctxm" title="自动 = 平时只发相关片段，点“一键解释”时发全文；要严谨就选全文">${CTX_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select><button data-a="explain" title="不用打字：让 Claude 结合上下文把这段讲清楚">✨ 一键解释</button><button data-a="ask" class="pri">发送</button></div></div>`}
      <div class="sec">✎ 我的备注</div>
      <textarea class="mine" placeholder="${n.color === "q" ? "哪里没看懂？写个关键词就行，可以不写" : "写下你的想法…（⌘+回车 保存）"}"></textarea>
      <div class="sec">🏷 标签</div><div class="tagrow"></div>
      <div class="chips"></div>
      </div>
      <div class="ft">${n.isNew ? "" : `<button data-a="del" class="danger">🗑 删除</button>`}<span class="sp"></span><button data-a="cancel">取消</button>${n.isNew ? `<button data-a="saveask">保存并问 Claude</button>` : ""}<button data-a="save" class="pri">保存</button></div>`;
    pop.querySelector(".q").textContent = "“" + n.quote.slice(0, 400) + (n.quote.length > 400 ? "……" : "") + "”";
    const ta = pop.querySelector("textarea.mine"); ta.value = n.note || "";
    const qaBox = pop.querySelector(".qa"), askBox = pop.querySelector(".askbox"), modelSel = pop.querySelector(".model"), effSel = pop.querySelector(".effort"), ctxSel = pop.querySelector(".ctxm");
    if (modelSel) try { chrome.storage.local.get(["rnModel", "rnEffort", "rnCtx"]).then(v => { if (v.rnModel) modelSel.value = v.rnModel; effSel.value = v.rnEffort || "medium"; ctxSel.value = v.rnCtx || "auto"; }); } catch (e) {}
    if (ctxSel) ctxSel.addEventListener("change", () => { try { chrome.storage.local.set({ rnCtx: ctxSel.value }); } catch (e) {} });
    if (effSel) effSel.addEventListener("change", () => { try { chrome.storage.local.set({ rnEffort: effSel.value }); } catch (e) {} });
    const drawHead = () => {
      pop.querySelector(".kind").textContent = kind();
      pop.querySelector(".chips").innerHTML =
        `<button data-a="qflag" class="${n.color === "q" ? "on ask" : ""}">❓ 没看懂</button>` +
        (n.color === "q" ? `<button data-a="solve" class="${n.solved ? "on solved" : ""}">✅ 已解决</button>` : "") +

        (n.isNew ? "" : `<button data-a="link" title="复制后发给别人：用 Chrome 打开会直接跳到这句并高亮">🔗 复制定位链接</button>`);
    };
    // 标签：点已有的标签加上 / 去掉，或者输入新标签回车；一个都没有 = 未归档
    let ALLTAGS = [];
    const drawTags = () => {
      const row = pop.querySelector(".tagrow"); if (!row) return;
      const others = ALLTAGS.filter(t => !n.tags.includes(t)).slice(0, 12);
      row.innerHTML = (n.tags.length ? n.tags.map(t => `<button class="tag on" data-tag="${md(t)}">🏷 ${md(t)} ×</button>`).join("") : `<span class="none">未归档</span>`) +
        others.map(t => `<button class="tag" data-tag="${md(t)}">+ ${md(t)}</button>`).join("") +
        `<input class="newtag" placeholder="新标签，回车添加" maxlength="20">`;
      const inp = row.querySelector(".newtag");
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const v = inp.value.trim(); if (v) setTags([...n.tags, v]); } });
    };
    const setTags = async (tags) => {
      n.tags = [...new Set(tags.map(t => t.trim()).filter(Boolean))].slice(0, 8);
      if (!ALLTAGS.includes(n.tags[n.tags.length - 1])) ALLTAGS.push(...n.tags.filter(t => !ALLTAGS.includes(t)));
      drawTags();
      if (!n.isNew) { await call({ type: "update", url: location.href, id: n.id, tags: n.tags }); sync(); decorate(n); }
    };
    call({ type: "tags" }).then(r => { ALLTAGS = (r.tags || []).map(x => x[0]); drawTags(); });
    const drawQA = (live) => {
      if (!qaBox) return;
      qaBox.innerHTML = "";
      const rounds = (n.qa || []).length + (live ? 1 : 0);
      const cnt = pop.querySelector(".sec .cnt"); if (cnt) cnt.textContent = rounds ? `（${rounds} 轮）` : "";
      (n.qa || []).forEach((x, k) => {
        const box = document.createElement("div"); box.className = "round";
        box.innerHTML = `<div class="rh">第 ${k + 1} 轮 · ${md(x.model || "Sonnet 5.5")} · ${md((x.time || "").slice(0, 11))}</div>`;
        const q = document.createElement("div"); q.className = "q1"; q.textContent = x.q;
        const a = document.createElement("div"); a.className = "a1"; a.innerHTML = md(x.a);
        box.append(q, a); qaBox.append(box);
      });
      if (live) {
        const box = document.createElement("div"); box.className = "round live"; qaBox.append(box);
        box.innerHTML = `<div class="rh">第 ${rounds} 轮 · 正在回答</div>`;
        const q = document.createElement("div"); q.className = "q1"; q.textContent = live.q;
        const a = document.createElement("div"); a.className = "a1 live";
        a.innerHTML = `<div class="who">🤖 ${md(live.model)} · ${live.secs || 0} 秒${live.err ? "" : live.text ? " · 正在写" : " · 正在读这段"}<span class="dots"><i></i><i></i><i></i></span></div>`
          + (live.err ? `<div class="err">⚠️ ${md(live.err)}</div>` : md(live.text) + (live.text ? '<span class="caret"></span>' : ""));
        box.append(q, a);
      }
      qaBox.style.display = (n.qa && n.qa.length) || live ? "block" : "none";
      qaBox.scrollTop = qaBox.scrollHeight;
    };
    drawHead(); drawQA();
    pop.dataset.nid = n.id || ""; pop._drawQA = (live) => drawQA(live);
    const live_n = () => NOTES.find(x => x.id === n.id) || n;
    if (n.id && LIVE[n.id]) drawQA(LIVE[n.id]);
    const prev = pop.querySelector(".prev");
    const paint = () => {
      pop.querySelectorAll("[data-sc]").forEach(b => b.classList.toggle("on", b.dataset.sc === cur.c));
      pop.querySelectorAll("[data-st]").forEach(b => b.classList.toggle("on", b.dataset.st === cur.t));
      pop.querySelectorAll("[data-sw]").forEach(b => b.classList.toggle("on", +b.dataset.sw === cur.w));
      applyStyle(prev, cur);
      if (!n.isNew) document.querySelectorAll(`mark.rn-hl[data-id="${n.id}"]`).forEach(m => applyStyle(m, cur));
    };
    document.body.appendChild(pop);
    try { chrome.storage.local.get("rnPopSize").then(v => { const z = v.rnPopSize; if (z && pop === me) { pop.style.width = Math.min(z.w, innerWidth - 16) + "px"; pop.style.height = Math.min(z.h, innerHeight - 16) + "px"; pop.style.maxHeight = "none"; place(); } }); } catch (e) {}
    let szT = null;   // 右下角拉伸后记住大小
    new ResizeObserver(() => { if (!me.isConnected || (!me.style.height && !me.style.width)) return; clearTimeout(szT); szT = setTimeout(() => { try { chrome.storage.local.set({ rnPopSize: { w: me.offsetWidth, h: me.offsetHeight } }); } catch (e) {} }, 400); }).observe(pop);
    ["l", "r", "b", "br", "bl"].forEach(k => { const h = document.createElement("div"); h.className = "rs rs-" + k; h.dataset.rs = k; pop.appendChild(h); });
    pop.addEventListener("pointerdown", ev => {   // 拖左 / 右 / 下边或角：改大小
      const h = ev.target.closest && ev.target.closest(".rs"); if (!h) return;
      ev.preventDefault(); ev.stopPropagation();
      const k = h.dataset.rs, r0 = pop.getBoundingClientRect(), x0 = ev.clientX, y0 = ev.clientY;
      const mv = e2 => {
        const dx = e2.clientX - x0, dy = e2.clientY - y0;
        if (k.includes("r")) pop.style.width = Math.max(320, Math.min(innerWidth - r0.left - 8, r0.width + dx)) + "px";
        if (k.includes("l")) { const w = Math.max(320, r0.width - dx); pop.style.width = w + "px"; pop.style.left = (r0.right - w) + "px"; }
        if (k.includes("b")) pop.style.height = Math.max(240, Math.min(innerHeight - r0.top - 8, r0.height + dy)) + "px";
        pop.style.maxHeight = "none";
      };
      const up = () => { removeEventListener("pointermove", mv, true); removeEventListener("pointerup", up, true); try { chrome.storage.local.set({ rnPopSize: { w: pop.offsetWidth, h: pop.offsetHeight } }); } catch (e) {} };
      addEventListener("pointermove", mv, true); addEventListener("pointerup", up, true);
    }, true);
    pop.querySelector(".hd").addEventListener("pointerdown", ev => {   // 按住标题栏拖动
      if (ev.target.closest("button")) return;
      ev.preventDefault(); const r0 = pop.getBoundingClientRect(), x0 = ev.clientX, y0 = ev.clientY;
      const mv = e2 => { pop.style.left = Math.max(0, Math.min(innerWidth - 80, r0.left + e2.clientX - x0)) + "px"; pop.style.top = Math.max(0, Math.min(innerHeight - 40, r0.top + e2.clientY - y0)) + "px"; };
      const up = () => { removeEventListener("pointermove", mv, true); removeEventListener("pointerup", up, true); };
      addEventListener("pointermove", mv, true); addEventListener("pointerup", up, true);
    });
    const place = () => {
      pop.style.top = Math.max(8, Math.min(innerHeight - pop.offsetHeight - 8, rect.bottom + 8)) + "px";
      pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 24, rect.left)) + "px";
    };
    place();
    setTimeout(() => { (askBox && (focusAsk || ((n.qa || []).length === 0 && n.color === "q")) ? askBox : ta).focus({ preventScroll: true }); const mid = pop && pop.querySelector(".mid"); if (mid && !focusAsk) mid.scrollTop = 0; }, 0);
    ["keydown", "keyup", "keypress", "input"].forEach(t => pop.addEventListener(t, ev => ev.stopPropagation()));
    pop.addEventListener("keydown", ev => {
      if (ev.key === "Escape") killPop();
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); act(ev.target === askBox ? "ask" : "save"); }
    });
    if (modelSel) modelSel.addEventListener("change", () => { try { chrome.storage.local.set({ rnModel: modelSel.value }); } catch (e) {} });
    pop.addEventListener("pointerdown", ev => {
      const b = ev.target.closest && ev.target.closest("button"); if (!b) return;
      ev.preventDefault(); ev.stopPropagation();
      if (b.dataset.tag !== undefined) { const t = b.dataset.tag; setTags(n.tags.includes(t) ? n.tags.filter(x => x !== t) : [...n.tags, t]); return; }
      if (b.dataset.sc || b.dataset.st || b.dataset.sw) {
        if (b.dataset.sc) cur.c = b.dataset.sc; if (b.dataset.st) cur.t = b.dataset.st; if (b.dataset.sw) cur.w = +b.dataset.sw;
        paint(); try { chrome.storage.local.set({ lastSty: cur }); } catch (e) {}
        if (!n.isNew) { n.sty = { ...cur }; call({ type: "update", url: location.href, id: n.id, sty: n.sty }); }
        return;
      }
      act(b.dataset.a);
    }, true);
    paint();
    if (autoAsk && askBox) { askBox.value = autoAsk; setTimeout(() => act("ask"), 50); }
    pop.addEventListener("mousedown", ev => ev.stopPropagation());
    // 在编辑框里按住鼠标选字时，外面的网页不许跟着滚
    let lockY = null;
    const holdPage = () => { if (lockY !== null && Math.abs(scrollY - lockY) > 1) scrollTo(scrollX, lockY); };
    pop.addEventListener("pointerdown", () => { lockY = scrollY; }, true);
    const unlock = () => { lockY = null; };
    addEventListener("pointerup", unlock, true); addEventListener("scroll", holdPage, { passive: true });
    const sync = () => { const live = NOTES.find(x => x.id === n.id); if (live && live !== n) Object.assign(live, n); };
    async function act(a) {
      const text = ta.value;
      if (a === "cancel") { killPop(); return; }
      if (a === "sty") { const p = pop.querySelector(".sty"); p.hidden = !p.hidden; place(); return; }
      if (n.isNew && (a === "qflag" || a === "solve")) {   // 新笔记：只改将要保存的状态
        if (a === "qflag") n.color = n.color === "q" ? "n" : "q";
        drawHead(); return;
      }
      if (a === "saveask") {
        const note = await save({ quote: n.quote, color: n.color, tags: n.tags, note: text, sty: { ...cur }, ctx: n.ctx, anchor: n.anchor, prefix: n.prefix, suffix: n.suffix, occ: n.occ });
        window.getSelection().removeAllRanges();
        if (note) { const m = document.querySelector(`mark.rn-hl[data-id="${note.id}"]`); openEditor(note, m ? m.getBoundingClientRect() : rect, text || "这段话是什么意思？请解释给我听。"); }
        else { killPop(); toast("⚠️ 没存上：连不上本机服务"); }
        return;
      }
      let explain = false;
      if (a === "explain") { explain = true; askBox.value = "请结合整篇论文的上下文，用中文把我划的这段讲清楚：①它在说什么（大白话）；②里面的关键术语 / 缩写是什么意思、在论文哪里定义的；③它在整篇论文的论证里起什么作用。"; a = "ask"; }
      if (a === "ask") {
        const qtext = (askBox.value || "").trim() || "这段话是什么意思？请解释给我听。";
        const model = modelSel ? modelSel.value : "sonnet", effort = effSel ? effSel.value : "medium";
        const cm = ctxSel ? ctxSel.value : "auto", useFull = cm === "full" || (cm === "auto" && explain);
        const label = (MODEL_OPTS.find(m => m[0] === model) || ["", model])[1].split(" · ")[0] + " · " + (EFF_OPTS.find(x => x[0] === effort) || ["", ""])[1] + (useFull ? " · 全文" : " · 相关片段");
        if (LIVE[n.id]) { toast("这条还在等 Claude 回答，等它答完再问下一句"); return; }
        askBox.value = "";
        drawQA({ q: qtext, model: label, text: "", secs: 0 });
        startAsk(live_n(), qtext, model, effort, ctxSel ? ctxSel.value : "auto", explain, label);   // 交给后台，关掉这个框也照常进行
        return;
      }
      if (a === "link") {
        try { await navigator.clipboard.writeText(fragLink(n)); toast("🔗 已复制。对方用 Chrome 打开会直接跳到这句并高亮"); }
        catch (e) { prompt("复制这个链接：", fragLink(n)); }
        return;
      }
      if (n.isNew) {
        if (a === "save") { const note = await save({ quote: n.quote, color: n.color, tags: n.tags, note: text, sty: { ...cur }, ctx: n.ctx, anchor: n.anchor, prefix: n.prefix, suffix: n.suffix, occ: n.occ }); if (!note) toast("⚠️ 没存上：连不上本机服务"); }
        killPop(); window.getSelection().removeAllRanges(); return;
      }
      if (a === "save") { n.note = text; await call({ type: "update", url: location.href, id: n.id, note: text }); }
      if (a === "qflag" || a === "solve") {
        if (a === "qflag") { n.color = n.color === "q" ? "n" : "q"; n.solved = false; await call({ type: "update", url: location.href, id: n.id, color: n.color, solved: false }); }
        if (a === "solve") { n.solved = !n.solved; await call({ type: "update", url: location.href, id: n.id, solved: n.solved }); }
        if (text !== (n.note || "")) { n.note = text; call({ type: "update", url: location.href, id: n.id, note: text }); }
        decorate(n); sync(); drawHead(); return;   // 改状态不关框
      }
      if (a === "del") {
        if (!confirm("删除这条笔记？（问答记录也会一起删掉）")) return;
        await call({ type: "update", url: location.href, id: n.id, delete: true }); NOTES = NOTES.filter(x => x.id !== n.id);
        document.querySelectorAll(`mark.rn-hl[data-id="${n.id}"]`).forEach(m => m.replaceWith(...m.childNodes));
        document.querySelectorAll(`.rn-ico[data-id="${n.id}"]`).forEach(i => i.remove());
        drawRail();
      } else decorate(n);
      sync(); killPop();
    }
  }

  // 侧边栏点“跳到这条” → 滚过去
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (m.type === "sections") { if (window.top === window) reply({ secs: noteSections() }); }
    if (m.type === "goto") { const ok = gotoNote(m.id); if (window.top === window) reply({ found: ok }); }
    if (m.type === "find_text") {
      const want = norm(m.text || "").toLowerCase(); let ok = false, viaPara = false;
      for (const root of [m.el && document.getElementById(m.el), document.body].filter(Boolean)) {
        const { s, map } = textIndex(root); const at = s.toLowerCase().indexOf(want);
        if (at < 0 || !want) continue;
        try {
          const [n1, o1] = map[at], [n2, o2] = map[Math.min(at + want.length - 1, map.length - 1)];
          const r = document.createRange(); r.setStart(n1, o1); r.setEnd(n2, o2 + 1);
          const box = r.getBoundingClientRect(); scrollBy({ top: box.top - innerHeight / 2, behavior: "smooth" });
          setTimeout(() => {
            const b = r.getBoundingClientRect(), f = noTr(document.createElement("div")); f.className = "rn-flash";
            Object.assign(f.style, { left: b.left - 3 + "px", top: b.top - 3 + "px", width: b.width + 6 + "px", height: b.height + 6 + "px" });
            document.body.appendChild(f); setTimeout(() => f.remove(), 2600);
          }, 450);
          ok = true;
        } catch (e) {}
        break;
      }
      if (!ok && want && isTr()) {   // 10-05：开着翻译找不到英文原句 → 用网页还是英文时记下的“每段英文”找到是第几段，带到那一段
        const el = paraFind(want);
        if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => flashEl(el), 450); ok = true; viaPara = true; }
      }
      if (!ok && m.el) { const el = document.getElementById(m.el); if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(() => flashEl(el), 450); ok = true; viaPara = true; } }
      if (window.top === window) reply({ found: ok, para: viaPara });
    }
    if (m.type === "goto_el") {   // 📍 去这段读：只跳到段落，不剧透是哪一句
      const el = m.el && document.getElementById(m.el);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.animate([{ boxShadow: "0 0 0 3px rgba(59,111,216,.55)" }, { boxShadow: "0 0 0 3px rgba(59,111,216,0)" }], { duration: 2000 }); }
      if (window.top === window) reply({ found: !!el });
    }
    if (m.type === "goto_target") {
      (async () => {
        const pick = () => TARGETS.find(x => x.idx === m.idx && (x.j || 0) === (m.j || 0)) || TARGETS.find(x => x.idx === m.idx);
        let t = pick(); if (!t) { await loadTargets(); t = pick(); }
        const ok = t ? gotoTarget(t.card + ":" + t.idx + ":" + (t.j || 0)) : false;
        reply({ found: ok });
      })();
      return true;
    }
    if (m.type === "reload-notes") { loadNotes(); loadTargets(); }
  });
  if (/rn-goto=/.test(location.hash)) [1500, 4000, 8000].forEach(t => setTimeout(gotoFromHash, t));   // 等划线标好再跳
  if (/rn-find=/.test(location.hash)) [1200, 3000, 6000, 10000].forEach(t => setTimeout(findFromHash, t));   // 网页内容是慢慢加载的，多试几次
  setTimeout(pendingJump, 800);
  loadNotes(); setTimeout(loadNotes, 3000); loadTargets(); setTimeout(loadTargets, 3500); setTimeout(resumeAsks, 1500);   // 等网页（或翻译）稳定后再补标一次
  let moT = null, moN = 0, lastTr = null;
  new MutationObserver(() => {
    const trNow = /translated-(ltr|rtl)/.test(document.documentElement.className);
    if (trNow !== lastTr) {
      // 10-09：从中文切回英文 → 这时才第一次看到英文原文（Chrome 勾了“一律翻译”时，打开就是中文），把英文段落存一份，
      // 服务端据此给“在中文页划的线”补上英文原句，再重新标一遍
      if (lastTr === true && !trNow) { pageSent = 0; setTimeout(sendPage, 1200); setTimeout(loadNotes, 4500); }
      lastTr = trNow; moN = 0;
    }   // 10-05：每切换一次翻译，重新给 40 次补标机会
    if (moN > 40) return;
    clearTimeout(moT);
    moT = setTimeout(() => {
      if (/translated-(ltr|rtl)/.test(document.documentElement.className)) NOTES.forEach(n => document.querySelector(`mark.rn-hl[data-id="${n.id}"]`) && rememberZh(n));
      const miss = NOTES.filter(n => !document.querySelector(`mark.rn-hl[data-id="${n.id}"]`));
      if (miss.length) { moN++; miss.forEach(highlight); }
    }, 1500);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
})();

// ---------- 有效阅读计时（10-04）：网页在前台、2 分钟内有操作才计时；每 30 秒报给本机本机服务 ----------
// 本机服务判断“算不算一次有效阅读”（累计 ≥5 分钟，或这次划了线 / 提了问；30 分钟内回来算同一次），结果显示在抽屉顶上。
(() => {
  if (window.top !== window || window.__rnVisit || !/^https?:/.test(location.href)) return; window.__rnVisit = true;
  const vid = Math.random().toString(36).slice(2, 10); let active = 0, lastInput = Date.now();
  ["scroll", "wheel", "mousemove", "keydown", "pointerdown", "touchstart"].forEach(e => addEventListener(e, () => { lastInput = Date.now(); }, { passive: true, capture: true }));
  setInterval(() => { if (document.visibilityState === "visible" && document.hasFocus() && Date.now() - lastInput < 120000) active += 5; }, 5000);
  const send = () => { try { chrome.runtime.sendMessage({ type: "visit", url: location.href, title: document.title, vid, active }, r => { if (r && r.ok) window.dispatchEvent(new CustomEvent("rn-visit", { detail: r })); }); } catch (e) {} };
  setTimeout(send, 4000); setInterval(send, 30000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") send(); });
  window.addEventListener("rn-visit-now", send);
  chrome.runtime.onMessage.addListener(m => { if (m.type === "visit-now") send(); });   // “今天”里改了阅读线：马上重报一次
})();

// ---------- 右边小抽屉（代替 Chrome 侧边栏，可以拖得很窄）----------
// 悬停小条 0.3 秒自动展开；鼠标移开自动收起（正在里面打字时不收）；点小条或 📌 固定。
(() => {
  if (window.top !== window || window.__rnDrawer) return; window.__rnDrawer = true;
  const host = document.createElement("div"); host.id = "rn-drawer-host"; host.setAttribute("translate", "no"); host.className = "notranslate";
  host.style.cssText = "all:initial;position:fixed;top:0;right:0;height:100vh;z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host{all:initial}
    .tab{position:fixed;right:0;top:42%;width:16px;height:76px;border-radius:8px 0 0 8px;background:#3b6fd8;color:#fff;
      font:11px/1.15 -apple-system,"PingFang SC",sans-serif;display:flex;align-items:center;justify-content:center;writing-mode:vertical-rl;
      letter-spacing:2px;cursor:pointer;box-shadow:-2px 2px 8px rgba(0,0,0,.18);opacity:.55;transition:opacity .15s,width .15s;user-select:none}
    .tab:hover{opacity:1;width:20px}
    .wrap{position:fixed;top:0;right:0;height:100vh;display:flex;flex-direction:column;background:#fff;box-shadow:-6px 0 24px rgba(0,0,0,.16);border-left:1px solid #e5e7eb;
      visibility:hidden;transform:translateX(110%);pointer-events:none}   /* 收起时只滑出屏幕，不拿掉：里面滚到哪里原样保留 */
    .wrap.open{visibility:visible;transform:none;pointer-events:auto}
    .head{display:flex;align-items:center;gap:4px;padding:4px 6px;border-bottom:1px solid #eef0f2;font:12px -apple-system,"PingFang SC",sans-serif;color:#6b7280}
    .head .t{flex:1}
    .head .rc{font-size:11px;color:#3a9b62;white-space:nowrap;margin-right:4px}.head .rc.no{color:#9aa0aa}
    .head button{all:initial;cursor:pointer;padding:2px 6px;border-radius:5px;font:13px -apple-system,sans-serif;color:#6b7280}
    .head button:hover{background:#f2f3f5}
    .head button.on{background:#e8effd;color:#3b6fd8}
    iframe{flex:1;border:0;width:100%}
    .grip{position:absolute;left:-4px;top:0;width:8px;height:100%;cursor:ew-resize}
    .shield{position:fixed;inset:0;cursor:ew-resize;display:none}
    /* 10-06：抽屉左边一列竖排小标签：收起 / 适配（把网页往左让，不挡网页）/ 放大（画布用） */
    .modes{position:fixed;top:32%;display:none;flex-direction:column;gap:8px;z-index:1}
    .modes button{all:initial;cursor:pointer;writing-mode:vertical-rl;letter-spacing:4px;width:34px;padding:14px 0;text-align:center;border-radius:10px 0 0 10px;
      background:#eef2fb;color:#3b6fd8;font:600 15px/1.2 -apple-system,"PingFang SC",sans-serif;box-shadow:-2px 2px 10px rgba(0,0,0,.18);opacity:.9}
    .modes button:hover{opacity:1}
    .modes button.on{background:#3b6fd8;color:#fff;opacity:1}
    .modes.dark button{background:#262a31;color:#8fb0f0}.modes.dark button.on{background:#3b6fd8;color:#fff}
    .wrap.dark{background:#181b20;border-color:#2a2f36}.wrap.dark .head{border-color:#2a2f36;color:#9aa0aa}.wrap.dark .head button{color:#9aa0aa}.wrap.dark .head button:hover{background:#262a31}
  </style>
  <div class="tab" title="笔记 · 答题卡（悬停展开，点一下固定）">笔记</div>
  <div class="wrap"><div class="grip" title="拖动调宽度"></div>
    <div class="head"><span class="t">笔记 · 答题卡</span><span class="rc" title="算读过一次：从这次第一次划线算起，精读要再读 ≥30 分钟、划 ≥2 次线且最后一次比第一次晚 ≥10 分钟；速扫要划 ≥2 次线、再读 ≥10 分钟。只算网页在前台、2 分钟内有操作的时间；30 分钟内回来算同一次"></span><button class="trb" title="🌐 对照翻译：每段英文下面加中文（只翻正文，表格图注不翻）；再点一下收起">🌐</button><button class="guideb" title="显示 / 隐藏读前导航标记（📍）">📍</button><button class="theme" title="白天 / 黑夜 / 跟随系统">🖥</button><button class="pin" title="固定（不自动收起）">📌</button><button class="x" title="收起">✕</button></div>
  </div><div class="modes"><button data-m="hide" title="完全收起（鼠标移到右边蓝条上还能再打开）">收起</button><button data-m="fit" title="适配网页：抽屉固定在右边，网页往左让开，不挡网页">适配</button><button data-m="wide" title="放大：抽屉占大半个窗口（看画布用），盖在网页上">放大</button></div><div class="shield"></div>`;
  document.documentElement.appendChild(host);
  const $ = s => root.querySelector(s), tab = $(".tab"), wrap = $(".wrap"), pinB = $(".pin");
  window.addEventListener("rn-visit", e => {   // 抽屉顶上：第几次读 · 本次几分钟
    const r = e.detail || {}, el = $(".rc"); if (!r.tracked) { el.textContent = ""; return; }
    const m = Math.round((r.cur_active || 0) / 60), after = Math.round((r.cur_after || 0) / 60), need = r.kind === "速扫" ? 10 : 30;
    // 10-05：还没算读过时，显示离“算一次”还差什么（划线几次、第一次划线后读了几分钟）
    const prog = `划线 ${Math.min(r.cur_marks || 0, 2)}/2 · 划线后 ${Math.min(after, need)}/${need} 分钟`;
    el.textContent = r.cur_valid ? `第 ${r.n} 次读 ✓ · 本次 ${m} 分钟` : (r.n ? `已读 ${r.n} 次 · ` : "这次还没算 · ") + prog;
    el.classList.toggle("no", !r.cur_valid);
  });
  let W = 300, pinned = false, frame = null, hoverT = null, leaveT = null, dragging = false;
  const store = chrome.storage && chrome.storage.local;
  const saveState = () => { try { store.set({ drawerW: W, drawerPinned: pinned, drawerMode: DM }); } catch (e) {} };
  // 10-06：抽屉大小两档，画布和其他页签各记各的（默认都是“适配”）
  const modesEl = $(".modes");
  let DM = { canvas: "fit", other: "fit" }, onCanvas = false, pushed = null;
  const curMode = () => DM[onCanvas ? "canvas" : "other"];
  const curW = () => curMode() === "wide" ? Math.max(W, Math.round(innerWidth * 0.62)) : W;
  function layout() {
    const w = curW(), shown = wrap.classList.contains("open");
    wrap.style.width = w + "px";
    modesEl.style.display = shown ? "flex" : "none"; modesEl.style.right = w + "px";
    modesEl.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.m === curMode()));
    // 适配：固定着的时候把网页往左让出抽屉的宽度（只动 html 的右边距，收起就还原）
    const push = shown && pinned && curMode() === "fit" ? w : 0, de = document.documentElement;
    if (push) { if (pushed === null) pushed = de.style.marginRight; de.style.marginRight = push + "px"; }
    else if (pushed !== null) { de.style.marginRight = pushed; pushed = null; }
  }
  modesEl.addEventListener("pointerdown", e => {
    const b = e.target.closest("button"); if (!b) return; e.preventDefault();
    if (b.dataset.m === "hide") { pinned = false; pinB.classList.remove("on"); saveState(); close(); return; }
    DM[onCanvas ? "canvas" : "other"] = b.dataset.m; saveState(); layout();
  });
  addEventListener("resize", () => layout());
  function open() {
    if (!frame) { frame = document.createElement("iframe"); frame.src = chrome.runtime.getURL("sidepanel.html?drawer=1"); wrap.appendChild(frame); }
    wrap.classList.add("open"); tab.style.display = "none"; layout();
    try { frame.contentWindow.postMessage({ rnDrawer: "shown" }, "*"); } catch (e) {}   // 告诉抽屉：回到上次的位置
  }
  function close() { if (pinned) return; try { frame && frame.contentWindow.postMessage({ rnDrawer: "hidden" }, "*"); } catch (e) {} wrap.classList.remove("open"); tab.style.display = ""; layout(); }
  function setPin(v) { pinned = v; pinB.classList.toggle("on", v); saveState(); if (v) open(); else layout(); }
  tab.addEventListener("mouseenter", () => { clearTimeout(hoverT); hoverT = setTimeout(open, 300); });
  tab.addEventListener("mouseleave", () => clearTimeout(hoverT));
  tab.addEventListener("pointerdown", e => { e.preventDefault(); clearTimeout(hoverT); setPin(true); });
  wrap.addEventListener("mouseenter", () => clearTimeout(leaveT));
  wrap.addEventListener("mouseleave", () => {
    clearTimeout(leaveT);
    if (dragging) return;
    leaveT = setTimeout(() => { if (!pinned && document.activeElement !== host) close(); }, 450);
  });
  // 在抽屉里打字时不收；点回网页后再收
  window.addEventListener("pointerdown", e => { if (!dragging && !pinned && wrap.classList.contains("open") && !e.composedPath().includes(host)) close(); }, true);
  pinB.addEventListener("pointerdown", e => { e.preventDefault(); setPin(!pinned); });
  $(".x").addEventListener("pointerdown", e => { e.preventDefault(); pinned = false; pinB.classList.remove("on"); saveState(); close(); });
  // 拖左边缘调宽度
  const shield = $(".shield");
  $(".grip").addEventListener("pointerdown", e => {
    e.preventDefault(); shield.style.display = "block"; dragging = true; clearTimeout(leaveT);
    const move = ev => { W = Math.max(180, Math.min(innerWidth - 120, innerWidth - ev.clientX)); DM[onCanvas ? "canvas" : "other"] = "fit"; layout(); };   // 手动拖宽度＝按这个宽度适配
    const up = () => { dragging = false; shield.style.display = "none"; removeEventListener("pointermove", move, true); removeEventListener("pointerup", up, true); saveState(); };
    addEventListener("pointermove", move, true); addEventListener("pointerup", up, true);
  });
  try { store.get(["drawerW", "drawerPinned", "drawerMode"]).then(v => { if (v.drawerW) W = v.drawerW; if (v.drawerMode) DM = Object.assign(DM, v.drawerMode); if (v.drawerPinned) setPin(true); }); } catch (e) {}
  // 10-06：抽屉告诉我们现在是不是 ④ 画布：画布用画布那一档的大小（默认适配，点“放大”才变大）
  addEventListener("message", e => {
    if (!frame || e.source !== frame.contentWindow || !e.data || !("rnDrawerWide" in e.data)) return;
    onCanvas = !!e.data.rnDrawerWide; layout();
  });
  // 白天 / 黑夜 / 跟随系统（三档循环，插件里所有界面一起变）
  const TH = ["auto", "light", "dark"], THI = { auto: "🖥", light: "☀️", dark: "🌙" }, THN = { auto: "跟随系统", light: "白天", dark: "黑夜" };
  let th = "auto";
  const paintTh = () => {
    const dark = th === "dark" || (th === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    wrap.classList.toggle("dark", dark); modesEl.classList.toggle("dark", dark); $(".theme").textContent = THI[th]; $(".theme").title = "现在：" + THN[th] + "（点一下切换）";
  };
  try { store.get("rnTheme").then(v => { th = v.rnTheme || "auto"; paintTh(); }); } catch (e) {}
  try { chrome.storage.onChanged.addListener(c => { if (c.rnTheme) { th = c.rnTheme.newValue || "auto"; paintTh(); } }); } catch (e) {}
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintTh);
  $(".theme").addEventListener("pointerdown", e => { e.preventDefault(); th = TH[(TH.indexOf(th) + 1) % 3]; try { store.set({ rnTheme: th }); } catch (er) {} paintTh(); });
  $(".trb").addEventListener("pointerdown", e => { e.preventDefault(); window.dispatchEvent(new CustomEvent("rn-tr-toggle")); });
  window.addEventListener("rn-tr-state", e => $(".trb").classList.toggle("on", !!e.detail));
  let gOn = true;
  const paintG = () => { $(".guideb").classList.toggle("on", gOn); $(".guideb").title = gOn ? "读前导航标记：显示中（点一下隐藏）" : "读前导航标记：已隐藏（点一下显示）"; };
  try { store.get("rnGuide").then(v => { gOn = v.rnGuide !== false; paintG(); }); } catch (e) {}
  $(".guideb").addEventListener("pointerdown", e => { e.preventDefault(); gOn = !gOn; try { store.set({ rnGuide: gOn }); } catch (er) {} paintG(); });
  // 点插件图标 = 开 / 关抽屉
  chrome.runtime.onMessage.addListener(m => { if (m.type === "toggle-drawer") { if (wrap.classList.contains("open")) { pinned = false; pinB.classList.remove("on"); saveState(); close(); } else setPin(true); } });
})();
