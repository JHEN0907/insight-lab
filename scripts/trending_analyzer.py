"""
爆款牆分析腳本 — 混合爬蟲 + 雙引擎分析 + GitHub Gist 儲存
流程：
  Step 1: Playwright 爬 Threads（免費）+ Apify 補強（sortBy:popular + IG）
  Step 2: Claude CLI（主力）或 Gemini（備援）分析 hook/why/apply
  Step 3: 存到 Gist + 本地 JSON + Notion

本機執行：python3 scripts/trending_analyzer.py
Zeabur cron / Discord bot 也可呼叫
"""
import os
import sys
import json
import re
import subprocess
import urllib.request
import threading
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(PROJECT_ROOT, 'scripts'))
CLAUDE_PATH = '/Users/Sherry/.local/bin/claude'

# Notion 設定
NOTION_TOKEN = os.environ.get('NOTION_TOKEN', '')
NOTION_THREADS_DB = "2d81408d-91fd-807e-8693-cea19edc57ec"

# 載入 .env
env_path = os.path.join(PROJECT_ROOT, '.env')
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())
    NOTION_TOKEN = os.environ.get('NOTION_TOKEN', NOTION_TOKEN)


# ─── 搜尋關鍵字設定 ───

KEYWORDS = {
    'bazi': ['八字 十神', '八字 正官 偏官', '八字 食神 傷官', '八字 日主 格局', '八字 大運 流年'],
    'persona': ['心理學 感情', '感情 覺察', '自我覺察 成長', '情緒 療癒'],
    'all': ['八字 十神', '八字 日主', '塔羅 占卜', '心理學 感情', '感情 覺察'],
    'other': ['threads 爆文 2026', '自媒體 爆款 threads', '萬讚 threads', 'threads 熱門 觀點'],
}

EXCLUDE_TERMS = {
    'bazi': ['AI 算命', 'AI 八字', '免費算命', '星座', '紫微斗數', '紫微', '塔羅', '心理學', '心理測驗'],
    'all': ['AI 算命', 'AI 八字', '免費算命', '星座運勢', '紫微斗數'],
    'persona': [],
    'other': [],
}

APIFY_KEYWORDS = {
    'bazi': {'threads': ['八字 十神', '八字 格局'], 'ig': ['#八字', '#命理']},
    'persona': {'threads': ['心理學 感情', '覺察 成長'], 'ig': ['#心理學', '#感情']},
    'all': {'threads': ['八字 十神', '塔羅 占卜'], 'ig': ['#八字', '#塔羅']},
    'other': {'threads': ['爆文 threads', '熱門 觀點'], 'ig': ['#自媒體']},
}


# ─── 雙引擎：Claude CLI 主力 + Gemini 備援 ───

def run_claude_cli(prompt, timeout=600):
    """Claude CLI（本機，品質最好）"""
    if not os.path.exists(CLAUDE_PATH):
        return None
    try:
        result = subprocess.run(
            [CLAUDE_PATH, '-p', '--output-format', 'text',
             '--allowedTools', 'WebSearch,WebFetch,Read,Glob,Grep',
             '--', prompt],
            capture_output=True, text=True, cwd=PROJECT_ROOT,
            timeout=timeout, env={**os.environ, 'CLAUDE_CODE_ENTRYPOINT': 'cli'}
        )
        stdout = result.stdout.strip()
        return stdout if stdout else None
    except Exception as e:
        print(f"  ⚠️ Claude CLI error: {e}")
        return None


def run_gemini(prompt, timeout=120):
    """Gemini API（雲端備援）"""
    api_key = os.environ.get('GOOGLE_AI_API_KEY', '')
    if not api_key:
        print("  ⚠️ GOOGLE_AI_API_KEY 未設定")
        return None
    try:
        import google.genai as genai
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model='gemini-2.5-flash-preview-05-20',
            contents=prompt,
        )
        return response.text.strip() if response.text else None
    except Exception as e:
        print(f"  ⚠️ Gemini error: {e}")
        return None


def run_analysis(prompt, timeout=600):
    """雙引擎：Claude CLI → Gemini fallback"""
    result = run_claude_cli(prompt, timeout)
    if result:
        print("  🟢 使用 Claude CLI")
        return result
    print("  🟡 Claude CLI 不可用，切換 Gemini")
    return run_gemini(prompt + '\n\n⚠️ 所有文字必須使用繁體中文，不可出現簡體字。')


# ─── Step 1: 混合爬蟲 ───

def crawl_threads_posts(category='bazi', target_count=10):
    """Playwright 爬 Threads 真實貼文"""
    try:
        from threads_crawler import search_threads
    except ImportError:
        print("  ⚠️ threads_crawler 未找到")
        return []

    keywords = KEYWORDS.get(category, KEYWORDS['all'])
    exclude = EXCLUDE_TERMS.get(category, [])
    all_posts = []
    seen_urls = set()

    for kw in keywords:
        if len(all_posts) >= target_count:
            break
        need = target_count - len(all_posts)
        print(f"  🔎 Playwright 搜尋「{kw}」...")
        try:
            results = search_threads(kw, max_results=min(need + 3, 10))
        except Exception as e:
            print(f"  ⚠️ 搜尋「{kw}」失敗: {e}")
            continue

        for p in results:
            url = p.get('url', '')
            if url in seen_urls:
                continue
            text = p.get('text', '')
            if any(ex in text for ex in exclude):
                continue
            seen_urls.add(url)
            all_posts.append({
                'url': url,
                'author': (p.get('source', '') or '').lstrip('@'),
                'text': text[:300],
                'likes': p.get('likes', 0),
                'comments': p.get('comments', 0),
                'reposts': p.get('reposts', 0) or p.get('shares', 0),
                'date': p.get('date', ''),
                'platform': 'threads',
            })
            if len(all_posts) >= target_count:
                break

    all_posts = verify_post_engagement(all_posts)
    all_posts.sort(key=lambda x: x['likes'] + x['comments'] * 3 + x['reposts'] * 5, reverse=True)
    print(f"  ✅ Playwright 爬到 {len(all_posts)} 篇 Threads 貼文")
    return all_posts


def crawl_apify_posts(category='bazi'):
    """Apify 補強（Threads popular + IG）"""
    try:
        from apify_search import apify_search_threads, apify_search_ig
    except ImportError:
        print("  ⚠️ apify_search 未找到")
        return []

    kw_config = APIFY_KEYWORDS.get(category, APIFY_KEYWORDS['all'])
    all_posts = []

    for kw in kw_config.get('threads', []):
        posts = apify_search_threads(kw, max_posts=5)
        all_posts.extend(posts)

    for tag in kw_config.get('ig', []):
        posts = apify_search_ig(tag, max_posts=3)
        all_posts.extend(posts)

    return all_posts


def merge_and_dedup(playwright_posts, apify_posts):
    """合併 + 去重（by URL 和作者+內容前50字）"""
    seen = set()
    merged = []

    for p in playwright_posts:
        key = p.get('url', '') or (p.get('author', '') + p.get('text', '')[:50])
        if key and key not in seen:
            seen.add(key)
            merged.append(p)

    for p in apify_posts:
        key = p.get('url', '') or (p.get('author', '') + p.get('text', '')[:50])
        if key and key not in seen:
            seen.add(key)
            merged.append(p)

    merged.sort(key=lambda x: (x.get('likes', 0) or 0) + (x.get('comments', 0) or 0) * 3 + (x.get('reposts', 0) or 0) * 5, reverse=True)
    return merged


def verify_post_engagement(posts):
    """用 Playwright 逐篇訪問貼文 URL，取得真實互動數據"""
    if not posts:
        return posts
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return posts

    SESSION_DIR = os.path.expanduser("~/.threads-session")
    verified = 0
    num_pat = re.compile(r'^[\d,.]+[KkMm]?$')

    def _parse_num(s):
        s = s.strip().replace(",", "")
        if s.upper().endswith("K"):
            return int(float(s[:-1]) * 1000)
        if s.upper().endswith("M"):
            return int(float(s[:-1]) * 1000000)
        try:
            return int(s)
        except ValueError:
            return 0

    print(f"  🔍 驗證 {len(posts)} 篇貼文的真實互動數據...")
    try:
        with sync_playwright() as p:
            has_session = os.path.exists(SESSION_DIR) and os.listdir(SESSION_DIR)
            if has_session:
                context = p.chromium.launch_persistent_context(
                    SESSION_DIR, headless=True,
                    args=["--disable-blink-features=AutomationControlled"],
                    user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                )
                page = context.pages[0] if context.pages else context.new_page()
            else:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page(user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
                context = None

            for post in posts:
                url = post.get('url', '')
                if '/post/' not in url:
                    continue
                try:
                    page.goto(url, timeout=15000)
                    page.wait_for_timeout(3000)
                    body = page.inner_text("body")
                    raw = [l.strip() for l in body.split("\n") if l.strip()]

                    cleaned = []
                    skip_next = False
                    simple_num = re.compile(r'^\d+$')
                    for ln in raw:
                        if ln == '/':
                            if cleaned and simple_num.match(cleaned[-1]):
                                cleaned.pop()
                            skip_next = True
                            continue
                        if skip_next and simple_num.match(ln):
                            skip_next = False
                            continue
                        skip_next = False
                        if re.match(r'^\d+\s*/\s*\d+$', ln):
                            continue
                        cleaned.append(ln)

                    for idx in range(len(cleaned) - 3):
                        if (num_pat.match(cleaned[idx]) and num_pat.match(cleaned[idx+1])
                                and num_pat.match(cleaned[idx+2]) and num_pat.match(cleaned[idx+3])):
                            post['likes'] = _parse_num(cleaned[idx])
                            post['comments'] = _parse_num(cleaned[idx+1])
                            post['reposts'] = _parse_num(cleaned[idx+2])
                            post['shares'] = _parse_num(cleaned[idx+3])
                            verified += 1
                            break
                except Exception:
                    pass

            if context:
                context.close()
            else:
                browser.close()
    except Exception as e:
        print(f"  ⚠️ 驗證失敗: {e}")

    print(f"  ✅ 已驗證 {verified}/{len(posts)} 篇貼文的互動數據")
    return posts


# ─── Step 2: AI 分析 hook/why/apply ───

def analyze_posts(posts, category='bazi'):
    """分析每篇貼文的 hook/why/apply"""
    if not posts:
        return posts

    cat_label = {'bazi': '四柱八字/十神', 'persona': '心理學/感情/覺察', 'all': '綜合', 'other': '跨領域爆款架構'}
    label = cat_label.get(category, '綜合')

    other_extra = ""
    if category == 'other':
        other_extra = "\n⚠️ 「其他」分類重點：分析「爆文架構」—— 文章結構、開頭手法、轉折方式是否可套用到任何領域。apply 欄位請具體說明怎麼套用到八字/塔羅/覺察主題。\n"

    posts_text = ""
    for i, p in enumerate(posts, 1):
        posts_text += f"\n---第{i}篇---\n作者: @{p.get('author','')}\n日期: {p.get('date','')}\n網址: {p.get('url','')}\n讚: {p.get('likes',0)} / 留言: {p.get('comments',0)} / 轉發: {p.get('reposts',0)}\n內容: {p.get('text','')[:200]}\n"

    prompt = f"""你是自媒體爆文分析專家。以下是從 Threads 爬到的{label}相關真實貼文。
請為每篇貼文分析 hook（開頭手法）、why（爆文原因）、apply（套用建議）。
{other_extra}
品牌：@jhen_insightlab（人生慣性翻譯者，90% 八字覺察 + 10% 牌卡指引）
受眾痛點：
- 客群1 情感內耗型：「晚回訊息20分鐘就演完分手劇本」
- 客群2 焦慮尋覓型：「朋友婚禮後回家開交友軟體又關掉」
- 客群3 覺醒破局型：「每兩三年遇到同樣的消耗型人」
- 客群4 分手療癒型：「分手一個月看到情侶還是鼻酸」
- 客群5 八字好奇者：「朋友都在算命，只有你看不懂命盤」

以下是爬到的貼文：
{posts_text}

請用 JSON 回覆，格式如下：
```json
{{"analyses": [
  {{"index": 1, "hook": "Hook手法名稱 — 具體說明", "why": "爆文原因分析", "apply": "具體套用建議，結合哪個客群痛點", "cat": "my或cross或other", "level": "🔥🔥🔥或🔥🔥或🔥"}},
  ...
]}}
```

cat 判斷規則：my=八字命理 / cross=塔羅/心理/覺察 / other=其他領域
level 判斷規則（讚×1+留言×3+轉發×5）：🔥🔥🔥=5000+ / 🔥🔥=1000+ / 🔥=100+

⚠️ 所有文字必須繁體中文
只回覆 JSON。"""

    print(f"  🤖 分析 {len(posts)} 篇貼文...")
    result = run_analysis(prompt)
    if not result:
        print("  ⚠️ 分析無回應，使用基本資料")
        for p in posts:
            p.setdefault('hook', '')
            p.setdefault('why', '')
            p.setdefault('apply', '')
            p.setdefault('cat', 'my' if category == 'bazi' else ('other' if category == 'other' else 'cross'))
            score = (p.get('likes', 0) or 0) + (p.get('comments', 0) or 0) * 3 + (p.get('reposts', 0) or 0) * 5
            p.setdefault('level', '\U0001f525\U0001f525\U0001f525' if score >= 5000 else '\U0001f525\U0001f525' if score >= 1000 else '\U0001f525')
        return posts

    try:
        json_match = re.search(r'\{[\s\S]*"analyses"\s*:\s*\[[\s\S]*\]\s*\}', result)
        if json_match:
            analyses = json.loads(json_match.group(0)).get('analyses', [])
        else:
            analyses = []

        analysis_map = {a['index']: a for a in analyses if 'index' in a}
        default_cat = 'my' if category == 'bazi' else ('other' if category == 'other' else 'cross')
        for i, p in enumerate(posts, 1):
            a = analysis_map.get(i, {})
            p['hook'] = a.get('hook', '')
            p['why'] = a.get('why', '')
            p['apply'] = a.get('apply', '')
            p['cat'] = a.get('cat', default_cat)
            p['level'] = a.get('level', '\U0001f525')
        print(f"  ✅ 分析完成，{len(analysis_map)}/{len(posts)} 篇有分析")
    except (json.JSONDecodeError, KeyError) as e:
        print(f"  ⚠️ 分析 JSON 解析失敗: {e}")
        for p in posts:
            p.setdefault('hook', '')
            p.setdefault('why', '')
            p.setdefault('apply', '')

    return posts


# ─── 主流程 ───

def search_trending(category='all', mode='light'):
    """
    mode='light': Playwright only（免費、快速）
    mode='full':  Playwright + Apify（完整更新）
    """
    print(f"🔍 開始搜尋 {category} 爆文（{mode} mode）...")

    # Step 1: Playwright 爬 Threads
    threads_posts = crawl_threads_posts(category, target_count=10)

    # Step 2: Apify 補強（full mode only）
    if mode == 'full':
        apify_posts = crawl_apify_posts(category)
        all_crawled = merge_and_dedup(threads_posts, apify_posts)
        print(f"  📊 合併後 {len(all_crawled)} 篇（Playwright {len(threads_posts)} + Apify {len(apify_posts)}，去重後）")
    else:
        all_crawled = threads_posts

    # Step 3: AI 分析
    if all_crawled:
        all_crawled = analyze_posts(all_crawled, category)

    all_crawled.sort(
        key=lambda x: (x.get('likes', 0) or 0) + (x.get('comments', 0) or 0) * 3 + (x.get('reposts', 0) or 0) * 5,
        reverse=True
    )

    print(f"✅ 共 {len(all_crawled)} 篇")
    return all_crawled


# ─── 儲存：本地 JSON + Gist + Notion ───

def save_to_file(posts, category):
    """存到本地 JSON 檔案"""
    output_dir = os.path.join(PROJECT_ROOT, 'web', 'data')
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, f'trending_{category}.json')
    data = {
        'items': posts,
        'updated': datetime.now().strftime('%Y-%m-%d %H:%M'),
        'category': category,
    }
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"💾 已存到 {filepath}（{len(posts)} 篇）")
    return filepath


def save_to_gist(posts, category):
    """上傳 JSON 到 GitHub Gist"""
    token = os.environ.get('GITHUB_TOKEN', '')
    gist_id = os.environ.get('GIST_ID', '')
    if not token or not gist_id:
        print("⚠️ GITHUB_TOKEN 或 GIST_ID 未設定，跳過 Gist")
        return

    filename = f'trending_{category}.json'
    content = json.dumps({
        'items': posts,
        'updated': datetime.now().strftime('%Y-%m-%d %H:%M'),
        'category': category,
    }, ensure_ascii=False, indent=2)

    payload = json.dumps({'files': {filename: {'content': content}}}).encode('utf-8')
    req = urllib.request.Request(
        f'https://api.github.com/gists/{gist_id}',
        data=payload,
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github+json',
        },
        method='PATCH'
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"📤 已上傳到 Gist: {filename}")
    except Exception as e:
        print(f"❌ Gist 上傳失敗: {e}")


def save_to_notion(posts, category):
    """存到 Notion"""
    if not NOTION_TOKEN:
        return
    headers = {
        "Authorization": f"Bearer {NOTION_TOKEN}",
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
    }
    title = f"爆款牆分析 [{category}] {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    content = json.dumps(posts, ensure_ascii=False, indent=2)
    chunks = [content[i:i+1900] for i in range(0, len(content), 1900)]
    blocks = [{"object": "block", "type": "paragraph", "paragraph": {
        "rich_text": [{"type": "text", "text": {"content": c}}]
    }} for c in chunks]
    payload = {
        "parent": {"database_id": NOTION_THREADS_DB},
        "properties": {
            "Name": {"title": [{"text": {"content": title}}]},
            "狀態": {"select": {"name": "草稿-20%"}},
            "建立日期": {"date": {"start": datetime.now().strftime('%Y-%m-%d')}},
        },
        "children": blocks,
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request('https://api.notion.com/v1/pages', data=data, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            print(f"📌 已存到 Notion: {result.get('url', '')}")
    except Exception as e:
        print(f"❌ Notion 儲存失敗: {e}")


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='爆款牆分析')
    parser.add_argument('--category', '-c', default='all', choices=['all', 'bazi', 'persona', 'other'],
                        help='搜尋分類')
    parser.add_argument('--all-categories', '-a', action='store_true',
                        help='搜尋所有分類')
    parser.add_argument('--mode', '-m', default='light', choices=['light', 'full'],
                        help='light=Playwright only / full=Playwright+Apify')
    args = parser.parse_args()

    categories = ['all', 'bazi', 'persona', 'other'] if args.all_categories else [args.category]

    for cat in categories:
        posts = search_trending(cat, mode=args.mode)
        if posts:
            save_to_file(posts, cat)
            save_to_gist(posts, cat)
            save_to_notion(posts, cat)
        print()

    print("🎉 完成！")
