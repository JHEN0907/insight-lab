"""
Insight Lab — 後端 API Server
為網頁前端提供 Claude API + Notion API 串接
"""
import os
import sys
import json
import subprocess
import base64
import tempfile
import time
import glob as globmod
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# 載入 .env
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Docker 環境：scripts/ 在同級目錄
_local_scripts = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scripts')
if os.path.exists(_local_scripts):
    sys.path.insert(0, _local_scripts)
_env_path = os.path.join(PROJECT_ROOT, '.env')
if os.path.exists(_env_path):
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')

# ─── Notion 設定 ───
NOTION_TOKEN = os.environ.get('NOTION_TOKEN', '')
NOTION_THREADS_DB = "2d81408d-91fd-807e-8693-cea19edc57ec"
NOTION_IG_DB = "2d81408d-91fd-803c-b46b-fd19cc7dc91b"
NOTION_INSPIRATION_DB = os.environ.get('NOTION_INSPIRATION_DB', '2d81408d-91fd-80a9-a3cb-f09e9a6b8086')
NOTION_HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
}

# ─── Notion API Helpers ───
_notion_cache = {}  # key → (data, timestamp)
CACHE_TTL = 600  # 10 min

def _cache_get(key):
    if key in _notion_cache:
        data, ts = _notion_cache[key]
        if time.time() - ts < CACHE_TTL:
            return data
    return None

def _cache_set(key, data):
    _notion_cache[key] = (data, time.time())

def _cache_clear(prefix=''):
    keys = [k for k in _notion_cache if k.startswith(prefix)]
    for k in keys:
        del _notion_cache[k]

def notion_api(endpoint, payload, method='POST'):
    url = f"https://api.notion.com/v1/{endpoint}"
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=NOTION_HEADERS, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8') if e.fp else ''
        return {"error": True, "message": body[:300]}
    except Exception as e:
        return {"error": True, "message": str(e)}

def notion_patch(endpoint, payload):
    url = f"https://api.notion.com/v1/{endpoint}"
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=NOTION_HEADERS, method='PATCH')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {"error": True, "message": str(e)}

def notion_get(endpoint):
    url = f"https://api.notion.com/v1/{endpoint}"
    req = urllib.request.Request(url, headers=NOTION_HEADERS, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {"error": True, "message": str(e)}

def notion_delete(endpoint):
    url = f"https://api.notion.com/v1/{endpoint}"
    h = {k: v for k, v in NOTION_HEADERS.items() if k != 'Content-Type'}
    req = urllib.request.Request(url, headers=h, method='DELETE')
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass

def _rich_text(arr):
    return ''.join(t.get('plain_text', '') for t in (arr or []))


# ─── 品牌規範（內嵌，確保 Anthropic API 也能使用）───
BRAND_CONTEXT = """
【品牌：@jhen_insightlab — 人生慣性翻譯者】
定位：不教你算命，教你看懂八字裡的自動導航模式，拿回人生主導權。
黃金比例：90% 八字覺察（建立底層邏輯與權威）+ 10% 牌卡指引（提供即時互動與情緒容器）
目標受眾：18-38 歲女性，對八字、改變命運、修行、感情問題有困擾或有興趣。
品牌身份：八字初學者，用「同行者」語氣分享學習觀察，不以老師自居。

【品牌提供的情緒價值】
- 被理解感：「原來不是只有我這樣，原來我沒壞掉。」
- 解釋權：「原來這是有原因的，不是我的錯，是我的防禦機制。」
- 方向感：「我終於知道下一步該怎麼做。」
- 情緒容器：「在這裡，我的混亂能被接住。」
- 自我覺察：「我第一次看懂自己的慣性，我要打破它。」

【核心受眾痛點（選題必須圍繞這些）】
客群1 情感內耗型（核心爆款受眾）：「只是晚回訊息20分鐘，腦中已經演完一場分手劇本」→ 表層：他到底在想什麼？ → 深層：不安全感機制
客群2 焦慮尋覓型：「參加完朋友婚禮，回家打開交友軟體滑了十分鐘又關掉」→ 表層：什麼時候遇到對的人？ → 深層：自我價值低落
客群3 覺醒破局型（未來高單價）：「每隔兩三年遇到同樣的消耗型主管/伴侶」→ 表層：想改變命運 → 深層：自動化決策慣性
客群4 分手療癒型：「分手一個月了看到情侶還是鼻酸」→ 表層：哪裡出了問題？ → 深層：需要結案的框架
客群5 八字好奇者：「朋友都在算命，只有你看不懂自己的命盤」→ 表層：想學但不知從哪開始

【核心精神】
- 八字沒有好壞，十神也沒有，端看光明面還是黑暗面
- 不判斷「吉凶」，用「慣性模式」的角度去看
- 不說「命中注定」，說「看見慣性，就有機會選擇不同」
- 體系是四柱八字（天干地支、十神、五行），不是紫微斗數
- 修行（內在覺察）才是改變命運的根本方法，不靠外在產品

【語氣規則】
- 像朋友聊天，不說教、不武斷
- 極短句為主（1-2 行），大量換行，節奏：短-短-稍長-短
- 慣用語：「其實」「蠻有趣的」「但…」「我發現」「其實不是…而是…」
- 情緒弧線：日常共鳴→個人觀察→深入分析→觀點翻轉→溫暖收尾
- 永遠從「共鳴」開始，不從「知識」開始

【語言】
- ⚠️ 必須使用繁體中文，禁止出現簡體字

【禁忌】
- ❌ 說教口吻（「你應該...」）
- ❌ 販賣焦慮（「再不學就來不及了」）
- ❌ 空泛雞湯（「相信自己就會成功」）
- ❌ 武斷定論（「最怕」「必定坎坷」「吉凶」「注定孤獨」）
- ❌ 紫微斗數術語（空亡、化忌、飛星、煞星）
- ❌ 過多驚嘆號（最多 2-3 個）、Emoji 過多（每篇 3-6 個）
- ❌ 任何開運產品（水晶、煙供、符咒、風水擺設、開運手鍊）
- ❌ 「算命多年」「資深命理師」等老師姿態（目前是初學者）
- ❌ AI 算命、水晶開運等商業風口話題

【寫作技巧 HPC 框架】
H（Hook 開頭）：重點提前/衝突反差/點名受眾/問句破題/情境帶入/數字成效 + 痛點場景開場/金句開場
P（Pacing 段落）：R.E.P. 架構（Reveal 揭示→Explain 闡述→Proof 佐證）
C（CTA 結尾）：餘韻金句/自然問句/懸念式/行動呼籲

【AI 味檢測】
1. 開頭不是陳述句 2. 沒有模板轉折詞 3. 有具體細節 4. 有明確立場 5. 段落長短不一 6. 字數100-300（最多500）
"""


CLAUDE_PATH = '/Users/Sherry/.local/bin/claude'

def run_claude(prompt, timeout=600):
    """呼叫 Claude CLI 生成內容（有 WebSearch + 讀檔能力）
    本機用 CLI，雲端 fallback 到 Anthropic API"""
    # 優先用 Claude CLI（有搜尋能力）
    if os.path.exists(CLAUDE_PATH):
        try:
            result = subprocess.run(
                [
                    CLAUDE_PATH, '-p',
                    '--output-format', 'text',
                    '--allowedTools', 'WebSearch,WebFetch,Read,Glob,Grep',
                    '--', prompt
                ],
                capture_output=True, text=True,
                cwd=PROJECT_ROOT,
                timeout=timeout,
                env={**os.environ, 'CLAUDE_CODE_ENTRYPOINT': 'cli'}
            )
            stdout = result.stdout.strip()
            if stdout:
                # 檢查是否是 API 錯誤
                if any(kw in stdout for kw in ['529', 'overloaded', 'API error', 'rate limit']):
                    print(f"⚠️ Claude CLI API error: {stdout[:200]}", flush=True)
                    return None
                return stdout
            stderr = result.stderr.strip()
            if stderr and not stderr.startswith('Error') and len(stderr) > 50:
                return stderr
            print(f"⚠️ Claude CLI empty output, stderr: {stderr[:200]}", flush=True)
            return None
        except subprocess.TimeoutExpired:
            print("⚠️ Claude CLI timeout", flush=True)
            return None
        except Exception as e:
            print(f"⚠️ Claude CLI error: {e}", flush=True)
            # fallthrough to Anthropic API

    # Fallback: Anthropic API + Web Search（雲端部署用）
    if not ANTHROPIC_API_KEY:
        return None
    try:
        req_data = json.dumps({
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 16000,
            "tools": [
                {
                    "type": "web_search_20250305",
                    "name": "web_search",
                    "max_uses": 5
                }
            ],
            "messages": [{"role": "user", "content": prompt}]
        }).encode('utf-8')
        req = urllib.request.Request(
            'https://api.anthropic.com/v1/messages',
            data=req_data,
            headers={
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            }
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            # 從 content blocks 中提取文字（跳過 tool_use / web_search 結果）
            texts = []
            for block in result.get('content', []):
                if block.get('type') == 'text':
                    texts.append(block.get('text', ''))
            text = '\n'.join(texts).strip()
            return text if text else None
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8')[:500] if e.fp else ''
        print(f"Anthropic API HTTP error {e.code}: {body}", flush=True)
        return None
    except Exception as e:
        print(f"Anthropic API error: {e}", flush=True)
        return None


# ─── Static Files & Health ───

@app.after_request
def add_no_cache(response):
    """靜態檔案不快取，確保更新即時生效"""
    if response.content_type and ('html' in response.content_type or 'javascript' in response.content_type or 'css' in response.content_type):
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
    return response

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/api/health')
def health():
    cli_ok = os.path.exists(CLAUDE_PATH)
    return jsonify({
        'status': 'ok',
        'engine': 'claude-cli' if cli_ok else ('anthropic-api' if ANTHROPIC_API_KEY else 'none'),
        'cli': cli_ok,
        'api_key': bool(ANTHROPIC_API_KEY),
        'notion': bool(NOTION_TOKEN),
        'web_search': True,  # CLI 有 WebSearch，API 也有 web_search tool
    })


# ─── 爆文靈感助手 API ───

@app.route('/api/analyze-viral', methods=['POST'])
def analyze_viral():
    data = request.json or {}
    text = data.get('text', '').strip()
    images = data.get('images', [])  # base64 encoded images

    if not text and not images:
        return jsonify({'error': '請輸入貼文內容或上傳截圖'}), 400

    # 讀取分析框架
    analysis_framework = """你是 Threads 爆文分析專家。請用以下框架分析貼文：

## 分析框架（文字複利計劃）

對每篇貼文分析：
1. **HOOK 開頭公式拆解**：
   - 這是什麼樣的開頭（情境代入型/痛點呼喚型/認知衝突型/數據權威型/故事懸念型）
   - 開頭公式拆解（結構分析）
   - 舉 3 個類似的句子（以八字/塔羅/覺察領域改寫）
   - 一句話解釋為什麼會紅

2. **互動數據**：列出讚/留言/轉發（如有提供）

3. **可直接套用格式**：以 @jhen_insightlab（八字 × 塔羅 × 覺察）的領域，列出 5-8 個可直接套用的文案模板步驟

## 輸出格式
請用 JSON 格式回覆，結構如下：
```json
{
  "total_posts": 數字,
  "analyses": [
    {
      "author": "帳號名稱或摘要",
      "hook_type": "開頭類型",
      "hook_formula": "公式拆解",
      "similar_hooks": ["句子1", "句子2", "句子3"],
      "why_viral": "一句話解釋",
      "likes": "數字或—",
      "comments": "數字或—",
      "reposts": "數字或—",
      "templates": ["步驟1", "步驟2", "..."]
    }
  ]
}
```
只回覆 JSON，不要其他文字。"""

    prompt_parts = [analysis_framework]

    if text:
        prompt_parts.append(f"\n\n## 要分析的貼文內容：\n\n{text}")

    if images:
        prompt_parts.append(f"\n\n（另附 {len(images)} 張截圖，請辨識圖中文字後一併分析）")
        # TODO: 未來可用 Claude vision API 直接分析圖片
        # 目前先提示用戶圖片辨識功能開發中

    prompt = '\n'.join(prompt_parts)
    result = run_claude(prompt)

    if not result:
        return jsonify({'error': 'Claude API 暫時無法回應，請稍後重試'}), 503

    # 嘗試解析 JSON
    try:
        # 移除 markdown code block
        clean = result.strip()
        if clean.startswith('```'):
            clean = clean.split('\n', 1)[1] if '\n' in clean else clean[3:]
        if clean.endswith('```'):
            clean = clean[:-3]
        clean = clean.strip()
        if clean.startswith('json'):
            clean = clean[4:].strip()
        parsed = json.loads(clean)
        return jsonify(parsed)
    except json.JSONDecodeError:
        # 如果無法解析 JSON，返回原始文字
        return jsonify({
            'total_posts': 1,
            'analyses': [{
                'author': '分析結果',
                'hook_type': '—',
                'hook_formula': '—',
                'similar_hooks': [],
                'why_viral': '—',
                'likes': '—', 'comments': '—', 'reposts': '—',
                'templates': [],
                'raw_text': result
            }]
        })


def _ocr_image(base64_image):
    """用 Anthropic Vision API 辨識圖片中的文字"""
    if not ANTHROPIC_API_KEY:
        return None
    try:
        # 提取 media type 和 data
        if ',' in base64_image:
            header, img_data = base64_image.split(',', 1)
            media_type = header.split(';')[0].split(':')[1] if ':' in header else 'image/png'
        else:
            img_data = base64_image
            media_type = 'image/png'

        req_data = json.dumps({
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 1024,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": img_data}},
                    {"type": "text", "text": "請辨識這張圖片中的所有文字內容，用繁體中文輸出。只輸出文字，不要加說明。"}
                ]
            }]
        }).encode('utf-8')
        req = urllib.request.Request(
            'https://api.anthropic.com/v1/messages',
            data=req_data,
            headers={
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            }
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            texts = [b.get('text', '') for b in result.get('content', []) if b.get('type') == 'text']
            return '\n'.join(texts).strip() or None
    except Exception as e:
        print(f"OCR error: {e}", flush=True)
        return None


def _build_attachment_block(attachments):
    """將上傳的附件整理成 prompt 區塊"""
    if not attachments:
        return ""
    parts = []
    for att in attachments:
        name = att.get('name', '')
        atype = att.get('type', '')
        adata = att.get('data', '')
        if atype.startswith('text') or name.endswith('.md') or name.endswith('.txt'):
            parts.append(f"📄 【{name}】\n{adata}")
        elif atype.startswith('image'):
            parts.append(f"🖼️ 【{name}】（圖片已附上，請辨識圖中文字內容）")
        else:
            parts.append(f"📎 【{name}】（{atype}）")
    return "\n━━━ 用戶提供的素材（請統整所有內容） ━━━\n" + "\n\n".join(parts) + "\n━━━ 素材結束 ━━━\n"


# ─── 文案寫作助手 API ───

@app.route('/api/generate-copy', methods=['POST'])
def generate_copy():
    data = request.json or {}
    pillar = data.get('pillar', '八字')
    format_type = data.get('format', '')
    topic = data.get('topic', '')
    attachments = data.get('attachments', [])  # [{name, type, data}]

    if not topic and not format_type:
        return jsonify({'error': '請選擇形式或輸入主題'}), 400

    attachment_block = _build_attachment_block(attachments)

    prompt = f"""你是 @jhen_insightlab 的文案寫手。請根據以下設定生成一篇 Threads 文案。

{BRAND_CONTEXT}

## 設定
- 主題支柱：{pillar}
- 發文形式：{format_type}
- 主題/關鍵字：{topic or '（自由發揮）'}
{attachment_block}
## Step 1：多平台搜尋研究（必做）
請用 WebSearch 搜尋以下內容，確保文案的正確性和爆文潛力：
1. 搜尋「{topic} site:threads.net」— Threads 上的高互動貼文（2-3 篇）
2. 搜尋「{topic} 小紅書」— 小紅書相關熱門內容的寫法和切入角度
3. 搜尋「{topic} IG」— IG 相關討論
4. 分析這些熱門內容的 Hook 手法、段落節奏、轉折技巧、互動設計
5. 確認文案中涉及的事實/知識是否正確（特別是命理知識）
{'6. 仔細閱讀用戶提供的所有素材，統整核心觀點和具體例子，結合搜尋結果生成文案。' if attachments else ''}

## Step 2：讀取品牌規範
- skills/writing-technique/SKILL.md（寫作技巧 + Hook 公式 + AI味檢測）
- brand/brand_voice.md（品牌語氣規則）
- brand/sample_posts/threads_samples.md（範例文）
- 如果主題涉及八字或十神，用 WebSearch 搜尋 fatemaster.ai/zh-Hant/guides/shishen 驗證知識正確性

## Step 3：{'統整素材 + ' if attachments else ''}生成文案
{'⚠️ 重要：你必須保留用戶素材中的核心觀點、具體例子和個人經驗，不可丟棄任何細節。' if attachments else ''}
必須套用：
1. 震撼亮點前移 — 寫完後把最亮的金句搬到第一行
2. 極致壓縮句型 — 每段 ≤ 3 行
3. 餘韻設計 — 結尾引發反思，不用制式 CTA
4. 消滅 AI 感 — emoji 最多 1 個，不用括號
5. 自然植入主題標籤
6. 字數 100-300 字（最多 500）
⚠️ 核心精神：八字沒有好壞、十神也沒有。禁止武斷定論。禁止紫微斗數術語（空亡、化忌、飛星、煞星等）

## 輸出格式
請用 JSON 格式回覆：
```json
{{
  "copy": "完整文案（用 \\n 換行）",
  "techniques_used": ["技巧1", "技巧2"],
  "hook_type": "使用的 Hook 類型",
  "sources": ["參考來源1", "參考來源2"]
}}
```
⚠️ 所有輸出文字必須是繁體中文（簡體字內容必須轉換成繁體）。禁止任何簡體字。只回覆 JSON。"""

    result = run_claude(prompt)
    if not result:
        return jsonify({'error': 'Claude API 暫時無法回應'}), 503

    try:
        clean = result.strip()
        if clean.startswith('```'):
            clean = clean.split('\n', 1)[1]
        if clean.endswith('```'):
            clean = clean[:-3]
        clean = clean.strip()
        if clean.startswith('json'):
            clean = clean[4:].strip()
        return jsonify(json.loads(clean))
    except json.JSONDecodeError:
        return jsonify({'copy': result, 'techniques_used': [], 'hook_type': '—'})


# ─── 流量診斷 API ───

@app.route('/api/diagnose', methods=['POST'])
def diagnose():
    data = request.json or {}
    text = data.get('text', '').strip()

    if not text:
        return jsonify({'error': '請輸入帖文內容'}), 400

    prompt = f"""你是 Threads 流量診斷專家（@jhen_insightlab 的顧問）。請分析以下帖文的表現，並給出改善建議。

分析框架：
1. **開頭評分**（Hook 是否有效？痛點/認知衝突/稀缺感？）
2. **中段結構**（里長伯報好康？情境帶入？具體好處？）
3. **結尾設計**（餘韻？還是制式 CTA？）
4. **演算法友善度**（AI 感？emoji 過多？hashtag？）

## 帖文內容：

{text}

## 輸出格式
請用 JSON 格式：
```json
{{
  "score": 75,
  "opening": "開頭分析...",
  "middle": "中段分析...",
  "ending": "結尾分析...",
  "algorithm": "演算法友善度分析...",
  "improvements": ["改善建議1", "改善建議2", "改善建議3"],
  "rewrite_hint": "如果要改寫，建議方向是..."
}}
```
⚠️ 所有輸出文字必須是繁體中文（簡體字內容必須轉換成繁體）。禁止任何簡體字。只回覆 JSON。"""

    result = run_claude(prompt)
    if not result:
        return jsonify({'error': 'Claude API 暫時無法回應'}), 503

    try:
        clean = result.strip()
        if clean.startswith('```'):
            clean = clean.split('\n', 1)[1]
        if clean.endswith('```'):
            clean = clean[:-3]
        clean = clean.strip()
        if clean.startswith('json'):
            clean = clean[4:].strip()
        return jsonify(json.loads(clean))
    except json.JSONDecodeError:
        return jsonify({'raw_text': result, 'score': 0})


# ─── 河道搜索 API ───

@app.route('/api/search-threads', methods=['POST'])
def search_threads_api():
    data = request.json or {}
    keyword = data.get('keyword', '').strip()
    if not keyword:
        return jsonify({'error': '請輸入搜索關鍵字'}), 400

    try:
        try:
            sys.path.insert(0, os.path.join(PROJECT_ROOT, 'scripts'))
            from threads_crawler import search_threads
        except ImportError:
            return jsonify({'error': '搜索功能需要本機環境（Playwright）'}), 503
        results = search_threads(keyword, max_results=10)

        # 加爆文標記
        for r in results:
            likes = r.get('likes', 0)
            if likes >= 5000:
                r['level'] = '🔥🔥🔥'
            elif likes >= 1000:
                r['level'] = '🔥🔥'
            elif likes >= 100:
                r['level'] = '🔥'
            else:
                r['level'] = ''
            comments = r.get('comments', 0)
            reposts = r.get('reposts', 0)
            r['viral'] = reposts > likes * 0.1 if likes > 0 else False
            r['high_reply'] = comments >= 50

        return jsonify({
            'keyword': keyword,
            'count': len(results),
            'results': results,
        })
    except ImportError:
        return jsonify({'error': 'Playwright 未安裝，無法搜索'}), 503
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── Hook 選項生成 API ───

@app.route('/api/generate-hooks', methods=['POST'])
def generate_hooks():
    data = request.json or {}
    topic = data.get('topic', '').strip()
    pillar = data.get('pillar', '八字')
    if not topic:
        return jsonify({'error': '請輸入主題'}), 400

    prompt = f"""你是 @jhen_insightlab 的文案撰寫助手。

{BRAND_CONTEXT}

主題支柱：{pillar}
主題：{topic}

請先用 WebSearch 搜尋「{topic} site:threads.net」和「{topic} 小紅書」的熱門貼文，學習它們的開頭手法。

請為這個主題生成 4 個不同切入角度的 Hook 開頭。

每個 Hook 必須用不同的開場模式（從以下選 4 種不重複的）：
1. 痛點場景開場 — 直接描述受眾的痛苦畫面（「只是晚回訊息20分鐘，腦中已經演完分手劇本」）
2. 衝突反差 — 「大家都以為A，但其實是B」
3. 點名受眾 — 「給那些每天查運勢的女生：」
4. 問句破題 — 一個讓人停下來的問題
5. 情境代入 — 先讓讀者進入一個具體場景
6. 結論先行反轉 — 先給答案再說「但…」
7. 懸念型反問 — 「你以為你在談戀愛？其實你正在被改變」
8. 金句開場 — 一句帶走的感悟直接放第一行

⚠️ 重要：
- 品牌身份是八字初學者，不要用「算命多年」「資深命理師」等姿態
- 不要提開運產品（水晶、煙供等）
- 圍繞受眾痛點：感情內耗/脫單焦慮/人生重複模式/分手療癒/八字好奇
- 每個 Hook 寫 2-3 行，語氣像朋友聊天、極短句、口語化
- 禁止虛構個人經歷開頭

用 JSON 回覆：
```json
{{
  "hooks": [
    {{"formula": "公式名稱", "text": "開頭文字（用 \\n 換行）"}},
    {{"formula": "公式名稱", "text": "開頭文字"}},
    {{"formula": "公式名稱", "text": "開頭文字"}},
    {{"formula": "公式名稱", "text": "開頭文字"}}
  ]
}}
```
⚠️ 所有輸出文字必須是繁體中文（簡體字內容必須轉換成繁體）。禁止任何簡體字。只回覆 JSON。"""

    result = run_claude(prompt)
    if not result:
        return jsonify({'error': 'Claude API 暫時無法回應'}), 503

    try:
        clean = result.strip()
        if clean.startswith('```'):
            clean = clean.split('\n', 1)[1]
        if clean.endswith('```'):
            clean = clean[:-3]
        clean = clean.strip()
        if clean.startswith('json'):
            clean = clean[4:].strip()
        return jsonify(json.loads(clean))
    except json.JSONDecodeError:
        return jsonify({'hooks': [{'formula': '自動生成', 'text': result[:200]}]})


# ─── 用選定 Hook 生成完整文案 API ───

@app.route('/api/generate-with-hook', methods=['POST'])
def generate_with_hook():
    data = request.json or {}
    topic = data.get('topic', '').strip()
    pillar = data.get('pillar', '八字')
    hook = data.get('hook', '').strip()
    format_type = data.get('format', '')
    attachments = data.get('attachments', [])

    if not topic or not hook:
        return jsonify({'error': '缺少主題或 Hook'}), 400

    prompt = f"""你是 @jhen_insightlab 的文案寫手。請根據以下設定生成一篇 Threads 文案。

{BRAND_CONTEXT}

## 設定
- 主題支柱：{pillar}
- 發文形式：{format_type}
- 主題/關鍵字：{topic}
{_build_attachment_block(attachments)}
## Step 1：多平台搜尋研究（必做）
1. 搜尋「{topic} site:threads.net」— Threads 高互動貼文
2. 搜尋「{topic} 小紅書」— 小紅書熱門寫法
3. 搜尋「{topic}」— 其他平台相關討論
4. 確認涉及的事實/知識正確性
{'5. 統整用戶提供的所有素材核心觀點和例子。' if attachments else ''}

## Step 2：讀取規範
- skills/writing-technique/SKILL.md（寫作技巧）
- brand/brand_voice.md（品牌語氣）
- brand/sample_posts/threads_samples.md（範例文）
- 如果涉及八字或十神，必讀 research/bazi-shishen-reference.md

## 必須使用的 Hook 開頭（原封不動使用，不可改寫）

{hook}

## Step 3：{'統整素材 + ' if attachments else ''}生成文案
{'⚠️ 保留用戶素材中的核心觀點和具體例子。' if attachments else ''}開頭已確定，直接接續中段和結尾。套用：
1. R.E.P. 架構（Reveal → Explain → Proof）
2. 極致壓縮句型 — 每段 ≤ 3 行
3. 餘韻設計 — 結尾引發反思
4. 消滅 AI 感
5. 字數 100-300 字（最多 500）
6. 結尾加品牌 hashtag
⚠️ 核心精神：八字沒有好壞。禁止紫微斗數術語（空亡、化忌、飛星、煞星等）

## 輸出格式
用 JSON 回覆：
```json
{{
  "copy": "完整文案（用 \\n 換行）",
  "techniques_used": ["技巧1", "技巧2"],
  "hook_type": "使用的 Hook 類型",
  "sources": ["參考來源1"]
}}
```
⚠️ 所有輸出文字必須是繁體中文（簡體字內容必須轉換成繁體）。禁止任何簡體字。只回覆 JSON。"""

    result = run_claude(prompt)
    if not result:
        return jsonify({'error': 'Claude API 暫時無法回應'}), 503

    try:
        clean = result.strip()
        if clean.startswith('```'):
            clean = clean.split('\n', 1)[1]
        if clean.endswith('```'):
            clean = clean[:-3]
        clean = clean.strip()
        if clean.startswith('json'):
            clean = clean[4:].strip()
        return jsonify(json.loads(clean))
    except json.JSONDecodeError:
        return jsonify({'copy': result, 'techniques_used': [], 'hook_type': '—'})


# ─── 文案查核 API ───

@app.route('/api/review-copy', methods=['POST'])
def review_copy():
    data = request.json or {}
    copy = data.get('copy', '').strip()
    topic = data.get('topic', '')

    if not copy:
        return jsonify({'error': '請提供文案內容'}), 400

    prompt = f"""你是 @jhen_insightlab 的文案查核助手。請對以下文案做最終查核。

{BRAND_CONTEXT}

主題：{topic}

文案：
{copy}

查核項目：
1. 事實查核 — 如果涉及八字/十神知識，請用 WebSearch 搜尋 https://www.fatemaster.ai/zh-Hant/guides/shishen 驗證十神定義和特質是否正確。同時搜尋其他命理網站交叉驗證。有無混用紫微斗數術語？有無武斷定論？
2. AI 味檢測 — 開頭是否陳述句？有無模板轉折詞？有無具體細節？有無明確立場？
3. 亮點檢查 — 最亮句是否夠前面？結尾是否有力？有無觀點翻轉？
4. 品牌風格 — 語氣像朋友聊天？有無說教口吻？字數是否適中？
5. 內容正確性 — 用 WebSearch 搜尋文案中提到的概念/事實，確認是否正確。

用 JSON 回覆：
```json
{{
  "passed": ["通過項目1", "通過項目2"],
  "warnings": ["建議調整1（含原因和改法）"],
  "errors": ["必須修正1（含原因和改法）"],
  "highlights": ["文案亮點1"],
  "suggestion": "修正後的完整文案（如全部通過則為空字串）"
}}
```
⚠️ 所有輸出文字必須是繁體中文（簡體字內容必須轉換成繁體）。禁止任何簡體字。只回覆 JSON。"""

    result = run_claude(prompt)
    if not result:
        return jsonify({'error': 'Claude API 暫時無法回應'}), 503

    try:
        clean = result.strip()
        if clean.startswith('```'):
            clean = clean.split('\n', 1)[1]
        if clean.endswith('```'):
            clean = clean[:-3]
        clean = clean.strip()
        if clean.startswith('json'):
            clean = clean[4:].strip()
        return jsonify(json.loads(clean))
    except json.JSONDecodeError:
        return jsonify({'passed': [], 'warnings': [], 'errors': [], 'highlights': [], 'suggestion': '', 'raw': result})


# ─── Notion: 靈感庫 CRUD ───

@app.route('/api/inspirations', methods=['GET'])
def get_inspirations():
    cached = _cache_get('inspirations')
    if cached:
        return jsonify(cached)
    if not NOTION_TOKEN:
        return jsonify({'items': [], 'source': 'no_token'})
    payload = {
        "sorts": [{"timestamp": "created_time", "direction": "descending"}],
        "page_size": 50,
    }
    result = notion_api(f"databases/{NOTION_INSPIRATION_DB}/query", payload)
    if result.get('error'):
        return jsonify({'items': [], 'error': result.get('message', '')}), 503
    items = []
    for page in result.get('results', []):
        props = page.get('properties', {})
        title = _rich_text(props.get('Name', {}).get('title', []))
        pillar_sel = props.get('支柱', {}).get('select')
        status_sel = props.get('狀態', {}).get('select')
        source_sel = props.get('來源', {}).get('select')
        items.append({
            'id': page['id'],
            'title': title,
            'pillar': pillar_sel.get('name', '') if pillar_sel else '',
            'status': status_sel.get('name', '') if status_sel else '',
            'source': source_sel.get('name', '') if source_sel else '',
            'created': page.get('created_time', '')[:10],
        })
    data = {'items': items}
    _cache_set('inspirations', data)
    return jsonify(data)


@app.route('/api/inspirations', methods=['POST'])
def create_inspiration():
    data = request.json or {}
    text = data.get('text', '').strip()
    tag = data.get('tag', '未分類')
    image = data.get('image', '')  # base64 image for OCR

    # 如果有圖片，用 AI 辨識文字
    if image and not text:
        ocr_result = _ocr_image(image)
        if ocr_result:
            text = ocr_result

    if not text:
        return jsonify({'error': '請輸入靈感內容'}), 400
    if not NOTION_TOKEN:
        return jsonify({'error': 'Notion 未設定'}), 503
    today = datetime.now().strftime('%Y-%m-%d')
    props = {
        "Name": {"title": [{"text": {"content": text[:100]}}]},
        "狀態": {"select": {"name": "待處理"}},
        "建立日期": {"date": {"start": today}},
        "來源": {"select": {"name": "網站"}},
    }
    if tag and tag != '未分類':
        props["支柱"] = {"select": {"name": tag}}
    blocks = []
    if len(text) > 100:
        chunks = [text[i:i+1900] for i in range(0, len(text), 1900)]
        for chunk in chunks:
            blocks.append({"object": "block", "type": "paragraph", "paragraph": {
                "rich_text": [{"type": "text", "text": {"content": chunk}}]
            }})
    payload = {"parent": {"database_id": NOTION_INSPIRATION_DB}, "properties": props}
    if blocks:
        payload["children"] = blocks
    result = notion_api("pages", payload)
    _cache_clear('inspirations')
    if result.get('error'):
        return jsonify({'error': result.get('message', '儲存失敗')}), 500
    return jsonify({'id': result.get('id', ''), 'ok': True})


@app.route('/api/inspirations/<page_id>', methods=['DELETE'])
def delete_inspiration(page_id):
    if not NOTION_TOKEN:
        return jsonify({'error': 'Notion 未設定'}), 503
    notion_patch(f"pages/{page_id}", {"archived": True})
    _cache_clear('inspirations')
    return jsonify({'ok': True})


@app.route('/api/inspirations/<page_id>/tag', methods=['PATCH'])
def update_inspiration_tag(page_id):
    if not NOTION_TOKEN:
        return jsonify({'error': 'Notion 未設定'}), 503
    data = request.json or {}
    tag = data.get('tag', '')
    props = {}
    if tag and tag != '未分類':
        props["支柱"] = {"select": {"name": tag}}
    else:
        props["支柱"] = {"select": None}
    notion_patch(f"pages/{page_id}", {"properties": props})
    _cache_clear('inspirations')
    return jsonify({'ok': True})


# ─── Notion: 內容清單 ───

@app.route('/api/content-list', methods=['GET'])
def get_content_list():
    status_filter = request.args.get('status', '')
    db = request.args.get('db', 'threads')
    db_id = NOTION_THREADS_DB if db == 'threads' else NOTION_IG_DB

    cache_key = f'content_{db}_{status_filter}'
    cached = _cache_get(cache_key)
    if cached:
        return jsonify(cached)
    if not NOTION_TOKEN:
        return jsonify({'items': []})

    payload = {
        "sorts": [{"timestamp": "created_time", "direction": "descending"}],
        "page_size": 50,
    }
    if status_filter:
        payload["filter"] = {"property": "狀態", "select": {"equals": status_filter}}
    result = notion_api(f"databases/{db_id}/query", payload)
    if result.get('error'):
        return jsonify({'items': [], 'error': result.get('message', '')}), 503
    items = []
    for page in result.get('results', []):
        props = page.get('properties', {})
        title = _rich_text(props.get('Name', {}).get('title', []))
        pillar_sel = props.get('支柱', {}).get('select')
        status_sel = props.get('狀態', {}).get('select')
        date_prop = props.get('建立日期', {}).get('date')
        items.append({
            'id': page['id'],
            'title': title,
            'pillar': pillar_sel.get('name', '') if pillar_sel else '',
            'status': status_sel.get('name', '') if status_sel else '',
            'date': date_prop.get('start', '') if date_prop else page.get('created_time', '')[:10],
            'url': page.get('url', ''),
        })
    data = {'items': items}
    _cache_set(cache_key, data)
    return jsonify(data)


@app.route('/api/save-content', methods=['POST'])
def save_content():
    data = request.json or {}
    title = data.get('title', '').strip()
    content = data.get('content', '').strip()
    pillar = data.get('pillar', '')
    status = data.get('status', '草稿-50%')
    db = data.get('db', 'threads')
    if not title or not content:
        return jsonify({'error': '需要標題和內容'}), 400
    if not NOTION_TOKEN:
        return jsonify({'error': 'Notion 未設定'}), 503

    db_id = NOTION_THREADS_DB if db == 'threads' else NOTION_IG_DB
    today = datetime.now().strftime('%Y-%m-%d')
    props = {
        "Name": {"title": [{"text": {"content": title}}]},
        "狀態": {"select": {"name": status}},
        "建立日期": {"date": {"start": today}},
    }
    if pillar:
        props["支柱"] = {"select": {"name": pillar}}
    blocks = []
    chunks = [content[i:i+1900] for i in range(0, len(content), 1900)]
    for chunk in chunks:
        blocks.append({"object": "block", "type": "paragraph", "paragraph": {
            "rich_text": [{"type": "text", "text": {"content": chunk}}]
        }})
    payload = {"parent": {"database_id": db_id}, "properties": props, "children": blocks}
    result = notion_api("pages", payload)
    _cache_clear('content_')
    if result.get('error'):
        return jsonify({'error': result.get('message', '')}), 500
    return jsonify({'id': result.get('id', ''), 'ok': True})


# ─── Notion: 排程 CRUD ───

@app.route('/api/schedule', methods=['GET'])
def get_schedule():
    cached = _cache_get('schedule')
    if cached:
        return jsonify(cached)
    if not NOTION_TOKEN:
        return jsonify({'items': []})
    # 查詢未來 14 天有排程日期的文案
    today = datetime.now().strftime('%Y-%m-%d')
    future = (datetime.now() + timedelta(days=14)).strftime('%Y-%m-%d')
    payload = {
        "filter": {
            "and": [
                {"property": "發文日期", "date": {"on_or_after": today}},
                {"property": "發文日期", "date": {"on_or_before": future}},
            ]
        },
        "sorts": [{"property": "發文日期", "direction": "ascending"}],
        "page_size": 50,
    }
    result = notion_api(f"databases/{NOTION_THREADS_DB}/query", payload)
    items = []
    if not result.get('error'):
        for page in result.get('results', []):
            props = page.get('properties', {})
            title = _rich_text(props.get('Name', {}).get('title', []))
            date_prop = props.get('發文日期', {}).get('date')
            time_prop = props.get('發文時間', {})
            status_sel = props.get('狀態', {}).get('select')
            items.append({
                'id': page['id'],
                'title': title,
                'date': date_prop.get('start', '') if date_prop else '',
                'time': _rich_text(time_prop.get('rich_text', [])) if time_prop else '',
                'status': status_sel.get('name', '') if status_sel else '',
            })
    data = {'items': items}
    _cache_set('schedule', data)
    return jsonify(data)


@app.route('/api/schedule', methods=['POST'])
def create_schedule():
    data = request.json or {}
    title = data.get('title', '').strip()
    date = data.get('date', '').strip()
    time_str = data.get('time', '20:00')
    content = data.get('content', '')
    pillar = data.get('pillar', '')
    if not title or not date:
        return jsonify({'error': '需要標題和日期'}), 400
    if not NOTION_TOKEN:
        return jsonify({'error': 'Notion 未設定'}), 503
    props = {
        "Name": {"title": [{"text": {"content": title}}]},
        "狀態": {"select": {"name": "待發文"}},
        "發文日期": {"date": {"start": date}},
        "建立日期": {"date": {"start": datetime.now().strftime('%Y-%m-%d')}},
    }
    if time_str:
        props["發文時間"] = {"rich_text": [{"type": "text", "text": {"content": time_str}}]}
    if pillar:
        props["支柱"] = {"select": {"name": pillar}}
    blocks = []
    if content:
        chunks = [content[i:i+1900] for i in range(0, len(content), 1900)]
        for chunk in chunks:
            blocks.append({"object": "block", "type": "paragraph", "paragraph": {
                "rich_text": [{"type": "text", "text": {"content": chunk}}]
            }})
    payload = {"parent": {"database_id": NOTION_THREADS_DB}, "properties": props}
    if blocks:
        payload["children"] = blocks
    result = notion_api("pages", payload)
    _cache_clear('schedule')
    if result.get('error'):
        return jsonify({'error': result.get('message', '')}), 500
    return jsonify({'id': result.get('id', ''), 'ok': True})


@app.route('/api/schedule/<page_id>', methods=['DELETE'])
def delete_schedule(page_id):
    if not NOTION_TOKEN:
        return jsonify({'error': 'Notion 未設定'}), 503
    notion_patch(f"pages/{page_id}", {"archived": True})
    _cache_clear('schedule')
    return jsonify({'ok': True})


# ─── 爆款牆：從 data/*.json 讀取（由 trending_analyzer.py 產生）───

def _load_trending_json(category):
    """從 web/data/trending_*.json 讀取分析結果"""
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
    filepath = os.path.join(data_dir, f'trending_{category}.json')
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return None

@app.route('/api/trending', methods=['GET'])
def get_trending():
    # 從本地 JSON 檔案讀取（由 Claude CLI 分析產生）
    data = _load_trending_json('all')
    if data and data.get('items'):
        return jsonify(data)

    items = []

    # 方法 2：從 research/crawl-results/ 讀取本地爬文結果
    crawl_dir = os.path.join(PROJECT_ROOT, 'research', 'crawl-results')
    if os.path.exists(crawl_dir):
        files = sorted(globmod.glob(os.path.join(crawl_dir, '*.md')), key=os.path.getmtime, reverse=True)
        for fp in files[:5]:
            try:
                with open(fp, 'r', encoding='utf-8') as f:
                    content = f.read()
                posts = _parse_crawl_results(content, os.path.basename(fp))
                items.extend(posts)
            except Exception:
                continue

    # 去重（按文字前 50 字）+ 按 likes 排序
    seen = set()
    unique = []
    for item in items:
        key = (item.get('text', '')[:50])
        if key not in seen:
            seen.add(key)
            unique.append(item)
    unique.sort(key=lambda x: x.get('likes', 0), reverse=True)
    unique = unique[:30]
    data = {'items': unique, 'updated': datetime.now().strftime('%Y-%m-%d %H:%M')}
    _cache_set('trending', data)
    return jsonify(data)


def _search_trending_posts():
    """Step 1: Playwright 登入爬 Threads → Step 2: AI 分析 + 搜其他平台"""

    # ── Step 1: Playwright 爬 Threads（登入模式）──
    crawler_posts = []
    try:
        sys.path.insert(0, os.path.join(PROJECT_ROOT, 'scripts'))
        from threads_crawler import search_threads
        for kw in ['\u516b\u5b57', '\u5854\u7f85 \u547d\u7406', '\u5fc3\u7406\u5b78 \u611f\u60c5']:
            results = search_threads(kw, max_results=5)
            for r in results:
                crawler_posts.append({
                    'author': r.get('source', '').replace('@', ''),
                    'text': r.get('text', '')[:200],
                    'likes': r.get('likes', 0),
                    'comments': r.get('comments', 0),
                    'reposts': r.get('reposts', 0),
                    'platform': 'threads',
                    'cat': 'my' if any(k in r.get('text', '') for k in ['\u516b\u5b57', '\u5341\u795e', '\u547d\u7406', '\u547d\u76e4']) else 'cross',
                })
        print(f"\U0001f50d Playwright \u722c\u5230 {len(crawler_posts)} \u7bc7 Threads", flush=True)
    except Exception as e:
        print(f"\u26a0\ufe0f Playwright \u5931\u6557: {e}", flush=True)

    # ── Step 2: AI 分析爬蟲結果 + 搜其他平台 ──
    threads_block = ""
    if crawler_posts:
        threads_block = "\u4ee5\u4e0b\u662f\u5df2\u5f9e Threads \u722c\u5230\u7684\u8cbc\u6587\uff0c\u8acb\u70ba\u6bcf\u7bc7\u88dc\u4e0a hook\u3001why\u3001apply \u5206\u6790\uff1a\n"
        for i, p in enumerate(crawler_posts):
            threads_block += f"\n\u2500 \u7b2c{i+1}\u7bc7\uff1a@{p['author']}\uff08\u2764\ufe0f{p['likes']} \u00b7 \ud83d\udcac{p['comments']} \u00b7 \ud83d\udd04{p['reposts']}\uff09\n\u5167\u5bb9\uff1a{p['text'][:150]}\n"

    step1_general = ('1. 為上面 ' + str(len(crawler_posts)) + ' 篇 Threads 貼文補上 hook/why/apply 分析') if crawler_posts else '1. 搜尋「八字 threads」「塔羅 threads」「心理學 threads」各找 3 篇'
    prompt = threads_block + """
品牌：@jhen_insightlab（八字覺察 × 牌卡指引）
受眾痛點：情感內耗型、焦慮尋覓型、覺醒破局型、分手療癒型、八字好奇者

請完成：
""" + step1_general + """
2. 搜尋「八字 小紅書」找 3 篇
3. 搜尋「心理學 感情 IG」找 2 篇

合併輸出，每篇必須包含：
author, text(前200字繁體中文), likes, comments, reposts, level(🔥等級), cat(my/cross), platform(threads/xiaohongshu/ig), hook(Hook拆解), why(爆文原因), apply(套用建議)

⚠️ 簡體字全部轉繁體。至少 8 篇。按互動量排序。只回覆 JSON：
{"posts": [...]}"""

    result = run_claude(prompt, timeout=180)
    all_posts = []
    if result:
        try:
            clean = result.strip()
            if clean.startswith('```'): clean = clean.split('\n', 1)[1]
            if clean.endswith('```'): clean = clean[:-3]
            clean = clean.strip()
            if clean.startswith('json'): clean = clean[4:].strip()
            parsed = json.loads(clean)
            all_posts = parsed.get('posts', [])
        except (json.JSONDecodeError, KeyError):
            # AI 分析失敗，至少回傳原始爬蟲結果
            all_posts = crawler_posts

    # 如果 AI 沒回傳或太少，補上原始爬蟲結果
    if len(all_posts) < len(crawler_posts):
        all_posts = crawler_posts

    for p in all_posts:
        likes = p.get('likes', 0)
        if not p.get('level'):
            p['level'] = '\U0001f525\U0001f525\U0001f525' if likes >= 5000 else '\U0001f525\U0001f525' if likes >= 1000 else '\U0001f525' if likes >= 100 else ''
    return all_posts


def _parse_crawl_results(content, filename):
    """解析 crawl-results/*.md 中的貼文資料"""
    import re
    posts = []
    # 嘗試按 --- 或 ## 分段
    sections = re.split(r'\n---\n|\n## ', content)
    for section in sections:
        section = section.strip()
        if len(section) < 20:
            continue
        # 提取 likes/comments
        likes_m = re.search(r'[❤️♥👍🔥]\s*(\d[\d,.]*)', section)
        comments_m = re.search(r'[💬留言]\s*(\d[\d,.]*)', section)
        reposts_m = re.search(r'[🔄轉發分享]\s*(\d[\d,.]*)', section)
        likes = int(likes_m.group(1).replace(',', '')) if likes_m else 0
        comments = int(comments_m.group(1).replace(',', '')) if comments_m else 0
        reposts = int(reposts_m.group(1).replace(',', '')) if reposts_m else 0
        # 提取帳號
        author_m = re.search(r'@(\w+)', section)
        author = author_m.group(1) if author_m else ''
        # 提取文字（前 200 字）
        text_lines = [l for l in section.split('\n') if l.strip() and not l.startswith('#') and not re.match(r'^[❤️♥👍💬🔄🔥]', l.strip())]
        text = '\n'.join(text_lines[:5])[:200]
        if not text or likes < 10:
            continue
        # 爆文等級
        level = '🔥🔥🔥' if likes >= 5000 else '🔥🔥' if likes >= 1000 else '🔥' if likes >= 100 else ''
        # 分類
        cat = 'my' if any(kw in section for kw in ['八字', '十神', '命理', '塔羅']) else 'cross'
        posts.append({
            'author': author,
            'text': text,
            'likes': likes,
            'comments': comments,
            'reposts': reposts,
            'level': level,
            'cat': cat,
            'source': filename,
        })
    return posts


# ─── 看劇說八字 API ───

@app.route('/api/drama-bazi', methods=['POST'])
def drama_bazi():
    cached = _cache_get('drama_bazi')
    if cached:
        return jsonify(cached)

    prompt = f"""你是 @jhen_insightlab 的「看劇說八字」選題助手。

請用 web_search 搜尋以下內容：
1. 搜尋「2026 熱門台劇」「2026 熱門韓劇」「Netflix 熱門」找出最近 3 個月最熱門的 8 部劇
2. 搜尋每部劇的角色分析、人物特質
3. 分析哪些角色的性格特質可以對應到八字十神

參考我的已發布文章風格：用角色的行為特質去對應十神，例如「賀子秋的決斷力 → 七殺的典型」。
重點是根據角色的人物特質去看像是哪一個十神，要有具體對應。

每部劇提供：
- title: 劇名
- heat: 熱度（🔥🔥🔥/🔥🔥/🔥）
- angles: 2-3 個八字切入角度（陣列），格式「角色名 → 十神特質描述」
- ref: 已有的八字/命理影評摘要（搜尋到的話填入，沒有寫空字串）

{BRAND_CONTEXT}

⚠️ 必須使用繁體中文，禁止簡體字。用 JSON 回覆：
```json
{{"dramas": [8部]}}
```
只回覆 JSON。"""

    result = run_claude(prompt, timeout=120)
    if not result:
        return jsonify({'dramas': [], 'error': 'AI 搜尋暫時無法回應'}), 503
    try:
        clean = result.strip()
        if clean.startswith('```'): clean = clean.split('\n', 1)[1]
        if clean.endswith('```'): clean = clean[:-3]
        clean = clean.strip()
        if clean.startswith('json'): clean = clean[4:].strip()
        data = json.loads(clean)
        _cache_set('drama_bazi', data)
        return jsonify(data)
    except (json.JSONDecodeError, KeyError):
        return jsonify({'dramas': [], 'raw': result})


# ─── 輪播生圖 API ───

# 輪播 session 暫存（in-memory）
_carousel_sessions = {}

@app.route('/api/carousel-split', methods=['POST'])
def carousel_split():
    """文案 → 輪播文案拆頁"""
    data = request.json or {}
    text = data.get('text', '').strip()
    if not text:
        return jsonify({'error': '請輸入文案'}), 400

    char_count = len(text)
    mode = 'expand' if char_count < 300 else 'direct'
    prompt = f"""你是輪播文案拆頁專家。請將以下文案拆成輪播格式。

{'這是短文（< 300 字），請擴寫補充細節後再拆頁' if mode == 'expand' else '這是完整文案，直接按原文拆頁，不要擴寫'}

規則：
1. 第 1 頁是封面：只有一個吸睛標題（≤ 8 字）
2. 中間頁：每頁一個重點，標題 ≤ 8 字 + 內容
3. 最後一頁：收尾 + CTA
4. 頁數 4-10 頁，根據內容調整
5. 必須直接使用原文的文字，禁止改寫

文案：
{text}

用以下格式輸出：
【第 1 頁】封面
標題：xxx

【第 2 頁】
標題：xxx
內容：xxx

...以此類推"""

    result = run_claude(prompt)
    if not result:
        return jsonify({'error': 'Claude API 暫時無法回應'}), 503

    # 建立 session
    import uuid
    session_id = str(uuid.uuid4())[:8]
    _carousel_sessions[session_id] = {
        'raw_split': result,
        'original_text': text,
        'created': time.time(),
    }
    return jsonify({'session_id': session_id, 'split_result': result})


@app.route('/api/carousel-layout', methods=['POST'])
def carousel_layout():
    """輪播文案 → 版面結構分析"""
    data = request.json or {}
    session_id = data.get('session_id', '')
    carousel_text = data.get('carousel_text', '').strip()

    if not carousel_text:
        # 嘗試從 session 取
        session = _carousel_sessions.get(session_id, {})
        carousel_text = session.get('raw_split', '')
    if not carousel_text:
        return jsonify({'error': '缺少輪播文案'}), 400

    prompt = f"""你是輪播版面設計師。請分析以下輪播文案，為每一頁指定版面類型。

輪播文案：
{carousel_text}

可用版面類型：
- cover（封面）
- narrative（敘述型：標題 + 長文）
- step_flow（流程型：2-3 個步驟，只用在明確的 1→2→3 步驟）
- bazi_compare（對比型：左右兩欄比較）
- closing（收尾頁）

用 JSON 回覆：
```json
{{
  "pages": [
    {{"page": 1, "type": "cover", "title": "標題", "content": ""}},
    {{"page": 2, "type": "narrative", "title": "標題", "content": "內容"}},
    ...
  ]
}}
```
⚠️ 所有輸出文字必須是繁體中文（簡體字內容必須轉換成繁體）。禁止任何簡體字。只回覆 JSON。"""

    result = run_claude(prompt)
    if not result:
        return jsonify({'error': 'Claude API 暫時無法回應'}), 503

    try:
        clean = result.strip()
        if clean.startswith('```'): clean = clean.split('\n', 1)[1]
        if clean.endswith('```'): clean = clean[:-3]
        clean = clean.strip()
        if clean.startswith('json'): clean = clean[4:].strip()
        layout = json.loads(clean)
        if session_id and session_id in _carousel_sessions:
            _carousel_sessions[session_id]['layout'] = layout
        return jsonify(layout)
    except json.JSONDecodeError:
        return jsonify({'error': '版面分析解析失敗', 'raw': result}), 500


@app.route('/api/carousel-render', methods=['POST'])
def carousel_render():
    """版面結構 → Playwright 渲染 PNG"""
    data = request.json or {}
    pages = data.get('pages', [])
    topic = data.get('topic', 'carousel')
    session_id = data.get('session_id', '')

    if not pages:
        session = _carousel_sessions.get(session_id, {})
        layout = session.get('layout', {})
        pages = layout.get('pages', [])
    if not pages:
        return jsonify({'error': '缺少版面結構'}), 400

    try:
        sys.path.insert(0, os.path.join(PROJECT_ROOT, 'scripts'))
        from html_carousel import render_carousel_html
        import asyncio

        # 建立輸出目錄
        output_dir = os.path.join(PROJECT_ROOT, 'output', 'web-carousel', session_id or 'temp')
        os.makedirs(output_dir, exist_ok=True)

        # 執行渲染
        loop = asyncio.new_event_loop()
        generated = loop.run_until_complete(render_carousel_html(
            pages=pages,
            topic=topic,
            template='editorial_serif_wash',
            output_dir=output_dir,
            brand_mark="JHEN'S INSIGHT LAB",
        ))
        loop.close()

        # 回傳圖片路徑
        image_urls = []
        for path in generated:
            filename = os.path.basename(path)
            rel = os.path.relpath(path, PROJECT_ROOT)
            image_urls.append({
                'filename': filename,
                'path': rel,
                'url': f'/api/carousel-image/{session_id or "temp"}/{filename}',
            })

        if session_id and session_id in _carousel_sessions:
            _carousel_sessions[session_id]['images'] = generated

        return jsonify({'images': image_urls, 'count': len(image_urls)})
    except ImportError as e:
        return jsonify({'error': f'Playwright 未安裝：{e}'}), 503
    except Exception as e:
        return jsonify({'error': f'渲染失敗：{str(e)}'}), 500


@app.route('/api/carousel-image/<session_id>/<filename>')
def carousel_image(session_id, filename):
    """提供渲染的輪播圖片"""
    img_dir = os.path.join(PROJECT_ROOT, 'output', 'web-carousel', session_id)
    return send_from_directory(img_dir, filename)


# ─── 八字命理爆文搜尋 ───

@app.route('/api/bazi-trending', methods=['GET'])
def get_bazi_trending():
    # 優先從本地 JSON 讀取
    data = _load_trending_json('bazi')
    if data and data.get('items'):
        return jsonify(data)
    # fallback
    sub = request.args.get('sub', 'all')
    cache_key = f'bazi_trending_{sub}'
    cached = _cache_get(cache_key)
    if cached:
        return jsonify(cached)
    return jsonify({'items': [], 'error': '請先在本機執行 python3 scripts/trending_analyzer.py -c bazi'})
    keywords = {
        'all': '八字 命理 十神 感情',
        'shishen': '十神 七殺 食神 正財 偏印',
        'love': '八字 感情 夫妻宮 姻緣',
        'fate': '八字 改運 命運 覺察 慣性',
    }
    kw = keywords.get(sub, keywords['all'])

    # Step 1: Playwright 爬 Threads
    crawler_posts = []
    try:
        sys.path.insert(0, os.path.join(PROJECT_ROOT, 'scripts'))
        from threads_crawler import search_threads
        results = search_threads(kw, max_results=8)
        for r in results:
            crawler_posts.append({
                'author': r.get('source', '').replace('@', ''),
                'text': r.get('text', '')[:200],
                'likes': r.get('likes', 0),
                'comments': r.get('comments', 0),
                'reposts': r.get('reposts', 0),
                'platform': 'threads',
            })
        print(f"\U0001f50d \u516b\u5b57\u7206\u6587 Playwright \u722c\u5230 {len(crawler_posts)} \u7bc7", flush=True)
    except Exception as e:
        print(f"\u26a0\ufe0f Playwright \u5931\u6557: {e}", flush=True)

    # Step 2: AI 分析 + 搜其他平台
    threads_block = ""
    if crawler_posts:
        threads_block = "\u4ee5\u4e0b\u662f\u5df2\u5f9e Threads \u722c\u5230\u7684\u516b\u5b57\u547d\u7406\u8cbc\u6587\uff0c\u8acb\u70ba\u6bcf\u7bc7\u88dc\u4e0a hook/why/apply \u5206\u6790\uff1a\n"
        for i, p in enumerate(crawler_posts):
            threads_block += f"\n\u2500 \u7b2c{i+1}\u7bc7\uff1a@{p['author']}\uff08\u2764\ufe0f{p['likes']} \u00b7 \ud83d\udcac{p['comments']} \u00b7 \ud83d\udd04{p['reposts']}\uff09\n\u5167\u5bb9\uff1a{p['text'][:150]}\n"

    step1 = ('1. 為上面 ' + str(len(crawler_posts)) + ' 篇 Threads 貼文補上 hook/why/apply 分析') if crawler_posts else ('1. 搜尋「' + kw + ' threads 熱門」找 5 篇高互動貼文')
    prompt = threads_block + """
品牌：@jhen_insightlab（八字覺察 × 牌卡指引）
受眾痛點：情感內耗型、焦慮尋覓型、覺醒破局型、分手療癒型、八字好奇者

請完成：
""" + step1 + """
2. 搜尋「""" + kw + """ 小紅書」找 3 篇高互動貼文
3. 搜尋「""" + kw + """ IG」找 2 篇高互動貼文

合併輸出，每篇必須包含所有欄位：
author, text(前200字繁體中文), likes(數字), comments(數字), reposts(數字), level(🔥等級), sub(shishen/love/fate/general), platform(threads/xiaohongshu/ig), hook(Hook拆解), why(爆文原因), apply(套用到八字覺察品牌的建議)

⚠️ 簡體字必須全部轉繁體。至少 8 篇。按互動量排序。只回覆 JSON：
{"posts": [...]}"""

    result = run_claude(prompt, timeout=180)
    all_posts = []
    if result:
        try:
            clean = result.strip()
            if clean.startswith('```'): clean = clean.split('\n', 1)[1]
            if clean.endswith('```'): clean = clean[:-3]
            clean = clean.strip()
            if clean.startswith('json'): clean = clean[4:].strip()
            all_posts = json.loads(clean).get('posts', [])
        except (json.JSONDecodeError, KeyError):
            pass
    if not all_posts:
        return jsonify({'items': [], 'error': 'AI 搜尋暫時無法回應'}), 503
    for p in all_posts:
        likes = p.get('likes', 0)
        if not p.get('level'):
            p['level'] = '\U0001f525\U0001f525\U0001f525' if likes >= 5000 else '\U0001f525\U0001f525' if likes >= 1000 else '\U0001f525' if likes >= 100 else ''
    data = {'items': all_posts, 'updated': datetime.now().strftime('%Y-%m-%d %H:%M')}
    _cache_set(cache_key, data)
    return jsonify(data)


# ─── 人設爆文搜尋 ───

@app.route('/api/persona-trending', methods=['GET'])
def get_persona_trending():
    # 優先從本地 JSON 讀取
    data = _load_trending_json('persona')
    if data and data.get('items'):
        return jsonify(data)
    # fallback
    sub = request.args.get('sub', 'all')
    cache_key = f'persona_trending_{sub}'
    cached = _cache_get(cache_key)
    if cached:
        return jsonify(cached)
    return jsonify({'items': [], 'error': '請先在本機執行 python3 scripts/trending_analyzer.py -c persona'})
    keywords = {
        'all': '心理學 感情 覺察 自我成長 人際關係',
        'psychology': '心理學 認知偏誤 依附關係 情緒管理 自我覺察',
        'love': '感情 戀愛 分手 假性親密 迴避型 焦慮型',
        'growth': '覺察 正念 修行 自我成長 內在小孩 冥想',
    }
    kw = keywords.get(sub, keywords['all'])

    prompt = f"""你必須用 web_search 工具搜尋真實的熱門貼文。請進行以下搜尋：

搜尋 1：用 web_search 搜尋「{kw} threads 熱門」，找 5 篇 Threads 真實貼文
搜尋 2：用 web_search 搜尋「{kw} 小紅書 熱門」，找 5 篇小紅書真實貼文
搜尋 3：用 web_search 搜尋「{kw} 小紅書 爆文」，找 3 篇小紅書真實貼文
搜尋 4：用 web_search 搜尋「{kw} IG 熱門」，找 4 篇 IG 真實貼文
搜尋 5：用 web_search 搜尋「{kw} IG 觀點」，找 3 篇 IG 真實貼文

⚠️ 重要規則：
- 每個搜尋都必須實際執行 web_search，不能編造
- 只選互動量高的貼文（likes > 50 優先，越高越好）
- 至少回傳 15 篇
- 結果按互動量從高到低排序
- 每篇標注爆文等級：🔥🔥🔥（5000+）、🔥🔥（1000+）、🔥（100+）

每篇提供：
- author, text(前200字), likes, comments, reposts
- level: 爆文等級
- sub: 分類（psychology/love/growth/general）
- platform: 來源平台
- hook: 開頭手法分析（拆解用了什麼 Hook 公式，例如「衝突反差」「點名受眾」等）
- why: 為什麼爆（分析爆文原因，例如「精準打中脫單焦慮 + 簡單回覆門檻」）
- apply: 套用建議（具體的套用到 @jhen_insightlab 的文案方向，結合受眾痛點：客群1情感內耗型、客群2焦慮尋覓型、客群3覺醒破局型、客群4分手療癒型、客群5八字好奇者。品牌定位：人生慣性翻譯者，90%八字覺察+10%牌卡）

⚠️ 所有輸出文字必須是繁體中文（搜尋到的簡體字內容必須全部轉換成繁體中文）。禁止出現任何簡體字。用 JSON 回覆（按 likes 從高到低排序）：
```json
{{"posts": [至少15篇]}}
```
只回覆 JSON。"""

    result = run_claude(prompt, timeout=180)
    all_posts = []
    if result:
        try:
            clean = result.strip()
            if clean.startswith('```'): clean = clean.split('\n', 1)[1]
            if clean.endswith('```'): clean = clean[:-3]
            clean = clean.strip()
            if clean.startswith('json'): clean = clean[4:].strip()
            all_posts = json.loads(clean).get('posts', [])
        except (json.JSONDecodeError, KeyError):
            pass
    if not all_posts:
        return jsonify({'items': [], 'error': 'AI 搜尋暫時無法回應'}), 503
    for p in all_posts:
        likes = p.get('likes', 0)
        if not p.get('level'):
            p['level'] = '\U0001f525\U0001f525\U0001f525' if likes >= 5000 else '\U0001f525\U0001f525' if likes >= 1000 else '\U0001f525' if likes >= 100 else ''
    data = {'items': all_posts, 'updated': datetime.now().strftime('%Y-%m-%d %H:%M')}
    _cache_set(cache_key, data)
    return jsonify(data)


# ─── 原稿處理 API ───

@app.route('/api/rewrite-original', methods=['POST'])
def rewrite_original():
    """B1 模式：粗糙想法 → AI 大幅改寫"""
    data = request.json or {}
    original = data.get('text', '').strip()
    pillar = data.get('pillar', '八字')
    if not original:
        return jsonify({'error': '請輸入原稿'}), 400

    prompt = f"""你是 @jhen_insightlab 的文案改寫助手。

{BRAND_CONTEXT}

以下是用戶的原始想法。請用寫作技巧重新改寫成完整 Threads 文案。

重要規則：
1. 保留用戶所有具體例子和個人感受
2. 保留核心觀點，不改變立場
3. 可大幅改寫結構、補充內容、套用寫作技巧
4. 字數 100-300 字（最多 500）
5. 不加 markdown 格式，不用 ** 粗體

請先讀取 skills/writing-technique/SKILL.md 和 brand/brand_voice.md

原始想法：
{original}

用 JSON 回覆：
```json
{{"copy": "改寫後文案", "techniques_used": ["技巧1"], "hook_type": "Hook類型"}}
```
⚠️ 所有輸出文字必須是繁體中文（簡體字內容必須轉換成繁體）。禁止任何簡體字。只回覆 JSON。"""

    result = run_claude(prompt)
    if not result:
        return jsonify({'error': 'Claude API 暫時無法回應'}), 503
    try:
        clean = result.strip()
        if clean.startswith('```'): clean = clean.split('\n', 1)[1]
        if clean.endswith('```'): clean = clean[:-3]
        clean = clean.strip()
        if clean.startswith('json'): clean = clean[4:].strip()
        return jsonify(json.loads(clean))
    except json.JSONDecodeError:
        return jsonify({'copy': result, 'techniques_used': [], 'hook_type': ''})


@app.route('/api/refine-original', methods=['POST'])
def refine_original():
    """B2 模式：幾乎完成 → AI 微調"""
    data = request.json or {}
    original = data.get('text', '').strip()
    if not original:
        return jsonify({'error': '請輸入原稿'}), 400

    prompt = f"""你是 @jhen_insightlab 的文案微調助手。

以下文案幾乎完成，只需最小幅度修改。

規則：
1. 不改結構、不改觀點、不加新內容
2. 只做：震撼亮點前移、壓縮冗字、AI味檢測修正
3. 修改幅度 < 20%

文案：
{original}

用 JSON 回覆：
```json
{{"copy": "微調後文案", "changes": ["修改1", "修改2"]}}
```
⚠️ 所有輸出文字必須是繁體中文（簡體字內容必須轉換成繁體）。禁止任何簡體字。只回覆 JSON。"""

    result = run_claude(prompt)
    if not result:
        return jsonify({'error': 'Claude API 暫時無法回應'}), 503
    try:
        clean = result.strip()
        if clean.startswith('```'): clean = clean.split('\n', 1)[1]
        if clean.endswith('```'): clean = clean[:-3]
        clean = clean.strip()
        if clean.startswith('json'): clean = clean[4:].strip()
        return jsonify(json.loads(clean))
    except json.JSONDecodeError:
        return jsonify({'copy': result, 'changes': []})


# ─── 週規劃 API ───

@app.route('/api/weekly-plan', methods=['POST'])
def weekly_plan():
    data = request.json or {}
    week_start = data.get('week_start', datetime.now().strftime('%Y-%m-%d'))

    prompt = f"""你是 @jhen_insightlab 的內容策略顧問。請規劃本週（{week_start} 起）的發文計劃。

週計劃模板：
- 週一：八字觀察（20:00-22:00）
- 週二：人設/覺察修行/深度文
- 週三：八字觀察（20:00-22:00）
- 週四：八字觀察（20:00-22:00）
- 週五：人設/覺察修行/深度文
- 週六：IG 輪播（從本週文拆解）
- 週日：休息/限動互動

請先讀取：
- config/published_topics.md（已發佈主題，避免重複）
- brand/brand_voice.md（品牌語氣）
- strategy/content-matrix.md（22種形式）

為每天推薦具體主題 + 切入角度 + 使用的矩陣形式。

用 JSON 回覆：
```json
{{
  "days": [
    {{"day": "週一", "date": "日期", "type": "八字", "topic": "主題", "angle": "切入角度", "form": "矩陣形式", "time": "20:00"}},
    ...
  ]
}}
```
⚠️ 所有輸出文字必須是繁體中文（簡體字內容必須轉換成繁體）。禁止任何簡體字。只回覆 JSON。"""

    result = run_claude(prompt, timeout=120)
    if not result:
        return jsonify({'error': 'Claude API 暫時無法回應'}), 503
    try:
        clean = result.strip()
        if clean.startswith('```'): clean = clean.split('\n', 1)[1]
        if clean.endswith('```'): clean = clean[:-3]
        clean = clean.strip()
        if clean.startswith('json'): clean = clean[4:].strip()
        return jsonify(json.loads(clean))
    except json.JSONDecodeError:
        return jsonify({'raw': result})


# ─── 文風學習 API ───

@app.route('/api/style-learning', methods=['POST'])
def style_learning():
    data = request.json or {}
    account = data.get('account', 'jhen_insightlab')

    prompt = f"""你是 Threads 寫作風格分析師。請分析 @{account} 的寫作風格特徵。

請先讀取：
- brand/brand_voice.md（現有品牌語氣分析）
- brand/performance-insights.md（流量表現洞察）

分析項目：
1. 句子長度和節奏
2. 開頭模式（5種類型分布）
3. 慣用語和口頭禪
4. emoji 使用規律
5. 情緒弧線結構
6. 與 brand_voice.md 的差異
7. 改善建議

用 JSON 回覆：
```json
{{
  "summary": "整體風格摘要",
  "metrics": {{"avg_chars": 數字, "short_ratio": "百分比", "emoji_per_post": 數字}},
  "patterns": ["模式1", "模式2"],
  "suggestions": ["建議1", "建議2"],
  "should_update": true
}}
```
⚠️ 所有輸出文字必須是繁體中文（簡體字內容必須轉換成繁體）。禁止任何簡體字。只回覆 JSON。"""

    result = run_claude(prompt, timeout=120)
    if not result:
        return jsonify({'error': 'Claude API 暫時無法回應'}), 503
    try:
        clean = result.strip()
        if clean.startswith('```'): clean = clean.split('\n', 1)[1]
        if clean.endswith('```'): clean = clean[:-3]
        clean = clean.strip()
        if clean.startswith('json'): clean = clean[4:].strip()
        return jsonify(json.loads(clean))
    except json.JSONDecodeError:
        return jsonify({'raw': result})


if __name__ == '__main__':
    print("🚀 Insight Lab API Server starting...")
    print(f"📁 Project root: {PROJECT_ROOT}")
    print(f"🔗 Notion: {'connected' if NOTION_TOKEN else 'NOT SET'}")
    port = int(os.environ.get('PORT', 8080))
    print(f"🚀 Starting on port {port}, API key: {'set' if ANTHROPIC_API_KEY else 'NOT SET'}", flush=True)
    app.run(host='0.0.0.0', port=port, debug=False)
