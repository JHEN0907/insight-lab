#!/usr/bin/env python3
"""
Threads 爬蟲模組 — 自建，不依賴 Apify
使用 Threads GraphQL API（公開、無需登入）爬取帳號貼文和關鍵字搜尋

用法：
  from threads_crawler import crawl_user_posts, search_keyword, crawl_category

欄位來源：
  - 帳號貼文：threads.net/api/graphql (BarcelonaProfileThreadsTabQuery)
  - 關鍵字搜尋：threads.net/api/graphql (BarcelonaSearchResultsQuery)
"""

import urllib.request
import urllib.parse
import urllib.error
import json
import re
import time
import random
import os
import gzip
import io
from datetime import datetime, timedelta

PARSER_VERSION = "1.0.0"
CRAWLER_BLOCKED = False

# ─── Rate limit ───
_last_request_time = 0.0
_MIN_DELAY = 2.0
_consecutive_failures = 0
_MAX_CONSECUTIVE_FAILURES = 5

UA_LIST = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
]

_cached_lsd_token = None
_lsd_token_time = 0


def _rate_limit():
    global _last_request_time
    elapsed = time.time() - _last_request_time
    if elapsed < _MIN_DELAY:
        time.sleep(_MIN_DELAY - elapsed)
    _last_request_time = time.time()


def _check_circuit_breaker():
    global CRAWLER_BLOCKED
    if _consecutive_failures >= _MAX_CONSECUTIVE_FAILURES:
        CRAWLER_BLOCKED = True
        return True
    return False


def _fetch_page(url, headers=None, retries=3):
    """GET 請求，帶重試和 rate limit"""
    global _consecutive_failures
    if _check_circuit_breaker():
        return None
    _rate_limit()
    if headers is None:
        headers = {
            "User-Agent": random.choice(UA_LIST),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.7",
            "Accept-Encoding": "gzip",
        }
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            resp = urllib.request.urlopen(req, timeout=15)
            data = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                data = gzip.GzipFile(fileobj=io.BytesIO(data)).read()
            _consecutive_failures = 0
            return data.decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                _consecutive_failures += 1
                if _check_circuit_breaker():
                    return None
            if attempt < retries - 1:
                time.sleep((attempt + 1) * 3)
        except Exception:
            if attempt < retries - 1:
                time.sleep((attempt + 1) * 2)
    _consecutive_failures += 1
    return None


def _graphql_post(lsd, doc_id, variables, friendly_name=""):
    """POST 到 Threads GraphQL API"""
    global _consecutive_failures
    if _check_circuit_breaker():
        return None
    _rate_limit()
    url = "https://www.threads.net/api/graphql"
    headers = {
        "User-Agent": random.choice(UA_LIST),
        "Content-Type": "application/x-www-form-urlencoded",
        "X-IG-App-ID": "238260118697367",
        "X-FB-LSD": lsd,
        "Origin": "https://www.threads.net",
        "Referer": "https://www.threads.net/",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
    }
    if friendly_name:
        headers["x-fb-friendly-name"] = friendly_name
    payload = urllib.parse.urlencode({
        "lsd": lsd,
        "variables": json.dumps(variables),
        "doc_id": doc_id,
    }).encode()
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        resp = urllib.request.urlopen(req, timeout=20)
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
        text = raw.decode("utf-8", errors="replace")
        if text.startswith("{"):
            data = json.loads(text)
            if data.get("data") and not data.get("errors"):
                _consecutive_failures = 0
                return data
        _consecutive_failures += 1
        return None
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            _consecutive_failures += 1
        return None
    except Exception:
        _consecutive_failures += 1
        return None


def _get_lsd_token():
    """從 Threads 頁面取得 LSD token（快取 5 分鐘）"""
    global _cached_lsd_token, _lsd_token_time
    if _cached_lsd_token and (time.time() - _lsd_token_time < 300):
        return _cached_lsd_token
    html = _fetch_page("https://www.threads.net/")
    if not html:
        return _cached_lsd_token or ""
    match = re.search(r'"LSD",\[\],\{"token":"([^"]+)"', html)
    if match:
        _cached_lsd_token = match.group(1)
        _lsd_token_time = time.time()
        return _cached_lsd_token
    return _cached_lsd_token or ""


def _get_user_id(username):
    """從 Threads 個人頁面取得 user_id（用 mobile UA 確保取得內嵌資料）"""
    mobile_headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.7",
        "Accept-Encoding": "gzip",
    }
    html = _fetch_page(f"https://www.threads.net/@{username}", headers=mobile_headers)
    if not html:
        return None
    clean = html.replace("\\s", "").replace("\\n", "")
    match = re.search(r'"user_id":"(\d+)"', clean)
    return match.group(1) if match else None


def _normalize_thread_post(post, source):
    """將 GraphQL 回傳的 post 物件正規化"""
    caption = post.get("caption", {}) or {}
    text = caption.get("text", "") if isinstance(caption, dict) else ""
    info = post.get("text_post_app_info", {}) or {}
    taken_at = post.get("taken_at", 0)
    date_str = datetime.fromtimestamp(taken_at).strftime("%Y-%m-%d") if taken_at else ""
    code = post.get("code", "")
    user = post.get("user", {}) or {}
    username = user.get("username", "")
    return {
        "source": source,
        "text": text[:300],
        "likes": post.get("like_count", 0) or 0,
        "comments": info.get("direct_reply_count", 0) or 0,
        "shares": (info.get("repost_count", 0) or 0) + (info.get("quote_count", 0) or 0),
        "views": info.get("view_count", 0) or 0,
        "date": date_str,
        "url": f"https://www.threads.net/@{username}/post/{code}" if code else "",
    }


# ─── 公開 API ───

def crawl_user_posts(username, max_posts=8):
    """爬取指定帳號的最新貼文"""
    lsd = _get_lsd_token()
    if not lsd:
        return []
    user_id = _get_user_id(username)
    if not user_id:
        return []
    result = _graphql_post(
        lsd=lsd,
        doc_id="6232751443445612",
        variables={"userID": user_id},
        friendly_name="BarcelonaProfileThreadsTabQuery",
    )
    if not result:
        return []
    media_data = result.get("data", {}).get("mediaData", {})
    threads = media_data.get("threads", [])
    posts = []
    for t in threads:
        for item in t.get("thread_items", []):
            post = item.get("post", {})
            if post:
                posts.append(_normalize_thread_post(post, f"@{username}"))
            if len(posts) >= max_posts:
                break
        if len(posts) >= max_posts:
            break
    return posts


def search_keyword(keyword, max_results=10, exclude_terms=None):
    """關鍵字搜尋熱門 Threads 貼文。

    Threads GraphQL 搜尋需要登入，因此改用 Claude CLI 的 WebSearch
    搜尋 `site:threads.net <keyword>`，挑出熱門貼文 URL，
    再 fetch permalink 解析貼文內容（透過 _fetch_post_by_url）。

    為了控制成本：每次只搜一個 keyword，回傳最多 max_results 篇。
    exclude_terms: 搜索時排除的詞（如 ["-因果", "-業力"]）
    """
    import subprocess
    import shutil

    claude_bin = os.environ.get("CLAUDE_PATH") or shutil.which("claude")
    if not claude_bin:
        return []

    # 組合排除詞到搜索查詢
    exclude_str = ""
    if exclude_terms:
        exclude_str = " " + " ".join(f"-{t}" for t in exclude_terms[:6])

    prompt = (
        f"用 WebSearch 搜尋 `site:threads.net {keyword}{exclude_str}`，"
        f"多搜幾個變體（例如加上「熱門」「高互動」等詞），"
        f"從結果中**只挑互動數明顯較高**的 {max_results} 篇 Threads 貼文 URL"
        f"（格式必須是 https://www.threads.net/@username/post/xxx）。"
        f"\n\n判斷標準：搜尋結果片段裡有按讚數 / 留言數的優先；"
        f"作者粉絲明顯較多的優先；發文時間在近 30 天內的優先；"
        f"避免挑那些只有 0-1 個讚或剛發出來沒人看的貼文。"
        f"\n\n⛔ 排除以下內容的貼文：因果、業力、前世、輪迴、風水、改運、開運物、星座運勢、看劇說八字、劇評、角色分析"
        f"\n\n只輸出 JSON 陣列，不要其他文字，格式："
        f'\n[{{"url":"...","author":"@username","preview":"前 80 字","est_engagement":"讚N 留言N 或 unknown"}}]'
        f"\n\n若搜不到符合條件的就輸出 []。"
    )
    try:
        result = subprocess.run(
            [claude_bin, "-p", "--allowedTools", "WebSearch", "--", prompt],
            capture_output=True, text=True, timeout=180,
            env={**os.environ, "CLAUDE_CODE_ENTRYPOINT": "cli"},
        )
        out = (result.stdout or "").strip()
        # 從輸出中抽出 JSON 陣列
        m = re.search(r"\[\s*(?:\{.*?\}\s*,?\s*)*\]", out, re.DOTALL)
        if not m:
            return []
        items = json.loads(m.group(0))
    except Exception as e:
        print(f"⚠️ search_keyword({keyword}) 失敗: {e}", flush=True)
        return []

    posts = []
    for it in items[:max_results]:
        url = (it.get("url") or "").strip()
        if not url or "threads.net" not in url:
            continue
        post = _fetch_post_by_url(url, fallback_text=it.get("preview", ""), fallback_author=it.get("author", ""))
        if post:
            posts.append(post)
    return posts


def search_threads(keyword, max_results=10):
    """用 Playwright 無頭瀏覽器直接搜索 Threads 熱門貼文。

    比 search_keyword() 更準確 — 直接渲染 Threads 搜索頁面，
    能拿到真實互動數據（讚/留言/轉發/分享）。

    需要：pip install playwright && playwright install chromium
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("⚠️ playwright 未安裝，改用 search_keyword()", flush=True)
        return search_keyword(keyword, max_results)

    SESSION_DIR = os.path.expanduser("~/.threads-session")
    posts = []
    try:
        with sync_playwright() as p:
            has_session = os.path.exists(SESSION_DIR) and os.listdir(SESSION_DIR)
            if has_session:
                # 用登入 session — 可看到更多搜索結果
                context = p.chromium.launch_persistent_context(
                    SESSION_DIR,
                    headless=True,
                    args=["--disable-blink-features=AutomationControlled"],
                    user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                               "AppleWebKit/537.36 (KHTML, like Gecko) "
                               "Chrome/125.0.0.0 Safari/537.36",
                )
                page = context.pages[0] if context.pages else context.new_page()
            else:
                # 未登入 — 只能看 3-5 篇
                browser = p.chromium.launch(headless=True)
                page = browser.new_page(
                    user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                               "AppleWebKit/537.36 (KHTML, like Gecko) "
                               "Chrome/125.0.0.0 Safari/537.36"
                )
                context = None

            encoded = urllib.parse.quote(keyword)
            url = f"https://www.threads.com/search?q={encoded}&serp_type=default"
            page.goto(url, timeout=20000)
            page.wait_for_timeout(5000)

            # 往下滾動載入更多（登入後可以滾更多）
            scroll_rounds = 8 if has_session else 3
            for _ in range(scroll_rounds):
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                page.wait_for_timeout(2500)

            body_text = page.inner_text("body")

            # 抓取所有貼文連結（/@username/post/CODE 格式）
            post_links = page.evaluate("""() => {
                const links = document.querySelectorAll('a[href*="/post/"]');
                return [...links].map(a => a.getAttribute('href')).filter(Boolean);
            }""")

            if context:
                context.close()
            else:
                browser.close()

            # 建立 username → post_url 對照表（同一 username 可能有多篇，按順序存）
            _user_post_urls = {}
            _post_url_re = re.compile(r'/@([a-zA-Z0-9_.]+)/post/([a-zA-Z0-9_-]+)')
            for link in post_links:
                m = _post_url_re.search(link)
                if m:
                    uname = m.group(1)
                    full_url = f"https://www.threads.net/@{uname}/post/{m.group(2)}"
                    if uname not in _user_post_urls:
                        _user_post_urls[uname] = []
                    if full_url not in _user_post_urls[uname]:
                        _user_post_urls[uname].append(full_url)
            # 追蹤每個 username 已分配到第幾個連結
            _user_url_index = {}

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

        # 用正則一次找出所有「4 個連續數字行」的模式（讚/留言/轉發/分享）
        # Threads 的文字輸出順序：username → topic? → date → text → Translate? → likes → comments → reposts → shares
        raw_lines = [l.strip() for l in body_text.split("\n") if l.strip()]
        # 移除分頁標記（如 "1/2", "2/5"）和單獨的 "/" 行
        lines = [l for l in raw_lines if l != "/" and not re.match(r'^\d+\s*/\s*\d+$', l)]

        # 找所有互動數據塊的位置（4 個連續的數字/K/M 行）
        num_pattern = re.compile(r'^[\d,.]+[KkMm]?$')
        blocks = []
        i = 0
        while i < len(lines) - 3:
            if (num_pattern.match(lines[i]) and num_pattern.match(lines[i+1])
                    and num_pattern.match(lines[i+2]) and num_pattern.match(lines[i+3])):
                blocks.append(i)
                i += 4
            else:
                i += 1

        # 對每個互動數據塊，往回掃描找 username 和 text
        username_pattern = re.compile(r'^[a-zA-Z0-9_.]{3,30}$')
        date_pattern = re.compile(r'^(\d+[dhwmy]|\d{2}/\d{2}/\d{2,4})$')
        # 導航元素和 UI 文字，不是帳號名
        nav_words = {
            "Search", "For you", "New thread", "Messages", "Activity",
            "Profile", "Insights", "Saved", "Feeds", "Edit", "Following",
            "Ghost posts", "More", "Top", "Recent", "Profiles",
            "Translate", "See translation", "Log in", "S", "",
        }
        skip_words = nav_words

        prev_end = 0
        for block_start in blocks:
            if len(posts) >= max_results:
                break
            likes = _parse_num(lines[block_start])
            comments = _parse_num(lines[block_start + 1])
            reposts = _parse_num(lines[block_start + 2])
            shares = _parse_num(lines[block_start + 3])

            # 往回找 username 和 text
            username = ""
            date_str = ""
            text_parts = []
            for j in range(prev_end, block_start):
                val = lines[j]
                if val in skip_words or num_pattern.match(val):
                    continue
                if not username and username_pattern.match(val) and val not in nav_words:
                    username = val
                    continue
                if not date_str and date_pattern.match(val):
                    date_str = val
                    continue
                # 跳過 topic 標籤（通常是短的中文詞，在 > 符號後）
                if val.startswith(">") or val.startswith("›"):
                    continue
                text_parts.append(val)

            if username and text_parts:
                full_text = "\n".join(text_parts)[:500]
                # 從預先抓取的連結中找對應的貼文 URL
                idx = _user_url_index.get(username, 0)
                if username in _user_post_urls and idx < len(_user_post_urls[username]):
                    post_url = _user_post_urls[username][idx]
                    _user_url_index[username] = idx + 1
                else:
                    post_url = f"https://www.threads.net/@{username}"
                posts.append({
                    "source": f"@{username}",
                    "date": date_str,
                    "text": full_text,
                    "likes": likes,
                    "comments": comments,
                    "reposts": reposts,
                    "shares": shares,
                    "views": 0,
                    "url": post_url,
                })
            prev_end = block_start + 4

    except Exception as e:
        print(f"⚠️ search_threads({keyword}) 失敗: {e}", flush=True)

    return posts


def _fetch_post_by_url(url, fallback_text="", fallback_author=""):
    """嘗試從 Threads 貼文 permalink 抓取互動數據。
    若公開頁面取得失敗，至少回傳 search 提供的 preview/author 作為 fallback。"""
    try:
        _rate_limit()
        req = urllib.request.Request(url, headers={
            "User-Agent": random.choice(UA_LIST),
            "Accept-Language": "zh-TW,zh;q=0.9",
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            html = raw.decode("utf-8", errors="ignore")
        # 從 og:description 抽文字
        text_match = re.search(r'<meta property="og:description" content="([^"]+)"', html)
        text = text_match.group(1) if text_match else fallback_text
        # 抓 likes / replies（從 JSON-LD 或 meta，盡量寬容）
        likes = 0
        like_match = re.search(r'"like_count":(\d+)', html)
        if like_match: likes = int(like_match.group(1))
        replies = 0
        rep_match = re.search(r'"text_post_app_info":\{[^}]*"direct_reply_count":(\d+)', html)
        if rep_match: replies = int(rep_match.group(1))
        author = fallback_author
        author_match = re.search(r'"username":"([^"]+)"', html)
        if author_match: author = "@" + author_match.group(1)
        return {
            "source": author or "@unknown",
            "date": "",
            "text": text[:500],
            "likes": likes,
            "comments": replies,
            "shares": 0,
            "views": 0,
            "url": url,
        }
    except Exception:
        if fallback_text or fallback_author:
            return {
                "source": fallback_author or "@unknown",
                "date": "",
                "text": fallback_text[:500],
                "likes": 0, "comments": 0, "shares": 0, "views": 0,
                "url": url,
            }
        return None


def discover_high_engagement_accounts(category, all_posts, existing_accounts):
    """從已爬到的貼文池中，挑出『高互動率』的新作者作為候選追蹤帳號。

    判斷標準（不看追蹤數，看互動）：
    - 每位作者貢獻 ≥ 2 篇貼文（避免一篇爆紅就誤判）
    - 平均單篇互動分數 ≥ 80（likes + comments*3 + shares*5）
    - 不在 existing_accounts 裡
    回傳：[{username, avg_score, post_count, sample_text, sample_url}]
    """
    from collections import defaultdict
    by_author = defaultdict(list)
    for p in all_posts:
        src = (p.get("source") or "").lstrip("@").strip()
        if not src or src == "unknown":
            continue
        by_author[src].append(p)

    existing_lower = {a.lower().lstrip("@") for a in existing_accounts}
    candidates = []
    for username, posts in by_author.items():
        if username.lower() in existing_lower:
            continue
        if len(posts) < 2:
            continue
        scores = [
            (p.get("likes", 0) + p.get("comments", 0) * 3 + p.get("shares", 0) * 5)
            for p in posts
        ]
        avg = sum(scores) / len(scores)
        if avg < 80:
            continue
        # 取互動最高的那篇當 sample
        best = max(posts, key=lambda p: p.get("likes", 0) + p.get("comments", 0) * 3)
        candidates.append({
            "username": username,
            "avg_score": round(avg, 1),
            "post_count": len(posts),
            "sample_text": (best.get("text") or "")[:120],
            "sample_url": best.get("url", ""),
            "category": category,
        })

    candidates.sort(key=lambda x: x["avg_score"], reverse=True)
    return candidates[:10]


def crawl_category(category, sources):
    """
    爬取某分類的帳號貼文 + 關鍵字搜尋，回傳摘要文字
    sources: {"accounts": [...], "keywords": [...]}
    直接替換 apify_crawl_category()
    """
    global CRAWLER_BLOCKED
    accounts = sources.get("accounts", [])
    keywords = sources.get("keywords", [])
    all_posts = []
    today = datetime.now()

    # 爬帳號：每個帳號抓更多貼文（25 篇），讓後續排序能挑到真正高流量的
    for acc in accounts[:4]:
        if CRAWLER_BLOCKED:
            break
        posts = crawl_user_posts(acc, max_posts=25)
        all_posts.extend(posts)

    # 爬關鍵字（最多 4 個，每個取 5 篇 — 用 Claude WebSearch 補足固定帳號的不足）
    search_exclude = sources.get("exclude_keywords", [])[:6]
    if keywords and not CRAWLER_BLOCKED:
        for kw in keywords[:4]:
            try:
                posts = search_keyword(kw, max_results=5, exclude_terms=search_exclude)
                if posts:
                    all_posts.extend(posts)
            except Exception as e:
                print(f"⚠️ keyword search {kw} 失敗: {e}", flush=True)
                continue

    # 過濾：只保留近 60 天（稍微放寬讓樣本夠）
    cutoff = today - timedelta(days=60)
    cutoff_str = cutoff.strftime("%Y-%m-%d")
    filtered = []
    for p in all_posts:
        d = p.get("date", "")[:10]
        if d >= cutoff_str or not d:
            filtered.append(p)

    # 排除：exclude_keywords 過濾（在排序前先清除不相關貼文）
    exclude_kws = [kw.lower() for kw in sources.get("exclude_keywords", [])]
    if exclude_kws:
        before_count = len(filtered)
        filtered = [p for p in filtered
                    if not any(kw in (p.get("text", "") + " " + p.get("source", "")).lower()
                               for kw in exclude_kws)]
        removed = before_count - len(filtered)
        if removed:
            print(f"🔍 exclude_keywords 過濾：移除 {removed} 篇不相關貼文", flush=True)

    # priority_keywords（用於排序加成）
    priority_kws = [kw.lower() for kw in sources.get("priority_keywords", [])]

    # 依互動數加權排序（留言/分享比按讚更貴）+ 時效加成 + 感情優先
    def _score(p):
        base = (
            p.get("likes", 0)
            + p.get("comments", 0) * 3
            + p.get("shares", 0) * 5
        )
        # 時效加成：近期貼文分數更高
        d = p.get("date", "")[:10]
        if d:
            try:
                days_ago = (today - datetime.strptime(d, "%Y-%m-%d")).days
                if days_ago <= 7: base *= 1.5
                elif days_ago <= 14: base *= 1.2
                elif days_ago > 30: base *= 0.6
            except ValueError:
                pass
        # 感情相關加成
        if priority_kws:
            text_lower = p.get("text", "").lower()
            if any(kw in text_lower for kw in priority_kws):
                base *= 1.3
        return base

    filtered.sort(key=_score, reverse=True)

    # 篩掉互動數過低的（避免「最新但沒人看」的貼文混進來）
    high_engagement = [p for p in filtered if _score(p) >= 50]
    if len(high_engagement) >= 5:
        top = high_engagement[:10]
    else:
        # 樣本不足時放寬門檻
        top = filtered[:10]

    if not top:
        return ""

    # 生成摘要（爆文等級 + 感情相關標記）
    lines = [f"📊 Threads 爬取結果 — {category}（近一個月熱門貼文 TOP {len(top)}）\n"]
    for i, p in enumerate(top, 1):
        likes = p.get('likes', 0)
        comments = p.get('comments', 0)
        shares = p.get('shares', 0)
        # 爆文等級標記
        if likes >= 5000:
            level = "🔥🔥🔥 全平台爆文"
        elif likes >= 1000:
            level = "🔥🔥 爆文"
        elif likes >= 100:
            level = "🔥 高流量"
        else:
            level = ""
        # 出圈指標：轉發 > 按讚的 10%
        viral_signal = " 📤出圈" if likes > 0 and shares > likes * 0.1 else ""
        # 高回覆（Threads 最重視）
        reply_signal = " 💬高回覆" if comments >= 50 else ""
        # 感情相關
        is_priority = priority_kws and any(kw in p.get("text", "").lower() for kw in priority_kws)
        priority_tag = " ⭐感情相關" if is_priority else ""
        tags = f"{level}{viral_signal}{reply_signal}{priority_tag}".strip()
        lines.append(f"--- 第 {i} 篇{' | ' + tags if tags else ''} ---")
        lines.append(f"來源：{p['source']}")
        if p["date"]:
            lines.append(f"日期：{p['date']}")
        lines.append(f"互動：讚 {likes} / 留言 {comments} / 分享 {shares}")
        if p.get("views"):
            lines.append(f"觀看：{p['views']}")
        if p.get("url"):
            lines.append(f"連結：{p['url']}")
        lines.append(f"內容：{p['text']}")
        lines.append("")

    # 存檔
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    today_str = today.strftime("%Y-%m-%d")
    crawl_dir = os.path.join(project_root, "research", "crawl-results", f"{today_str}-{category}")
    os.makedirs(crawl_dir, exist_ok=True)
    summary = "\n".join(lines)
    with open(os.path.join(crawl_dir, "summary.md"), "w", encoding="utf-8") as f:
        f.write(summary)
    with open(os.path.join(crawl_dir, "raw.json"), "w", encoding="utf-8") as f:
        json.dump(top, f, ensure_ascii=False, indent=2)

    # 海巡：從爬到的貼文池中發現高互動的「新」帳號（不在 accounts 裡的）
    try:
        candidates = discover_high_engagement_accounts(category, all_posts, accounts)
        if candidates:
            disc_path = os.path.join(project_root, "brand", "discovered_accounts.json")
            existing = []
            if os.path.exists(disc_path):
                try:
                    with open(disc_path, "r", encoding="utf-8") as f:
                        existing = json.load(f)
                except Exception:
                    existing = []
            # 合併去重（同 username 取較新的）
            by_user = {c["username"]: c for c in existing}
            for c in candidates:
                c["discovered_at"] = today_str
                by_user[c["username"]] = c
            with open(disc_path, "w", encoding="utf-8") as f:
                json.dump(list(by_user.values()), f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ discover_high_engagement_accounts 失敗: {e}", flush=True)

    return summary


def _extract_keywords(topic):
    """將主題拆解為搜尋關鍵字列表，支援複合主題（流行話題+專業主題）"""
    keywords = [topic]

    # 中文常見分隔：空格、頓號、逗號
    for sep in [" ", "、", "，", ",", "｜", "|"]:
        if sep in topic:
            keywords.extend([w.strip() for w in topic.split(sep) if w.strip()])

    # 中文語意連接詞拆解（「A看B」「A與B」「A的B」「A跟B」「A×B」等）
    for connector in ["看", "與", "的", "跟", "×", "x", "X", "聊", "談", "解析", "分析"]:
        if connector in topic:
            parts = topic.split(connector, 1)
            for part in parts:
                p = part.strip()
                if len(p) >= 2:
                    keywords.append(p)

    # 拆解長詞（>=4 字且無英文字母的中文嘗試拆半）
    if len(topic) >= 4 and not any(c.isascii() and c.isalpha() for c in topic):
        mid = len(topic) // 2
        keywords.append(topic[:mid])
        keywords.append(topic[mid:])

    # 去重保序
    seen = set()
    unique = []
    for k in keywords:
        if k not in seen and len(k) >= 2:
            seen.add(k)
            unique.append(k)
    return unique


def crawl_accounts_by_topic(accounts, topic, max_per_account=8):
    """
    爬取指定帳號，用主題關鍵字過濾相關貼文，回傳摘要文字
    accounts: list[str] — 帳號用戶名列表
    topic: str — 主題（用於關鍵字過濾）
    """
    global CRAWLER_BLOCKED
    keywords = _extract_keywords(topic)
    all_posts = []
    today = datetime.now()

    for acc in accounts[:5]:
        if CRAWLER_BLOCKED:
            break
        posts = crawl_user_posts(acc, max_posts=max_per_account)
        all_posts.extend(posts)

    # 過濾：只保留近 30 天
    cutoff = today - timedelta(days=30)
    cutoff_str = cutoff.strftime("%Y-%m-%d")
    filtered = []
    for p in all_posts:
        d = p.get("date", "")[:10]
        if d >= cutoff_str or not d:
            filtered.append(p)

    # 計算關鍵字相關度
    for p in filtered:
        text = p.get("text", "").lower()
        match_count = sum(1 for k in keywords if k.lower() in text)
        p["keyword_match"] = match_count

    # 排序：關鍵字匹配優先 + 互動數
    filtered.sort(
        key=lambda x: (
            x["keyword_match"] * 500
            + x["likes"] * 0.3
            + x["comments"] * 0.3
            + x["shares"] * 0.25
        ),
        reverse=True,
    )
    top = filtered[:10]

    if not top:
        return ""

    # 標記相關度
    relevant_count = sum(1 for p in top if p.get("keyword_match", 0) > 0)

    # 生成摘要
    lines = [f"📊 動態爬取結果 — 「{topic}」相關貼文 TOP {len(top)}（{relevant_count} 篇含關鍵字匹配）\n"]
    for i, p in enumerate(top, 1):
        lines.append(f"--- 第 {i} 篇 ---")
        lines.append(f"來源：{p['source']}")
        if p["date"]:
            lines.append(f"日期：{p['date']}")
        lines.append(f"互動：讚 {p['likes']} / 留言 {p['comments']} / 分享 {p['shares']}")
        if p.get("views"):
            lines.append(f"觀看：{p['views']}")
        if p.get("keyword_match", 0) > 0:
            lines.append(f"🔑 關鍵字匹配：{p['keyword_match']} 個")
        if p.get("url"):
            lines.append(f"連結：{p['url']}")
        lines.append(f"內容：{p['text']}")
        lines.append("")

    # 存檔
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    today_str = today.strftime("%Y-%m-%d")
    safe_topic = re.sub(r'[\\/*?:"<>|]', '_', topic)[:20]
    crawl_dir = os.path.join(project_root, "research", "crawl-results", f"{today_str}-dynamic-{safe_topic}")
    os.makedirs(crawl_dir, exist_ok=True)
    summary = "\n".join(lines)
    with open(os.path.join(crawl_dir, "summary.md"), "w", encoding="utf-8") as f:
        f.write(summary)
    with open(os.path.join(crawl_dir, "raw.json"), "w", encoding="utf-8") as f:
        # 移除臨時欄位
        export = [{k: v for k, v in p.items() if k != "keyword_match"} for p in top]
        json.dump(export, f, ensure_ascii=False, indent=2)

    return summary


# ─── 直接執行測試 ───
if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        username = sys.argv[1]
        print(f"爬取 @{username} 的貼文...")
        posts = crawl_user_posts(username, max_posts=3)
        for p in posts:
            print(f"  [{p['date']}] 讚{p['likes']} 留{p['comments']} | {p['text'][:60]}...")
    else:
        print("用法：python3 threads_crawler.py <username>")
        print("測試爬取 @bazitaro_cafe...")
        posts = crawl_user_posts("bazitaro_cafe", max_posts=3)
        print(f"取得 {len(posts)} 篇貼文")
        for p in posts:
            print(f"  [{p['date']}] 讚{p['likes']} | {p['text'][:60]}...")
