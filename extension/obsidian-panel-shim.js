// 2026-10-06：抽屉（sidepanel.html）在 Obsidian 里不是插件页面，而是本机服务网址上的普通网页，没有 chrome.tabs / chrome.storage。
// 这里补上：“当前标签页”就是外面那个网页（网址由 content.js 打开抽屉时带在 ?rnUrl= 里）；发给标签页的消息经 postMessage 交给外面的网页。
// 在真的 Chrome 插件里 chrome.tabs 已经有了，这段什么都不做。
(function () {
  if (window.chrome && window.chrome.tabs) return;
  const q = new URLSearchParams(location.search), U = q.get("rnUrl");
  if (!U) return;
  const tab = { id: 1, url: U, title: q.get("rnTitle") || "", active: true };
  const pend = {}; let seq = 0;
  addEventListener("message", e => { const d = e.data; if (d && d.rnShimReply && pend[d.rnShimReply]) { pend[d.rnShimReply](d.data); delete pend[d.rnShimReply]; } });
  const keysOf = k => k == null ? Object.keys(localStorage).filter(x => x.startsWith("rn_")).map(x => x.slice(3)) : Array.isArray(k) ? k : typeof k === "string" ? [k] : Object.keys(k);
  const local = {
    get(k) { const o = {}; keysOf(k).forEach(x => { try { const v = localStorage.getItem("rn_" + x); if (v != null) o[x] = JSON.parse(v); } catch (e) {} }); return Promise.resolve(o); },
    set(o) { Object.entries(o || {}).forEach(([k, v]) => { try { localStorage.setItem("rn_" + k, JSON.stringify(v)); } catch (e) {} }); return Promise.resolve(); },
  };
  const noop = { addListener() {} };
  window.chrome = {
    runtime: { onMessage: noop, sendMessage: () => Promise.resolve() },
    storage: { local, onChanged: noop },
    tabs: {
      query: () => Promise.resolve([tab]),
      sendMessage: (id, msg) => new Promise(res => {
        const i = ++seq; pend[i] = res; parent.postMessage({ rnShimTab: 1, id: i, msg }, "*");
        setTimeout(() => { if (pend[i]) { delete pend[i]; res(undefined); } }, 5000);
      }),
      create: o => { window.open(o.url, "_blank"); return Promise.resolve(); },
      onActivated: noop, onUpdated: noop,
    },
  };
})();
