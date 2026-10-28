"""生成小红书配图（1080×1440，3:4）。用法：python3 make.py → 同目录下 01.png ～ 06.png。需要本机装有 Google Chrome。"""
import os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
:root{--paper:#F5EFE3;--ink:#22201C;--sub:#6B655B;--line:#DDD3C2;--card:#FFFDF8;
--hl:#FFE27A;--green:#BFE6A8;--blue:#2F6FDB;--orange:#E8833A;--purple:#8B6FD6}
html,body{width:1080px;height:1440px}
body{background:var(--paper);color:var(--ink);font-family:"PingFang SC","Hiragino Sans GB",sans-serif;padding:84px 80px;position:relative;overflow:hidden}
.tag{display:inline-block;font-size:30px;letter-spacing:2px;color:var(--sub);border:2px solid var(--ink);border-radius:999px;padding:8px 26px}
h1{font-size:96px;line-height:1.18;font-weight:800;margin-top:40px;letter-spacing:-1px}
h1 .mk{background:linear-gradient(transparent 58%,var(--hl) 58%)}
h2{font-size:72px;line-height:1.2;font-weight:800;margin-top:28px}
.lead{font-size:36px;line-height:1.6;color:var(--sub);margin-top:28px}
.num{font-family:Georgia,serif;font-style:italic;font-size:44px;color:var(--orange)}
.win{background:var(--card);border:2px solid var(--ink);border-radius:22px;box-shadow:10px 10px 0 var(--ink);overflow:hidden}
.bar{height:56px;border-bottom:2px solid var(--ink);display:flex;align-items:center;gap:12px;padding:0 22px;background:#EFE7D8}
.bar i{width:16px;height:16px;border-radius:50%;border:2px solid var(--ink);display:block}
.bar span{margin-left:16px;font-size:22px;color:var(--sub);font-family:Menlo,monospace}
.pp{font-family:Georgia,"Times New Roman",serif;font-size:31px;line-height:1.75;color:#2b2925;padding:34px 40px}
.pp .sec{font-family:Georgia,serif;font-weight:700;font-size:34px;margin-bottom:12px}
.y{background:var(--hl);border-radius:4px;padding:0 2px}
.g{background:var(--green);border-radius:4px;padding:0 2px}
.wave{text-decoration:underline wavy var(--orange);text-decoration-thickness:3px;text-underline-offset:7px}
.ul{text-decoration:underline var(--blue);text-decoration-thickness:4px;text-underline-offset:8px}
.box{outline:3px solid var(--purple);border-radius:4px;padding:0 3px}
.dot{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;color:#fff;font:700 20px "PingFang SC";vertical-align:4px;margin-left:4px}
.tool{position:absolute;background:var(--ink);color:#fff;border-radius:14px;padding:14px 20px;font-size:26px;display:flex;gap:22px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
.bubble{position:absolute;background:var(--card);border:2px solid var(--ink);border-radius:18px;padding:22px 26px;font-size:26px;line-height:1.6;box-shadow:6px 6px 0 var(--ink)}
.foot{position:absolute;left:80px;right:80px;bottom:64px;display:flex;justify-content:space-between;font-size:26px;color:var(--sub)}
.chip{display:inline-block;border:2px solid var(--ink);border-radius:999px;padding:6px 18px;font-size:24px;margin:0 8px 10px 0;background:var(--card)}
.zh{font-family:"PingFang SC";font-size:28px;line-height:1.7;color:#4a4237;background:#F3EBDD;border-left:5px solid var(--orange);padding:14px 20px;margin:6px 0 22px}
"""

FOOT = '<div class="foot"><span>读论文 · 笔记与答题卡</span><span>开源 · 数据只存本机</span></div>'

P1 = """
<span class="tag">免费开源 · Chrome 插件</span>
<h1>英文论文看不懂<br>划一句，AI<br><span class="mk">结合全文讲给你</span></h1>
<p class="lead">不是逐句翻译：它会读整篇论文，告诉你术语在哪节定义<br>划线永久保存 · 段落下出中文 · 自动生成阅读脑图</p>
<div class="win" style="margin-top:44px;position:relative">
  <div class="bar"><i></i><i></i><i></i><span>arxiv.org/html/…</span></div>
  <div class="pp">
    <div class="sec">3 &nbsp;Method</div>
    Participants (N = 48) completed a visual search task under two load conditions.
    <span class="y">Accuracy dropped sharply when targets shared color with distractors</span><span class="dot" style="background:var(--blue)">✎</span>,
    whereas <span class="wave">the attentional capture effect</span><span class="dot" style="background:var(--orange)">?</span> remained stable across sessions.
  </div>
  <div style="position:absolute;right:0;top:56px;bottom:0;width:22px;background:var(--blue)"></div>
</div>
""" + FOOT

P2 = """
<span class="num">01</span>
<h2>划线、写笔记<br>下次打开还在</h2>
<p class="lead">选中文字弹出小条。7 种颜色 × 4 种样式，<br>鼠标停在划线上就浮出当时写的笔记。</p>
<div class="win" style="margin-top:50px;position:relative;height:640px">
  <div class="bar"><i></i><i></i><i></i><span>nature.com/articles/…</span></div>
  <div class="pp" style="padding-top:120px">
    Prior work suggests that <span class="y">emotional arousal enhances memory for central details</span><span class="dot" style="background:var(--blue)">✎</span>
    but impairs memory for <span class="ul">peripheral information</span>.
    We tested whether <span class="box">this trade-off</span> holds for <span class="g">aesthetic judgments</span>.
  </div>
  <div class="tool" style="left:40px;top:84px"><span>🟨 重要</span><span>🟩 和我有关</span><span>📝 写笔记</span><span>❓ 没看懂</span></div>
  <div class="bubble" style="left:200px;top:400px;width:600px">💬 这个结论可以放进我开题的文献综述，<br>注意它只测了图片材料。</div>
</div>
<div style="margin-top:44px"><span class="chip">🟨 高亮</span><span class="chip">〰 波浪线</span><span class="chip">＿ 下划线</span><span class="chip">▢ 方框</span><span class="chip">🏷 标签</span><span class="chip">⭐ 收藏</span></div>
""" + FOOT

P3 = """
<span class="num">02</span>
<h2>没看懂？<br>直接问 Claude</h2>
<p class="lead">它会带着原句、所在段落和论文相关片段回答，<br>告诉你术语是在哪一节定义的。</p>
<div class="win" style="margin-top:50px;position:relative">
  <div class="bar"><i></i><i></i><i></i><span>arxiv.org/html/…</span></div>
  <div class="pp" style="padding-bottom:20px">
    …whereas <span class="wave">the attentional capture effect</span><span class="dot" style="background:var(--orange)">?</span> remained stable across sessions.
  </div>
  <div style="margin:0 40px 36px;border:2px solid var(--ink);border-radius:18px;padding:24px 28px;font-size:27px;line-height:1.7;background:#FFF8EC">
    <b>🙋 我的问题：</b>capture effect 具体指什么？<br>
    <b>🤖 Claude：</b>指<b>无关但显眼的刺激</b>把注意力“抢走”、导致搜索变慢的现象。论文在 2.1 节把它定义为有干扰物与无干扰物两种条件的反应时之差……
    <div style="margin-top:16px;display:flex;gap:14px"><span class="chip" style="margin:0">继续追问</span><span class="chip" style="margin:0;background:#D9F0CC">✓ 标为已解决</span></div>
  </div>
</div>
<p class="lead" style="margin-top:40px;font-size:30px">用你自己的 Claude 账号；它只回答，不碰你的文件。</p>
""" + FOOT

P4 = """
<span class="num">03</span>
<h2>段落下面<br>直接给中文</h2>
<p class="lead">只翻正文，表格、图注、公式不动。<br>滚到哪翻到哪，翻过的下次秒出。</p>
<div class="win" style="margin-top:50px">
  <div class="bar"><i></i><i></i><i></i><span>🌐 对照翻译 · 已开启</span></div>
  <div class="pp">
    <div class="sec">4 &nbsp;Discussion</div>
    Our findings indicate that perceived complexity, rather than symmetry, predicted preference ratings.
    <div class="zh">我们的结果表明，预测偏好评分的是感知到的复杂度，而不是对称性。</div>
    This pattern was consistent across both cultural samples.
    <div class="zh">这一规律在两个文化样本中都一致。</div>
  </div>
</div>
""" + FOOT

def card(x, y, w, h, color, text, big=False):
    return (f'<div style="position:absolute;left:{x}px;top:{y}px;width:{w}px;height:{h}px;background:var(--card);border:2px solid var(--ink);'
            f'border-left:12px solid {color};border-radius:14px;padding:14px 18px;font-size:{30 if big else 22}px;line-height:1.45;'
            f'font-weight:{800 if big else 400};box-shadow:5px 5px 0 var(--ink)">{text}</div>')

def line(x1, y1, x2, y2):
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#22201C" stroke-width="3"/>'

CANVAS = ('<div style="position:relative;height:720px;margin-top:50px">'
          '<svg width="920" height="720" style="position:absolute;left:0;top:0">'
          + line(230, 360, 300, 130) + line(230, 360, 300, 360) + line(230, 360, 300, 590)
          + line(520, 130, 580, 60) + line(520, 130, 580, 200) + line(520, 360, 580, 360) + line(520, 590, 580, 520) + line(520, 590, 580, 660)
          + '</svg>'
          + card(0, 300, 230, 120, "var(--ink)", "论文标题", True)
          + card(300, 90, 220, 80, "var(--orange)", "<b>Introduction</b><br>引言")
          + card(300, 320, 220, 80, "var(--blue)", "<b>Method</b><br>方法")
          + card(300, 550, 220, 80, "#5BAA45", "<b>Results</b><br>结果")
          + card(580, 10, 340, 100, "var(--orange)", "“Prior work suggests…”<br>✏️ 可以引")
          + card(580, 150, 340, 100, "var(--orange)", "“…remains unclear”<br>✏️ 研究空白")
          + card(580, 310, 340, 100, "var(--blue)", "★ “N = 48, two load…”<br>✏️ 样本量参考")
          + card(580, 470, 340, 100, "#5BAA45", "“Accuracy dropped…”")
          + card(580, 610, 340, 100, "#5BAA45", "“…stable across sessions”")
          + '</div>')

P5 = """
<span class="num">04</span>
<h2>划线自动排成<br>一张阅读脑图</h2>
<p class="lead">论文 → 章节 → 你的划线，按原文顺序排好。<br>点卡片跳回原文那一句，还能导出到 Obsidian。</p>
""" + CANVAS + FOOT

P6 = """
<span class="num">05</span>
<h2>怎么用</h2>
<div style="margin-top:44px;display:flex;flex-direction:column;gap:30px">
""" + "".join(f'''<div style="display:flex;gap:28px;align-items:flex-start;background:var(--card);border:2px solid var(--ink);border-radius:20px;padding:30px 34px;box-shadow:6px 6px 0 var(--ink)">
<div style="font:italic 700 56px Georgia;color:var(--orange);width:50px">{i}</div><div><div style="font-size:38px;font-weight:700">{t}</div><div style="font-size:28px;color:var(--sub);margin-top:10px;line-height:1.55">{d}</div></div></div>'''
    for i, t, d in [
        ("1", "下载仓库", "GitHub 搜 <b>Springfever618/paper-reading-notes</b>"),
        ("2", "运行本机服务", "python3 server/server.py，不用装任何依赖"),
        ("3", "加载插件", "chrome://extensions → 开发者模式 → 加载 extension"),
        ("4", "想问 Claude / 要翻译", "装好 Claude Code 登录一次；翻译填一个 API 密钥"),
    ]) + """
</div>
<div style="margin-top:40px;font-size:30px;line-height:1.7;color:var(--sub)">🔒 笔记、问答、翻译缓存都只存在你自己电脑上<br>💻 Mac / Windows / Linux 都能用，MIT 开源</div>
""" + FOOT

PAGES = [P1, P2, P3, P4, P5, P6]

if __name__ == "__main__":
    for i, body in enumerate(PAGES, 1):
        h = os.path.join(HERE, f"{i:02d}.html")
        open(h, "w", encoding="utf-8").write(f"<!doctype html><meta charset=utf-8><style>{CSS}</style><body>{body}</body>")
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1080,1440",
                        f"--screenshot={os.path.join(HERE, f'{i:02d}.png')}", "file://" + h], capture_output=True)
        os.remove(h)
    print("done")
