"""
爆款牆分析腳本 — 雲端自動化版
雙引擎：Claude CLI（本機優先）→ Gemini（雲端備援）
爬蟲：Playwright（主力）+ Apify（補強 sortBy:popular + IG）
儲存：GitHub Gist（前端直接 fetch）+ 本地 JSON + Notion

本機執行：python3 scripts/trending_analyzer.py
Zeabur 伺服器也可直接呼叫
"""
import os
import sys
import json
import re
import subprocess
import urllib.request
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(PROJECT_ROOT, 'scripts'))

# ─── 環境設定 ───

CLAUDE_PATH = '/Users/Sherry/.local/bin/claude'
NOTION_TOKEN = os.environ.get('NOTION_TOKEN', '')
NOTION_THREADS_DB = "2d81408d-91fd-807e-8693-cea19edc57ec"
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN', '')
GIST_ID = os.environ.get('GIST_ID', '')
GOOGLE_AI_API_KEY = os.environ.get('GOOGLE_AI_API_KEY', '')

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
    GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN', GITHUB_TOKEN)
    GIST_ID = os.environ.get('GIST_ID', GIST_ID)
    GOOGLE_AI_API_KEY = os.environ.get('GOOGLE_AI_API_KEY', GOOGLE_AI_API_KEY)


# ─── 搜尋關鍵字 ───

KEYWORDS = {
    'bazi': ['八字 十神', '八字 命盤 感情', '八字 正官 七殺', '八字 食神 傷官', '八字 流年 運勢'],
    'tarot': ['塔羅 覺察', '塔羅 感情', '塔羅 療癒', '塔羅 指引 成長'],
    'mindful': ['正念 修行', '佛法 智慧', '靜心 覺察', '冥想 療癒', '修行 生活'],
    'persona': ['心理學 依附關係', '感情 迴避型', '自我覺察 內在小孩', '情緒 界線 關係'],
    'all': ['八字 十神', '八字 感情', '塔羅 覺察', '心理學 依附', '感情 療癒'],
    'other': ['threads 萬讚', '爆紅 threads 分享', 'threads 破萬', '超多人分享 threads'],
}

EXCLUDE_TERMS = {
    'bazi': ['AI 算命', 'AI 八字', '免費算命', '星座', '紫微斗數', '紫微', '塔羅', '牌卡', '心理學', '心理測驗', '求教', '請教', '請問', '想問', '有人可以幫', '幫我看', '注定', '就是普通人', '人上人', '天選之人', '命中註定', '童子命', '廟公', '宮廟', '媽祖', '玄天上帝', '前世', '因果', '業力', '神明', '乩童', '通靈', '靈異', '開天眼', '天命', '贖罪'],
    'tarot': ['AI 算命', '免費占卜', '星座'],
    'mindful': [],
    'all': ['AI 算命', 'AI 八字', '免費算命', '星座運勢', '紫微斗數', '求教', '請問'],
    'persona': ['求教', '請問', '有人可以幫'],
    'other': ['求教', '請問', '有人可以幫'],
}


# ─── 雙引擎：Claude CLI → Gemini fallback ───

def run_claude_cli(prompt, timeout=600):
    """Claude CLI（本機品質最好）"""
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
        if stdout and 'session limit' not in stdout.lower():
            return stdout
        return None
    except Exception as e:
        print(f"  ⚠️ Claude CLI error: {e}")
        return None


def run_gemini(prompt, timeout=120):
    """Gemini 備援（雲端可用）"""
    api_key = GOOGLE_AI_API_KEY
    if not api_key:
        print("  ⚠️ GOOGLE_AI_API_KEY 未設定")
        return None
    try:
        import google.genai as genai
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model='gemini-2.5-flash',
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
        print("  🟢 使用 Claude CLI 分析")
        return result
    result = run_gemini(prompt + '\n\n⚠️ 所有文字必須使用繁體中文，不可出現任何簡體字。')
    if result:
        print("  🟡 使用 Gemini 分析（Claude CLI 不可用）")
        return result
    print("  ❌ 兩個引擎都無法使用")
    return None


# ─── Step 1: Playwright 爬 Threads 真實貼文 ───

def crawl_threads_posts(category='bazi', target_count=10):
    """用 Playwright 登入 Threads 搜尋真實貼文"""
    try:
        from threads_crawler import search_threads
    except ImportError:
        print("  ⚠️ threads_crawler 未找到，跳過 Playwright 爬蟲")
        return []

    keywords = KEYWORDS.get(category, KEYWORDS['all'])
    exclude = EXCLUDE_TERMS.get(category, [])
    all_posts = []
    seen_urls = set()

    # 「其他」分類要求更高互動量（找真正的爆文架構）
    min_likes = 50 if category == 'other' else 0

    for kw in keywords:
        if len(all_posts) >= target_count:
            break
        # 多爬一些，之後篩掉低互動的
        fetch_count = min(target_count * 2, 15) if min_likes > 0 else min(target_count - len(all_posts) + 3, 10)
        print(f"  🔎 Playwright 搜尋「{kw}」...")
        try:
            results = search_threads(kw, max_results=fetch_count)
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
            # 互動量篩選（驗證後的數據才準，這裡先用搜尋頁數據粗篩）
            likes = p.get('likes', 0) or 0
            if likes < min_likes:
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
                'source': 'playwright',
            })
            if len(all_posts) >= target_count:
                break

    # 驗證互動數據
    all_posts = verify_post_engagement(all_posts)
    all_posts.sort(key=lambda x: x['likes'] + x['comments'] * 3 + x['reposts'] * 5, reverse=True)
    print(f"  ✅ Playwright 爬到 {len(all_posts)} 篇 Threads 貼文")
    return all_posts


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
                    user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                               "AppleWebKit/537.36 (KHTML, like Gecko) "
                               "Chrome/125.0.0.0 Safari/537.36",
                )
                page = context.pages[0] if context.pages else context.new_page()
            else:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page(
                    user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                               "AppleWebKit/537.36 (KHTML, like Gecko) "
                               "Chrome/125.0.0.0 Safari/537.36"
                )
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

                    # 清除分頁標記
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


# ─── Step 2: 合併 Playwright + Apify ───

def merge_and_dedup(playwright_posts, apify_posts):
    """合併兩個來源的貼文，按 URL 去重"""
    seen = set()
    merged = []
    # Playwright 優先（數據已驗證）
    for p in playwright_posts:
        key = p.get('url', '') or f"{p.get('author','')}_{p.get('text','')[:30]}"
        if key not in seen:
            seen.add(key)
            merged.append(p)
    for p in apify_posts:
        key = p.get('url', '') or f"{p.get('author','')}_{p.get('text','')[:30]}"
        if key not in seen:
            seen.add(key)
            merged.append(p)
    return merged


# ─── Step 3: AI 分析 hook/why/apply ───

def analyze_posts_with_ai(posts, category='bazi'):
    """用雙引擎分析每篇的 hook/why/apply"""
    if not posts:
        return posts

    cat_label = {'bazi': '四柱八字/十神', 'tarot': '塔羅覺察', 'mindful': '正念修行', 'persona': '心理學/感情/覺察', 'all': '綜合', 'other': '跨領域爆款架構'}
    label = cat_label.get(category, '綜合')

    posts_text = ""
    for i, p in enumerate(posts, 1):
        posts_text += f"\n---第{i}篇---\n作者: @{p.get('author','')}\n日期: {p.get('date','')}\n網址: {p.get('url','')}\n讚: {p.get('likes',0)} / 留言: {p.get('comments',0)} / 轉發: {p.get('reposts',0)}\n內容: {p.get('text','')[:200]}\n"

    other_extra = ""
    if category == 'other':
        other_extra = """
⚠️ 「其他」分類重點 — 爆文模板分析：
- 這些是各領域的高互動爆文，重點是判斷「這篇的架構能不能換字就套用到八字/塔羅/覺察領域」
- hook 欄位：拆解開頭手法的「公式」，例如「○○的人，其實都有一個共同點」→ 可替換成「夫妻宮有七殺的人，其實都有一個共同點」
- apply 欄位：**必須寫出具體的套用範例**，直接把原文的架構換成八字/塔羅版本的示範句子
  例如原文「30歲後才懂的5件事」→ 套用：「學八字後才懂的5件事」
- 如果這篇的架構太特殊、無法替換成八字/塔羅主題，就在 apply 寫「不適合套用」
"""

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

請用 JSON 回覆，每篇的 index 對應上面的編號（從1開始）：
```json
{{"analyses": [
  {{"index": 1, "hook": "Hook手法名稱 — 具體說明", "why": "爆文原因分析", "apply": "具體套用建議，結合哪個客群痛點", "cat": "my或cross或other", "level": "🔥🔥🔥或🔥🔥或🔥"}},
  ...
]}}
```

cat 判斷：my=四柱八字/十神/命理 / cross=塔羅/心理學/感情/覺察 / other=其他領域
level：讚×1+留言×3+轉發×5 → 🔥🔥🔥=5000+ / 🔥🔥=1000+ / 🔥=100+

⚠️ 重要過濾規則：
- 如果貼文是「求教文」（問問題、求幫忙看命盤），在 hook 欄位寫「求教文，不適合參考」
- 如果貼文是「鐵口直斷型」（把命格講死、分高低貴賤，例如「沒有XX就是普通人」「注定XX」「天選之人」），在 hook 欄位寫「斷言式，不符合品牌調性」
- 如果貼文涉及「宮廟/神諭/前世/因果/童子命/通靈」等宗教神秘內容，在 hook 欄位寫「宗教神秘類，不符合品牌調性」
- 品牌調性是「同行者」——用覺察角度分享觀察，不是用權威姿態下定論
- 八字分類（my）不能混入塔羅/牌卡內容
- apply 的套用建議必須符合同行者語氣，不能用斷言式

⚠️ 所有文字必須繁體中文
只回覆 JSON。"""

    print(f"  🤖 分析 {len(posts)} 篇貼文的 hook/why/apply...")
    result = run_analysis(prompt)
    if not result:
        print("  ⚠️ 分析無回應，使用基本資料")
        for p in posts:
            p.setdefault('hook', '')
            p.setdefault('why', '')
            p.setdefault('apply', '')
            default_cat = 'my' if category == 'bazi' else ('other' if category == 'other' else 'cross')
            p.setdefault('cat', default_cat)
            score = p.get('likes', 0) + p.get('comments', 0) * 3 + p.get('reposts', 0) * 5
            p.setdefault('level', '\U0001f525\U0001f525\U0001f525' if score >= 5000 else '\U0001f525\U0001f525' if score >= 1000 else '\U0001f525')
        return posts

    try:
        json_match = re.search(r'\{[\s\S]*"analyses"\s*:\s*\[[\s\S]*\]\s*\}', result)
        if json_match:
            analyses = json.loads(json_match.group(0)).get('analyses', [])
        else:
            analyses = []

        analysis_map = {a['index']: a for a in analyses if 'index' in a}
        for i, p in enumerate(posts, 1):
            a = analysis_map.get(i, {})
            p['hook'] = a.get('hook', '')
            p['why'] = a.get('why', '')
            p['apply'] = a.get('apply', '')
            default_cat = 'my' if category == 'bazi' else ('other' if category == 'other' else 'cross')
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
    mode='light': Playwright only（快速、免費）
    mode='full':  Playwright + Apify（完整、用免費額度）
    """
    print(f"🔍 開始搜尋 {category} 爆文（{mode} mode）...")

    # Step 1: Playwright 爬 Threads
    threads_posts = crawl_threads_posts(category, target_count=10)

    # Step 2: Apify 補強（full mode only）
    apify_posts = []
    if mode == 'full':
        try:
            from apify_search import apify_full_search
            apify_posts = apify_full_search(category)
        except ImportError:
            print("  ⚠️ apify_search 未找到，跳過 Apify")
        except Exception as e:
            print(f"  ⚠️ Apify 搜尋失敗: {e}")

    # Step 3: 合併去重
    all_posts = merge_and_dedup(threads_posts, apify_posts)

    # Step 4: AI 分析
    if all_posts:
        all_posts = analyze_posts_with_ai(all_posts, category)

    # 排序
    all_posts.sort(
        key=lambda x: (x.get('likes', 0) or 0) + (x.get('comments', 0) or 0) * 3 + (x.get('reposts', 0) or 0) * 5,
        reverse=True
    )

    print(f"✅ 共 {len(all_posts)} 篇（Playwright {len(threads_posts)} + Apify {len(apify_posts)}）")
    return all_posts


# ─── 儲存：本地 JSON + GitHub Gist + Notion ───

def save_to_file(posts, category):
    """存到本地 JSON"""
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
    token = GITHUB_TOKEN
    gist_id = GIST_ID
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
            'Authorization': f'token {token}',
            'Content-Type': 'application/json',
        },
        method='PATCH'
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"☁️ 已上傳到 Gist: {filename}")
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
    title = f"爆款牆 [{category}] {datetime.now().strftime('%Y-%m-%d %H:%M')}"
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


# ─── CLI 入口 ───

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='爆款牆分析')
    parser.add_argument('--category', '-c', default='all',
                        choices=['all', 'bazi', 'tarot', 'mindful', 'persona', 'other'])
    parser.add_argument('--all-categories', '-a', action='store_true')
    parser.add_argument('--mode', '-m', default='light', choices=['light', 'full'],
                        help='light=Playwright only / full=Playwright+Apify')
    args = parser.parse_args()

    categories = ['all', 'bazi', 'tarot', 'mindful', 'persona', 'other'] if args.all_categories else [args.category]

    for cat in categories:
        posts = search_trending(cat, mode=args.mode)
        if posts:
            save_to_file(posts, cat)
            save_to_gist(posts, cat)
            save_to_notion(posts, cat)
        print()

    print("🎉 完成！")
