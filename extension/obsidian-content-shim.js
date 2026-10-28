// 2026-10-06：在 Obsidian 的“读论文”阅读窗口里，先注入这段，再注入 content.js。
// content.js 是给 Chrome 写的，要用 chrome.runtime / chrome.storage；这里在 Obsidian 里给它补上同名的东西：
// 发给后台的消息、存取设置 → 经 console 交给 Obsidian 插件（它再去连本机服务 127.0.0.1:8765）；抽屉（iframe）发来的消息 → 交给 content.js 的监听。
(function () {
  if (window.chrome && window.chrome.runtime && window.chrome.runtime.id) return;   // 真的 Chrome 插件环境，不动
  if (window.__rnShim) return; window.__rnShim = true;
  const pend = {}, L = [], SL = []; let seq = 0;
  const host = window.__rnHost || ((type, payload) => new Promise(res => {   // 测试时可以直接给 __rnHost
    const id = ++seq; pend[id] = res;
    console.log("__RN__" + JSON.stringify({ id, type, payload }));
    setTimeout(() => { if (pend[id]) { delete pend[id]; res({ ok: false, offline: true }); } }, 120000);
  }));
  window.__rnReply = (id, data) => { const f = pend[id]; delete pend[id]; f && f(data); };
  window.__rnPush = msg => L.forEach(fn => { try { fn(msg, {}, () => {}); } catch (e) {} });   // Obsidian → 网页（比如“跳到这句”）
  const local = {
    get: k => host("sget", k),
    set: o => { const ch = {}; Object.entries(o || {}).forEach(([k, v]) => ch[k] = { newValue: v }); SL.forEach(f => { try { f(ch, "local"); } catch (e) {} }); return host("sset", o); },
  };
  const base = "http://127.0.0.1:8765/" + encodeURIComponent("读论文插件") + "/";
  window.chrome = {
    runtime: {
      id: "rn-obsidian",
      sendMessage(m, cb) { const p = host("bg", m); if (cb) p.then(cb); return p; },
      onMessage: { addListener: f => L.push(f) },
      getURL: p => base + p + (p.includes("?") ? "&" : "?") + "rnUrl=" + encodeURIComponent(location.href) + "&rnTitle=" + encodeURIComponent(document.title),
    },
    storage: { local, onChanged: { addListener: f => SL.push(f) } },
  };
  // 抽屉、画布在 iframe 里（本机服务的网址），它们发给“这个标签页”的消息从这里转给 content.js
  addEventListener("message", e => {
    const d = e.data; if (!d || !d.rnShimTab) return;
    let done = false, wait = false;
    const reply = r => { if (done) return; done = true; try { e.source.postMessage({ rnShimReply: d.id, data: r }, "*"); } catch (er) {} };
    L.forEach(fn => { try { if (fn(d.msg, {}, reply) === true) wait = true; } catch (er) {} });
    if (!wait) setTimeout(() => reply(undefined), 60);
  });
})();
