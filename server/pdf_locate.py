"""在 PDF 里找一句英文原句的位置，给 Zotero 画高亮用。

返回 Zotero 批注需要的格式：pageIndex（从 0 数）、rects（PDF 坐标，原点在左下角，每行一个框）、sortIndex。
做法：把整份 PDF 拆成单词（带坐标），把原句也拆成单词，统一小写、去标点、把行末连字符拼回去，
先找完全一样的单词序列；找不到就找“最长的一段连续相同”（覆盖原句 ≥60% 的单词才算找到）。
"""
import re
from difflib import SequenceMatcher

import pymupdf

_cache = {}


def _norm(w):
    return re.sub(r"[^\w]", "", w.lower().replace("ﬁ", "fi").replace("ﬂ", "fl"))


def _words(path):
    """整份 PDF 的单词流：[(规范化单词, 页号, x0, y0, x1, y1, 页高, 行号)]，行末连字符拼回。"""
    if path in _cache:
        return _cache[path]
    doc = pymupdf.open(path)
    out = []
    for pi, page in enumerate(doc):
        h = page.rect.height
        ws = page.get_text("words", sort=True)   # x0,y0,x1,y1,word,block,line,wordno（y 原点在上）
        i = 0
        while i < len(ws):
            x0, y0, x1, y1, w, b, l, _ = ws[i]
            if w.endswith("-") and i + 1 < len(ws) and (ws[i + 1][5], ws[i + 1][6]) != (b, l):
                nx = ws[i + 1]           # 行末连字符：两半拼成一个词，坐标分两段记
                n = _norm(w[:-1] + nx[4])
                if n:
                    out.append((n, pi, x0, y0, x1, y1, h, (b, l)))
                    out.append(("", pi, nx[0], nx[1], nx[2], nx[3], h, (nx[5], nx[6])))
                i += 2
                continue
            n = _norm(w)
            if n:
                out.append((n, pi, x0, y0, x1, y1, h, (b, l)))
            i += 1
    _cache[path] = out
    return out


def _exact(seq, q, lo=0, hi=None):
    """在 seq[lo:hi] 里找和 q 完全一样的单词序列；最后一个词允许是前缀（completion ↔ completions）。"""
    hi = len(seq) if hi is None else hi
    for i in range(lo, hi):
        if seq[i] != q[0] and not (len(q) == 1 and seq[i].startswith(q[0])): continue
        j, k = i, 0
        while j < hi and k < len(q):
            if seq[j] == "":
                j += 1; continue
            if not (seq[j] == q[k] or (k == len(q) - 1 and seq[j].startswith(q[k]))): break
            j += 1; k += 1
        if k == len(q): return (i, j)
    return None


def _block(seq, para):
    """先找到这一段在 PDF 单词流里的大致范围（段落开头 8 个词 + 结尾 8 个词）。"""
    p = [n for n in (_norm(t) for t in re.split(r"\s+", para)) if n]
    if len(p) < 6: return None
    a = _exact(seq, p[:8]) or _exact(seq, p[:5])
    if not a: return None
    b = _exact(seq, p[-8:], a[0]) or _exact(seq, p[-5:], a[0])
    end = b[1] if b and b[1] - a[0] < len(p) * 3 else min(len(seq), a[0] + int(len(p) * 1.4) + 10)
    return (a[0], end)


def locate(path, text, para=None):
    """para = 这句话所在段落的英文原文（有的话先锁定段落，短词也不会跑到别处）。"""
    W = _words(path)
    seq = [w[0] for w in W]
    q = [n for n in (_norm(t) for t in re.split(r"\s+", text)) if n]
    if not q or (len(q) < 2 and not para):
        return None
    hit = None
    blk = _block(seq, para) if para else None
    if blk: hit = _exact(seq, q, blk[0], blk[1])
    if hit is None and len(q) >= 3: hit = _exact(seq, q)   # 段落里没找到：全文找（短词不全文找，免得画错地方）
    if hit is None and len(q) < 6:
        return None
    if hit is None:   # 模糊：最长连续相同块
        best = None
        for i in range(0, max(1, len(seq) - len(q) + 1), max(1, len(q) // 2)):
            win = seq[i:i + len(q) * 2]
            m = SequenceMatcher(None, win, q, autojunk=False).find_longest_match(0, len(win), 0, len(q))
            if best is None or m.size > best[2]:
                best = (i + m.a, i + m.a + m.size, m.size)
        if not best or best[2] < max(3, 0.6 * len(q)):
            return None
        hit = best[:2]
    ws = W[hit[0]:hit[1]]
    page = ws[0][1]
    ws = [w for w in ws if w[1] == page]       # Zotero 一条高亮只能在一页里；跨页的取第一页
    lines = {}
    for w in ws:
        r = lines.setdefault(w[7], [w[2], w[3], w[4], w[5]])
        r[0], r[1], r[2], r[3] = min(r[0], w[2]), min(r[1], w[3]), max(r[2], w[4]), max(r[3], w[5])
    h = ws[0][6]
    rects = [[round(x0, 3), round(h - y1, 3), round(x1, 3), round(h - y0, 3)] for x0, y0, x1, y1 in
             sorted(lines.values(), key=lambda r: (round(r[1]), r[0]))]
    top = min(w[3] for w in ws)
    offset = sum(1 for w in W[:hit[0]] if w[1] == page)
    ln = [w for w in W if w[1] == page and w[7] == ws[0][7]]
    lx0 = min(w[2] for w in ln); ly0 = min(w[3] for w in ln); ly1 = max(w[5] for w in ln)
    return {"pageIndex": page, "rects": rects, "lineStart": [round(lx0, 3), round(h - ly1, 3), round(h - ly0, 3)],
            "sortIndex": f"{page:05d}|{offset:06d}|{int(top):05d}",
            "matched": " ".join(w[0] for w in ws if w[0]), "exact": len(ws) == hit[1] - hit[0]}


if __name__ == "__main__":
    import sys
    print(locate(sys.argv[1], sys.argv[2]))


# ---------- 10-04：中文论文（知网下载的 PDF）按“字”找位置 ----------
_zcache = {}


def _chars(path):
    """整份 PDF 的字流：[(规范化的字, 页号, x0, y0, x1, y1, 页高, 行号)]；只留汉字、字母、数字。"""
    if path in _zcache:
        return _zcache[path]
    doc = pymupdf.open(path)
    out = []
    for pi, page in enumerate(doc):
        h = page.rect.height
        d = page.get_text("rawdict")
        for bi, b in enumerate(d.get("blocks", [])):
            for li, ln in enumerate(b.get("lines", [])):
                for sp in ln.get("spans", []):
                    for ch in sp.get("chars", []):
                        c = ch["c"].lower()
                        if c.isalnum():
                            x0, y0, x1, y1 = ch["bbox"]
                            out.append((c, pi, x0, y0, x1, y1, h, (bi, li)))
    _zcache[path] = out
    return out


def _n(t):
    return "".join(c for c in (t or "").lower() if c.isalnum())


def locate_zh(path, text, prefix="", suffix="", ctx="", frac=None):
    """prefix / suffix / ctx：插件记下的划线前后文。短词（如“隐喻”）全文出现很多次，靠前后文锁定是哪一处。"""
    C = _chars(path)
    s = "".join(c[0] for c in C)
    q = _n(text)
    if not q:
        return None
    i = -1
    if len(q) < 4 or s.count(q) > 1:
        pre, suf = _n(prefix)[-12:], _n(suffix)[:12]
        for a, b in ((pre, suf), (pre[-6:], suf[:6]), (pre, ""), ("", suf)):
            if not (a or b): continue
            j = s.find(a + q + b)
            if j >= 0 and s.count(a + q + b) == 1:
                i = j + len(a); break
        if i < 0 and ctx:   # 再用整段上下文：先找到这段话，再在段里找这个词
            cx = _n(ctx)
            for k in range(0, max(1, len(cx) - 16), 8):
                j = s.find(cx[k:k + 16])
                if j >= 0:
                    lo = max(0, j - k - 5); hi = lo + len(cx) + 10
                    occ = [m for m in range(lo, hi) if s.startswith(q, m)]
                    if len(occ) == 1: i = occ[0]
                    elif occ and frac is not None:   # 同一段里出现好几次：按插件记的“在段落里的相对位置”挑最近的
                        i = min(occ, key=lambda m: abs(m - (lo + 5 + float(frac) * len(cx))))
                    break
        if i < 0 and s.count(q) == 1:
            i = s.find(q)   # 全文只出现一次的短词，位置唯一，可以画
        if i < 0 and len(q) < 4:
            return None   # 短词又锁不定位置：宁可不画也不画错
    if i < 0:
        i = s.find(q)
    if i >= 0:
        hit = (i, i + len(q))
    else:   # 模糊：最长连续相同的一段，至少覆盖原句六成
        m = SequenceMatcher(None, s, q, autojunk=False).find_longest_match(0, len(s), 0, len(q))
        if len(q) < 4 or m.size < max(4, 0.6 * len(q)):
            return None
        hit = (m.a, m.a + m.size)
    ws = C[hit[0]:hit[1]]
    page = ws[0][1]
    ws = [w for w in ws if w[1] == page]
    lines = {}
    for w in ws:
        r = lines.setdefault(w[7], [w[2], w[3], w[4], w[5]])
        r[0], r[1], r[2], r[3] = min(r[0], w[2]), min(r[1], w[3]), max(r[2], w[4]), max(r[3], w[5])
    h = ws[0][6]
    rects = [[round(x0, 3), round(h - y1, 3), round(x1, 3), round(h - y0, 3)] for x0, y0, x1, y1 in
             sorted(lines.values(), key=lambda r: (round(r[1]), r[0]))]
    offset = sum(1 for w in C[:hit[0]] if w[1] == page)
    ln = [w for w in C if w[1] == page and w[7] == ws[0][7]]
    lx0 = min(w[2] for w in ln); ly0 = min(w[3] for w in ln); ly1 = max(w[5] for w in ln)
    return {"pageIndex": page, "rects": rects, "lineStart": [round(lx0, 3), round(h - ly1, 3), round(h - ly0, 3)],
            "sortIndex": f"{page:05d}|{offset:06d}|{int(min(w[3] for w in ws)):05d}",
            "matched": "".join(w[0] for w in ws), "exact": len(ws) == hit[1] - hit[0] and i >= 0}
