// 后台：负责和本机服务通信（只连 127.0.0.1:8765），打开侧边栏，右键菜单。
const API = "http://127.0.0.1:8765";
const post = (path, body) => fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
// 点插件图标：开 / 关网页右边的小抽屉（Chrome 侧边栏最窄只能 320px，所以改用抽屉）。
// 在 chrome:// 之类插件进不去的页面，退回打开 Chrome 侧边栏。
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
chrome.action.onClicked.addListener(async tab => {
  try { await chrome.tabs.sendMessage(tab.id, { type: "toggle-drawer" }); }
  catch (e) { chrome.sidePanel.open({ tabId: tab.id }).catch(() => {}); }
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "y", title: "🟨 存进答题卡：重要", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "g", title: "🟩 存进答题卡：和我的研究有关", contexts: ["selection"] });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const { card } = await chrome.storage.local.get("card");
  if (!card) { chrome.action.setBadgeText({ text: "?" }); return; }
  try {
    const j = await post("/api/clip", { name: card, text: info.selectionText || "", url: tab && tab.url, color: info.menuItemId });
    chrome.action.setBadgeText({ text: j.ok ? "✓" : "!" });
    chrome.runtime.sendMessage({ type: "clipped" }).catch(() => {});
  } catch (e) { chrome.action.setBadgeText({ text: "!" }); }
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1500);
});
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    try {
      if (m.type === "list") reply(await (await fetch(API + "/api/webnotes?url=" + encodeURIComponent(m.url))).json());
      else if (m.type === "add") { const r = await post("/api/webnote", m); reply(r); chrome.runtime.sendMessage({ type: "notes-changed" }).catch(() => {}); }
      else if (m.type === "jobs_for") reply(await (await fetch(API + "/api/jobs_for?url=" + encodeURIComponent(m.url))).json());
      else if (m.type === "tags") reply(await (await fetch(API + "/api/tags")).json());
      else if (m.type === "translate") reply(await post("/api/translate", m));   // 10-06：🌐 对照翻译
      else if (m.type === "pagetext") reply(await post("/api/pagetext", m));
      else if (m.type === "targets") reply(await (await fetch(API + "/api/card_targets?url=" + encodeURIComponent(m.url))).json());
      else if (m.type === "ask_start") reply(await post("/api/ask_start", m));
      else if (m.type === "ask_poll") reply(await (await fetch(API + "/api/ask_poll?jid=" + encodeURIComponent(m.jid))).json());
      else if (m.type === "jump_take") reply(await (await fetch(API + "/api/jump_take?url=" + encodeURIComponent(m.url) + "&doi=" + encodeURIComponent(m.doi || ""))).json());   // 10-09：转址后补跳
      else if (m.type === "jump_done") reply(await post("/api/jump_done", {}));
      else if (m.type === "visit") reply(await post("/api/visit", m));   // 10-04：有效阅读计时
      else if (m.type === "update") { const r = await post("/api/webnote_update", m); reply(r); chrome.runtime.sendMessage({ type: "notes-changed" }).catch(() => {}); }
      else reply({ ok: false });
    } catch (e) { reply({ ok: false, offline: true }); }
  })();
  return true;
});
