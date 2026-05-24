"""
Insight Lab — 後端 API Server
為網頁前端提供 Claude API 串接
"""
import os
import sys
import json
import subprocess
import base64
import tempfile
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')


def run_claude(prompt, timeout=300):
    """呼叫 Anthropic API 生成內容（雲端部署用）"""
    if not ANTHROPIC_API_KEY:
        return None
    try:
        import urllib.request
        import urllib.error
        req_data = json.dumps({
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 4096,
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
            text = result.get('content', [{}])[0].get('text', '')
            return text if text else None
    except Exception as e:
        print(f"Anthropic API error: {e}", flush=True)
        return None


# ─── Static Files & Health ───

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/api/health')
def health():
    return jsonify({'status': 'ok', 'claude': os.path.exists(CLAUDE_PATH)})


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


# ─── 文案寫作助手 API ───

@app.route('/api/generate-copy', methods=['POST'])
def generate_copy():
    data = request.json or {}
    pillar = data.get('pillar', '八字')
    format_type = data.get('format', '')
    topic = data.get('topic', '')

    if not topic and not format_type:
        return jsonify({'error': '請選擇形式或輸入主題'}), 400

    prompt = f"""你是 @jhen_insightlab 的文案寫手。請根據以下設定生成一篇 Threads 文案。

## 設定
- 主題支柱：{pillar}
- 發文形式：{format_type}
- 主題/關鍵字：{topic or '（自由發揮）'}

## 寫作規則
生成前請先讀取以下檔案的寫作技巧：
- skills/writing-technique/SKILL.md
- brand/brand_voice.md

必須套用：
1. 震撼亮點前移 — 寫完後把最亮的金句搬到第一行
2. 極致壓縮句型 — 每段 ≤ 3 行
3. 餘韻設計 — 結尾引發反思，不用制式 CTA
4. 消滅 AI 感 — emoji 最多 1 個，不用括號
5. 自然植入主題標籤 — 把關鍵字寫進句子裡

## 輸出格式
請用 JSON 格式回覆：
```json
{{
  "copy": "完整文案（用 \\n 換行）",
  "techniques_used": ["技巧1", "技巧2"],
  "hook_type": "使用的 Hook 類型"
}}
```
只回覆 JSON。"""

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
只回覆 JSON。"""

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
        sys.path.insert(0, os.path.join(PROJECT_ROOT, 'scripts'))
        from threads_crawler import search_threads
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


if __name__ == '__main__':
    print("🚀 Insight Lab API Server starting...")
    print(f"📁 Project root: {PROJECT_ROOT}")
    print(f"🌐 http://localhost:5000")
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
