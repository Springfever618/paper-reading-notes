/* 读论文笔记同步（Zotero 插件，配合“读论文”Chrome 插件的本机服务使用）
 * 在 Zotero 自带的本机服务（127.0.0.1:23119）上加几个接口，只给本机的读论文服务用：
 *   POST /rn/find        按 DOI / arXiv 号 / 网址 / 标题找到对应的文献条目（只读）
 *   POST /rn/upsertNote  在这条文献下新建或更新**一条**“网页笔记”子笔记（只改带同步编号的那一条）
 *   POST /rn/upsertAnn   在 PDF 上画 / 更新一条高亮（只动带“网页笔记”标签的、本插件画的）
 *   POST /rn/deleteAnn   网页上删了笔记时，删掉对应的那条高亮（同样只删带标签的）
 *   POST /rn/updateItem  改指定条目的字段（只改传进来的字段，不删任何东西）
 * 每次请求都要带本机令牌（~/读论文笔记/zotero_token.txt，由读论文服务第一次启动时生成），防止别的网页乱调用。
 * 右键菜单“在网页上读（带我的笔记）”：打开这篇做过笔记的网页。
 */
var RN_TOKEN_FILE = null;

function rnTokenPath() {
  if (RN_TOKEN_FILE) return RN_TOKEN_FILE;
  let home = null;
  try { home = Services.dirsvc.get("Home", Ci.nsIFile).path; } catch (e) {}
  if (!home) try { home = PathUtils.homeDir; } catch (e) {}
  RN_TOKEN_FILE = home + "/读论文笔记/zotero_token.txt";
  return RN_TOKEN_FILE;
}

async function rnToken() {
  try { return String(await Zotero.File.getContentsAsync(rnTokenPath())).trim(); } catch (e) {}
  try { return (await IOUtils.readUTF8(rnTokenPath())).trim(); } catch (e) {}
  return null;
}

async function rnCheck(d) {
  const t = await rnToken();
  return !!(t && d && d.token === t);
}

async function rnFind(d) {
  const lib = Zotero.Libraries.userLibraryID;
  const tries = [];
  if (d.doi) tries.push([["DOI", "is", d.doi]]);
  if (d.arxiv) for (const f of ["url", "extra", "archiveID", "DOI"]) tries.push([[f, "contains", d.arxiv]]);
  if (d.url) tries.push([["url", "is", d.url]]);
  if (d.title) tries.push([["title", "is", d.title]]);
  for (const conds of tries) {
    try {
      const s = new Zotero.Search(); s.libraryID = lib;
      for (const c of conds) s.addCondition(...c);
      const ids = await s.search();
      const items = Zotero.Items.get(ids).filter(i => i.isRegularItem() && !i.deleted);
      if (items.length) return items.map(i => ({
        key: i.key, title: i.getField("title"),
        pdf: (i.getAttachments() || []).map(a => Zotero.Items.get(a)).filter(a => a.isPDFAttachment && a.isPDFAttachment()).map(a => a.key)
      }));
    } catch (e) { /* 这个字段在当前条目类型里不能搜，换下一种 */ }
  }
  return [];
}

async function rnUpsert(d) {
  const lib = Zotero.Libraries.userLibraryID;
  const item = Zotero.Items.getByLibraryAndKey(lib, String(d.key || ""));
  if (!item || !item.isRegularItem()) return { ok: false, err: "找不到这篇文献" };
  const marker = String(d.marker || "");
  if (!/^rn-[0-9a-f]{8,}$/.test(marker)) return { ok: false, err: "同步编号不对" };
  for (const nid of item.getNotes()) {
    const n = Zotero.Items.get(nid);
    if (n && n.getNote().includes(marker)) {
      n.setNote(String(d.html || "")); await n.saveTx();
      return { ok: true, noteKey: n.key, created: false };
    }
  }
  const n = new Zotero.Item("note");
  n.libraryID = item.libraryID; n.parentKey = item.key;
  n.setNote(String(d.html || "")); n.addTag("📝网页笔记");
  await n.saveTx();
  return { ok: true, noteKey: n.key, created: true };
}

// ---------- 在 PDF 上画高亮（只动带“网页笔记”标签、由本插件画的高亮）----------
const RN_TAG = "网页笔记";
function rnIsOurs(ann) { return ann && ann.isAnnotation && ann.isAnnotation() && ann.getTags().some(t => t.tag === RN_TAG); }

async function rnUpsertAnn(d) {
  const lib = Zotero.Libraries.userLibraryID;
  const att = Zotero.Items.getByLibraryAndKey(lib, String(d.attKey || ""));
  if (!att || !att.isPDFAttachment || !att.isPDFAttachment()) return { ok: false, err: "找不到这个 PDF 附件" };
  let ann = d.annKey ? Zotero.Items.getByLibraryAndKey(lib, String(d.annKey)) : null;
  if (ann && (!rnIsOurs(ann) || ann.parentID !== att.id)) ann = null;   // 不是我们画的，绝不改，另画一个
  const type = ["highlight", "underline", "note"].includes(d.type) ? d.type : "highlight";
  if (ann && ann.annotationType !== type) { await ann.eraseTx(); ann = null; }   // 样式变了（高亮↔下划线）就删掉我们画的旧的，重画
  const key = ann ? ann.key : Zotero.DataObjectUtilities.generateKey();
  const json = {
    key, type, text: type === "note" ? "" : String(d.text || ""), comment: String(d.comment || ""),
    color: String(d.color || "#ffd400"), pageLabel: String(d.pageLabel || (Number(d.pageIndex) + 1)),
    sortIndex: String(d.sortIndex), position: { pageIndex: Number(d.pageIndex), rects: d.rects },
    tags: [{ name: RN_TAG }]
  };
  if (Zotero.Annotations && Zotero.Annotations.saveFromJSON) {
    const it = await Zotero.Annotations.saveFromJSON(att, json);
    return { ok: true, annKey: (it && it.key) || key };
  }
  if (!ann) { ann = new Zotero.Item("annotation"); ann.libraryID = att.libraryID; ann.key = key; ann.parentID = att.id; ann.annotationType = type; }
  ann.annotationText = json.text; ann.annotationComment = json.comment; ann.annotationColor = json.color;
  ann.annotationPageLabel = json.pageLabel; ann.annotationSortIndex = json.sortIndex; ann.annotationPosition = JSON.stringify(json.position);
  ann.setTags([{ tag: RN_TAG }]);
  await ann.saveTx();
  return { ok: true, annKey: ann.key };
}

async function rnDeleteAnn(d) {
  const ann = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, String(d.annKey || ""));
  if (!ann) return { ok: true, gone: true };
  if (!rnIsOurs(ann)) return { ok: false, err: "不是网页笔记画的高亮，不删" };
  await ann.eraseTx();
  return { ok: true };
}

// ---------- 改条目信息（只改传进来的字段）----------
async function rnUpdateItem(d) {
  const item = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, String(d.key || ""));
  if (!item || !item.isRegularItem()) return { ok: false, err: "找不到这篇文献" };
  const changed = [];
  for (const [f, v] of Object.entries(d.fields || {})) {
    try { if (v !== undefined && v !== null && item.getField(f) !== String(v)) { item.setField(f, String(v)); changed.push(f); } } catch (e) {}
  }
  if (Array.isArray(d.creators) && d.creators.length) {
    // 中文名：整名放一格（fieldMode 1）；英文名：给 {last, first} 就分两格
    item.setCreators(d.creators.map(c => typeof c === "string" ? { lastName: c, firstName: "", creatorType: "author", fieldMode: 1 }
      : { lastName: String(c.last || ""), firstName: String(c.first || ""), creatorType: c.type || "author" }));
    changed.push("creators");
  }
  if (changed.length) await item.saveTx();
  return { ok: true, changed };
}

function rnEndpoint(fn) {
  return class {
    supportedMethods = ["POST"];
    supportedDataTypes = ["application/json"];
    async init(request) {
      try {
        const d = request.data || {};
        if (!(await rnCheck(d))) return [403, "application/json", JSON.stringify({ ok: false, err: "令牌不对" })];
        const r = await fn(d);
        return [200, "application/json", JSON.stringify(Array.isArray(r) ? { ok: true, items: r } : r)];
      } catch (e) {
        return [500, "application/json", JSON.stringify({ ok: false, err: String(e) })];
      }
    }
  };
}

function install() {}
function uninstall() {}
async function startup() {
  Zotero.Server.Endpoints["/rn/ping"] = class { supportedMethods = ["POST"]; supportedDataTypes = ["application/json"]; async init() { return [200, "application/json", JSON.stringify({ ok: true, plugin: "rn-notes-sync", version: "1.0.0" })]; } };
  Zotero.Server.Endpoints["/rn/find"] = rnEndpoint(rnFind);
  Zotero.Server.Endpoints["/rn/upsertNote"] = rnEndpoint(rnUpsert);
  Zotero.Server.Endpoints["/rn/upsertAnn"] = rnEndpoint(rnUpsertAnn);
  Zotero.Server.Endpoints["/rn/deleteAnn"] = rnEndpoint(rnDeleteAnn);
  Zotero.Server.Endpoints["/rn/updateItem"] = rnEndpoint(rnUpdateItem);
  try { await Zotero.initializationPromise; } catch (e) {}
  try { for (const w of Zotero.getMainWindows()) rnAddMenu(w); } catch (e) {}
}

// ---------- 右键菜单：在网页上读（带我的笔记）----------
function onMainWindowLoad({ window }) { rnAddMenu(window); }
function onMainWindowUnload({ window }) { rnRemoveMenu(window); }

function rnAddMenu(win) {
  const doc = win.document, menu = doc.getElementById("zotero-itemmenu");
  if (!menu || doc.getElementById("rn-open-web")) return;
  const mi = doc.createXULElement("menuitem");
  mi.id = "rn-open-web"; mi.setAttribute("label", "🌐 在网页上读（带我的笔记）");
  mi.addEventListener("command", () => rnOpenWeb(win));
  const sep = doc.createXULElement("menuseparator"); sep.id = "rn-open-web-sep";
  menu.insertBefore(sep, menu.firstChild); menu.insertBefore(mi, sep);
}
function rnRemoveMenu(win) {
  for (const id of ["rn-open-web", "rn-open-web-sep"]) { const e = win.document.getElementById(id); if (e) e.remove(); }
}

async function rnOpenWeb(win) {
  let it = (win.ZoteroPane.getSelectedItems() || [])[0];
  if (!it) return;
  if (!it.isRegularItem() && it.parentItem) it = it.parentItem;
  let url = null;
  try {   // 先问读论文服务：这篇在哪个网页上做过笔记
    const r = await Zotero.HTTP.request("GET", "http://127.0.0.1:8765/api/weburl?key=" + it.key, { responseType: "json", timeout: 3000 });
    url = r.response && r.response.url;
  } catch (e) {}
  if (!url) {
    const f = k => { try { return it.getField(k) || ""; } catch (e) { return ""; } };
    const m = (f("url") + " " + f("extra") + " " + f("archiveID")).match(/(?:arxiv\.org\/(?:abs|pdf|html)\/|arXiv:\s*)(\d{4}\.\d{4,5})/i);
    if (m) url = "https://arxiv.org/html/" + m[1];
    else if (f("url")) url = f("url");
    else if (f("DOI")) url = "https://doi.org/" + f("DOI");
  }
  if (url) Zotero.launchURL(url); else win.alert("这篇没有网址或 DOI，打不开网页版。");
}
function shutdown() {
  try { for (const w of Zotero.getMainWindows()) rnRemoveMenu(w); } catch (e) {}
  for (const p of ["/rn/ping", "/rn/find", "/rn/upsertNote", "/rn/upsertAnn", "/rn/deleteAnn", "/rn/updateItem"]) delete Zotero.Server.Endpoints[p];
}
