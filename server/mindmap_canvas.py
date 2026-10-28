"""读论文插件的 🗺 画布——把一篇网页论文上的划线按章节排成脑图，格式就是 Obsidian 画布（.canvas）。
在 Chrome 里边读边编辑（插件里的画布面板），状态存在 数据文件夹/mindmaps/；点“上传到 Obsidian”写进 RN_OBSIDIAN_VAULT 指定的库
（在库里找这篇论文的笔记所在文件夹；找不到就放 论文画布/）。没设 RN_OBSIDIAN_VAULT 就存到 数据文件夹/canvas/。
布局：最左是论文标题卡 → 中间一列章节卡（每章一种颜色）→ 右边是这一章的划线卡（同色，按原文顺序往下排），之间连线。
卡片里有“📍 回到原文”：Chrome 打开原网页并自动滚到这句（网址带 #rn-goto=笔记id，由插件识别）。
再同步一次只补新划线、更新卡片文字；拖过的位置、自己加的卡片和连线都保留。"""
import hashlib, json, os, re, shutil, subprocess, urllib.parse

DATA = os.path.expanduser(os.environ.get("RN_DATA") or os.path.join(os.path.expanduser("~"), "读论文笔记"))
_V = os.path.expanduser(os.environ.get("RN_OBSIDIAN_VAULT", ""))
HAS_VAULT = bool(_V) and os.path.isdir(_V)
VAULT = _V if HAS_VAULT else os.path.join(DATA, "canvas")
OUTDIR = os.path.join(VAULT, "论文画布") if HAS_VAULT else VAULT
COLORS = ["1", "2", "3", "4", "5", "6"]   # Obsidian 画布自带的 6 种颜色：红 橙 黄 绿 青 紫
CW, CH, SW, SH, GAP = 300, 200, 220, 90, 30   # 划线卡宽高、章节卡宽高、间距（10-06：卡片太宽，420/300 → 300/220）
RW, SX, CX = 260, 320, 600   # 标题卡宽度、章节卡那一列的 x、划线卡那一列的 x
OLD_W = {"root": 360, "sec": 300, "card": 420}   # 10-06 之前的默认宽度：还是这个宽度的卡片（没手动调过）换成新宽度


def safe_name(s):
    return (re.sub(r"[\\/:*?\"<>|#^\[\]]+", " ", s).strip() or "未命名论文")[:80]


def goto_url(url, nid):
    return url.split("#")[0] + "#rn-goto=" + nid


def card_text(n, sec, url):
    sub = f"{sec['sub']}\n" if sec.get("sub") and sec["sub"] != sec["h"] else ""
    quote = (n.get("quote") or "").strip()
    en = (n.get("en") or "").strip()
    note = (n.get("note") or "").strip()
    t = f"#### {'★ ' if n.get('star') else ''}{sec['label']}\n{sub}\n> {quote}\n"
    if en and en != quote:
        t += f"\n<small>{en}</small>\n"
    if note:
        t += f"\n✏️ {note}\n"
    return t + f"\n[📍 回到原文]({goto_url(url, n['id'])})"


def layout(old, url, title, notes, secs):
    """secs：{笔记id: {h: 章节名, zh: 中文, sub: 小节, order: 原文顺序}}（由网页里的插件算好）。"""
    old = old or {"nodes": [], "edges": []}
    nodes = {n["id"]: n for n in old.get("nodes", [])}
    edges = {e["id"]: e for e in old.get("edges", [])}

    # 笔记里已经删掉的划线：自动生成、你没改过的卡片跟着去掉（改过字的留着）
    ids = {n["id"] for n in notes}
    for k in [k for k, v in nodes.items() if k.startswith("rn-") and not k.startswith("rn-sec") and k != "rn-root"
              and k[3:] not in ids and v.get("rnSrc") is not None and v.get("rnSrc") == v.get("text")]:
        nodes.pop(k)
    edges = {k: e for k, e in edges.items() if e["fromNode"] in nodes and e["toNode"] in nodes}
    for k in [k for k, v in nodes.items() if k.startswith("rn-sec") and v.get("rnAuto") and not any(e["fromNode"] == k for e in edges.values())]:
        nodes.pop(k)
    edges = {k: e for k, e in edges.items() if e["fromNode"] in nodes and e["toNode"] in nodes}

    # 按原文顺序排好，归到章节（在画布里自己新建的卡片记成的笔记没有原句，不再另排）
    items = []
    for n in notes:
        if not (n.get("quote") or "").strip() or n["id"] in old.get("rnHidden", []):
            continue
        s = secs.get(n["id"]) or {}
        h = (s.get("h") or "未定位（网页上没找到这句）").strip()
        lab = h + (f" · {s['zh'].strip()}" if s.get("zh") and s["zh"].strip() not in h else "")
        items.append((s.get("order", 10 ** 9), n, {"h": h, "label": lab, "sub": (s.get("sub") or "").strip()}))
    items.sort(key=lambda x: x[0])
    sec_order = []
    for _, _, s in items:
        if s["h"] not in sec_order:
            sec_order.append(s["h"])

    root = "rn-root"
    if root not in nodes:
        nodes[root] = {"id": root, "type": "text", "x": 0, "y": 0, "width": RW, "height": 120}
    nodes[root]["text"] = f"## {title}\n[🔗 原文]({url.split('#')[0]})"

    # 新章节放在已有内容的最下面；已有章节、卡片的位置不动
    def bottom():
        ys = [v["y"] + v["height"] for k, v in nodes.items() if k != root]
        return max(ys) + GAP * 2 if ys else 0

    for i, h in enumerate(sec_order):
        sid = "rn-sec-" + re.sub(r"\W+", "_", h)[:40]
        color = COLORS[i % len(COLORS)]
        lab = next(s["label"] for _, _, s in items if s["h"] == h)
        if sid not in nodes:
            nodes[sid] = {"id": sid, "type": "text", "x": SX, "y": bottom(), "width": SW, "height": SH, "color": color, "rnAuto": True}
        nodes[sid]["text"] = f"### {lab}"
        color = nodes[sid].get("color", color)
        eid = f"e-{root}-{sid}"
        edges.setdefault(eid, {"id": eid, "fromNode": root, "fromSide": "right", "toNode": sid, "toSide": "left"})
        sn = nodes[sid]
        for _, n, s in [x for x in items if x[2]["h"] == h]:
            cid = "rn-" + n["id"]
            if cid not in nodes:
                mine = [v for k, v in nodes.items() if any(e["fromNode"] == sid and e["toNode"] == k for e in edges.values())]
                y = max((v["y"] + v["height"] for v in mine), default=sn["y"] - GAP) + GAP
                if not mine:
                    y = sn["y"]
                # 下面已有别的章节，就整体往下挪，避免重叠
                need = y + CH + GAP
                for k, v in nodes.items():
                    if k.startswith("rn-sec-") and v["y"] > sn["y"] and v["y"] < need:
                        shift, line = need - v["y"], v["y"]
                        for kk, vv in nodes.items():
                            if kk != root and vv["y"] >= line:
                                vv["y"] += shift
                        break
                nodes[cid] = {"id": cid, "type": "text", "x": CX, "y": y, "width": CW, "height": CH, "color": color, "rnAuto": True}
                eid = f"e-{sid}-{cid}"
                edges[eid] = {"id": eid, "fromNode": sid, "fromSide": "right", "toNode": cid, "toSide": "left"}
            gen, nd = card_text(n, s, url), nodes[cid]
            if "text" not in nd or nd.get("rnSrc") == nd["text"]:   # 你在画布里改过的卡片文字不覆盖
                nd["text"] = gen
            nd["rnSrc"] = gen
            nd["rnStar"] = bool(n.get("star"))

    if not old.get("rnV2"):   # 10-06：老画布换成新的卡片宽度一次；你手动调过宽度、拖过位置的卡片不动
        for k, v in nodes.items():
            kind = "root" if k == root else "sec" if k.startswith("rn-sec-") else "card" if k.startswith("rn-") else None
            if kind and v.get("width") == OLD_W[kind]:
                v["width"] = {"root": RW, "sec": SW, "card": CW}[kind]
                if v.get("rnAuto") and v.get("x") in (460, 860):
                    v["x"] = SX if kind == "sec" else CX
    old["rnV2"] = True
    keep = {k: old[k] for k in ("rnV2", "rnHidden", "exportPath", "exportMtime", "exportIds", "exportEdgeIds") if k in old}
    return dict({"nodes": list(nodes.values()), "edges": list(edges.values()), "title": title, "url": url}, **keep)


def pull_obsidian(d):
    """上传过的画布在 Obsidian 里被改过（拖动、改字、换色、加卡片、连线、删卡片）→ 先合并回来，Obsidian 里改的为准。"""
    p = d.get("exportPath") and os.path.join(VAULT, d["exportPath"])
    if not p or not os.path.exists(p) or os.path.getmtime(p) <= d.get("exportMtime", 0) + 1:
        return d
    try:
        ob = json.load(open(p, encoding="utf-8"))
    except Exception:
        return d
    on = {n["id"]: n for n in ob.get("nodes", [])}
    old_ids, old_eids = set(d.get("exportIds", [])), set(d.get("exportEdgeIds", []))
    nodes = []
    for n in d.get("nodes", []):
        if n["id"] in on:   # 两边都有：位置、大小、文字、颜色用 Obsidian 的
            o = on.pop(n["id"])
            for k in ("x", "y", "width", "height", "text", "color", "type", "file", "url", "label"):
                if k in o: n[k] = o[k]
                elif k == "color": n.pop("color", None)
            if (o.get("x"), o.get("y")) != (n.get("x"), n.get("y")): n.pop("rnAuto", None)
            nodes.append(n)
        elif n["id"] in old_ids:   # 上次上传时有、Obsidian 里删了
            if n["id"].startswith("rn-") and not n["id"].startswith("rn-sec") and n["id"] != "rn-root":
                d.setdefault("rnHidden", []).append(n["id"][3:])
        else:                      # 上传之后在 Chrome 里新加的
            nodes.append(n)
    nodes += list(on.values())     # Obsidian 里新加的卡片
    ids = {n["id"] for n in nodes}
    edges = [e for e in ob.get("edges", [])] + [e for e in d.get("edges", []) if e["id"] not in old_eids and e["id"] not in {x["id"] for x in ob.get("edges", [])}]
    d["nodes"], d["edges"] = nodes, [e for e in edges if e["fromNode"] in ids and e["toNode"] in ids]
    d["exportMtime"] = os.path.getmtime(p)
    return d


STATE = os.path.join(DATA, "mindmaps")


def state_path(url):
    return os.path.join(STATE, hashlib.sha1(url.split("#")[0].encode()).hexdigest()[:16] + ".json")


def load_state(url):
    try:
        return json.load(open(state_path(url), encoding="utf-8"))
    except Exception:
        return None


def save_state(url, d):
    os.makedirs(STATE, exist_ok=True)
    p = state_path(url); tmp = p + ".tmp"
    open(tmp, "w", encoding="utf-8").write(json.dumps(d, ensure_ascii=False))
    os.replace(tmp, p)


def paper_folder(url):
    """这篇论文的笔记在 Obsidian 库里哪个文件夹：按 arXiv 编号或网址在笔记里找；找不到就放 论文画布/。"""
    if not HAS_VAULT:
        return OUTDIR, None
    base = url.split("#")[0].split("?")[0].rstrip("/")
    keys = []
    m = re.search(r"(\d{4}\.\d{4,5})", base)            # arXiv 编号
    if m: keys.append(m.group(1))
    m = re.search(r"(10\.\d{4,}/[^\s?#]+)", base)       # 网址里带 DOI（pnas、wiley……）
    if m: keys.append(m.group(1))
    last = base.rsplit("/", 1)[-1]                         # 文章编号（nature 的 s41467-025-61345-5 这种）
    if len(last) >= 8 and re.search(r"\d", last) and not keys: keys.append(last)
    if not keys: keys.append(re.sub(r"^https?://(www\.)?", "", base))
    lib = VAULT
    best, score = None, 0
    for root, dirs, files in os.walk(lib):
        dirs[:] = [x for x in dirs if not x.startswith(".")]
        for f in files:
            if f.endswith(".md"):
                try:
                    t = open(os.path.join(root, f), encoding="utf-8").read()
                except Exception:
                    continue
                # 开头（标题、来源那几行）就写着这个编号的，才是这篇论文自己的笔记；正文里顺带提到的排后面
                sc = sum((10 if k in t[:800] else 0) + t.count(k) for k in keys)
                if sc > score:
                    best, score = (root, os.path.join(root, f)), sc
    if best:
        return best
    return OUTDIR, None


IMGDIR = os.path.join(OUTDIR, "附件")
IMG_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}


def save_image(data_url):
    """画布里粘贴的图片 → 存进 论文画布/附件/，卡片里用 ![[路径]] 引用，Obsidian 画布里也能直接显示。"""
    import base64
    m = re.match(r"^data:(image/[a-z+]+);base64,(.+)$", data_url or "", re.S)
    if not m or m.group(1) not in IMG_EXT:
        return {"ok": False, "msg": "不是图片"}
    b = base64.b64decode(m.group(2))
    if len(b) > 20 * 1024 * 1024:
        return {"ok": False, "msg": "图片太大（超过 20MB）"}
    os.makedirs(IMGDIR, exist_ok=True)
    name = "画布图_" + hashlib.sha1(b).hexdigest()[:12] + "." + IMG_EXT[m.group(1)]
    f = os.path.join(IMGDIR, name)
    if not os.path.exists(f):
        open(f, "wb").write(b)
    return {"ok": True, "path": os.path.relpath(f, VAULT)}


def vault_image(rel):
    """画布面板显示 ![[路径]] 里的图：只给 Obsidian 库里的图片文件。"""
    f = os.path.realpath(os.path.join(VAULT, rel))
    if not f.startswith(os.path.realpath(VAULT) + os.sep) or not os.path.isfile(f):
        return None, None
    ext = f.rsplit(".", 1)[-1].lower()
    ct = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml"}.get(ext)
    return (open(f, "rb").read(), ct) if ct else (None, None)


def export(url, d, open_it=True):
    d = pull_obsidian(d)
    folder, note = paper_folder(url)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, safe_name(d.get("title") or "论文") + "·画布.canvas")
    out = {"nodes": d.get("nodes", []), "edges": d.get("edges", [])}
    tmp = path + ".tmp"
    open(tmp, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent="\t"))
    os.replace(tmp, path)
    rel = os.path.relpath(path, VAULT)
    d.update(exportPath=rel, exportMtime=os.path.getmtime(path), exportIds=[n["id"] for n in out["nodes"]], exportEdgeIds=[e["id"] for e in out["edges"]])
    save_state(url, d)
    # 另存一份只有 ★ 卡片的精选画布（Obsidian 画布不能筛选，所以单独一个文件）
    stars = {n["id"] for n in out["nodes"] if n.get("rnStar")}
    spath = path.replace("·画布.canvas", "·画布（★精选）.canvas")
    if stars:
        secs = {e["fromNode"] for e in out["edges"] if e["toNode"] in stars}
        keep = stars | secs | {"rn-root"}
        sout = {"nodes": [n for n in out["nodes"] if n["id"] in keep],
                "edges": [e for e in out["edges"] if e["fromNode"] in keep and e["toNode"] in keep]}
        open(spath, "w", encoding="utf-8").write(json.dumps(sout, ensure_ascii=False, indent="\t"))
    elif os.path.exists(spath):
        os.remove(spath)
    if note:   # 论文笔记里加一行链接到画布（只加一次）
        t = open(note, encoding="utf-8").read(); link = f"[[{os.path.basename(path)}|🗺 阅读画布]]"
        if link not in t:
            open(note, "w", encoding="utf-8").write(t.rstrip() + f"\n\n## 🗺 阅读画布\n- {link}\n")
    if open_it and HAS_VAULT and shutil.which("open"):
        subprocess.Popen(["open", "obsidian://open?vault=" + urllib.parse.quote(os.path.basename(VAULT)) + "&file=" + urllib.parse.quote(rel)])
    return {"ok": True, "file": rel, "note": os.path.relpath(note, VAULT) if note else "", "canvas": d}
