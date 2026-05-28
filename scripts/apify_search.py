"""
Apify API 封裝 — Threads (sortBy: popular) + IG 爬蟲
用於爆款牆的補充搜尋（Playwright 為主，Apify 補強）
"""
import os
import sys
import json
import time
import urllib.request
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 載入 .env
env_path = os.path.join(PROJECT_ROOT, '.env')
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())

APIFY_TOKEN = os.environ.get('APIFY_API_TOKEN', '')
APIFY_BASE = 'https://api.apify.com/v2'


def _apify_run(actor_id, input_data, timeout=300):
    """執行 Apify Actor 並等待結果"""
    if not APIFY_TOKEN:
        print("  ⚠️ APIFY_API_TOKEN 未設定", flush=True)
        return []

    # 啟動 Actor
    url = f"{APIFY_BASE}/acts/{actor_id}/runs?token={APIFY_TOKEN}"
    payload = json.dumps(input_data).encode('utf-8')
    req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            run_data = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print(f"  ⚠️ Apify 啟動失敗: {e}", flush=True)
        return []

    run_id = run_data.get('data', {}).get('id', '')
    if not run_id:
        print("  ⚠️ Apify 無 Run ID", flush=True)
        return []

    # 等待完成（每 5 秒檢查一次）
    for _ in range(timeout // 5):
        time.sleep(5)
        try:
            status_url = f"{APIFY_BASE}/actor-runs/{run_id}?token={APIFY_TOKEN}"
            with urllib.request.urlopen(status_url, timeout=15) as resp:
                status_data = json.loads(resp.read().decode('utf-8'))
            status = status_data.get('data', {}).get('status', '')
            if status == 'SUCCEEDED':
                dataset_id = status_data['data'].get('defaultDatasetId', '')
                if dataset_id:
                    items_url = f"{APIFY_BASE}/datasets/{dataset_id}/items?token={APIFY_TOKEN}&format=json"
                    with urllib.request.urlopen(items_url, timeout=30) as resp:
                        return json.loads(resp.read().decode('utf-8'))
                return []
            elif status in ('FAILED', 'ABORTED', 'TIMED-OUT'):
                print(f"  ⚠️ Apify 執行失敗: {status}", flush=True)
                return []
        except Exception:
            continue

    print("  ⚠️ Apify 超時", flush=True)
    return []


def apify_search_threads(keyword, max_posts=10):
    """用 Apify Threads Scraper 搜尋（sortBy: popular）"""
    print(f"  🔎 Apify Threads: 「{keyword}」(popular)...")
    items = _apify_run('apify~threads-scraper', {
        'searchTerms': [keyword],
        'maxPosts': max_posts,
        'sortBy': 'popular',
    })
    return _normalize_threads(items)


def apify_search_ig(hashtag, max_posts=5):
    """用 Apify IG Scraper 搜尋"""
    clean_tag = hashtag.lstrip('#')
    print(f"  🔎 Apify IG: #{clean_tag}...")
    items = _apify_run('apify~instagram-scraper', {
        'hashtags': [clean_tag],
        'resultsLimit': max_posts,
        'resultsType': 'posts',
    })
    return _normalize_ig(items)


def _normalize_threads(items):
    """將 Apify Threads 結果標準化"""
    posts = []
    for item in items:
        username = item.get('ownerUsername', '') or item.get('username', '')
        text = item.get('text', '') or item.get('caption', '') or ''
        code = item.get('shortCode', '') or item.get('code', '') or item.get('id', '')
        taken_at = item.get('timestamp', '') or item.get('createdAt', '')

        # 解析日期
        date_str = ''
        if taken_at:
            try:
                if isinstance(taken_at, (int, float)):
                    date_str = datetime.fromtimestamp(taken_at).strftime('%Y-%m-%d')
                elif isinstance(taken_at, str) and 'T' in taken_at:
                    date_str = taken_at[:10]
            except Exception:
                pass

        # 建構 URL
        url = ''
        if username and code:
            url = f"https://www.threads.net/@{username}/post/{code}"
        elif item.get('url'):
            url = item['url']

        posts.append({
            'url': url,
            'author': username,
            'text': text[:300],
            'likes': item.get('likesCount', 0) or item.get('likes', 0) or 0,
            'comments': item.get('repliesCount', 0) or item.get('comments', 0) or 0,
            'reposts': item.get('repostsCount', 0) or item.get('reposts', 0) or 0,
            'shares': item.get('sharesCount', 0) or 0,
            'date': date_str,
            'platform': 'threads',
            'source': 'apify',
        })
    return posts


def _normalize_ig(items):
    """將 Apify IG 結果標準化"""
    posts = []
    for item in items:
        username = item.get('ownerUsername', '') or ''
        text = item.get('caption', '') or ''
        shortcode = item.get('shortCode', '') or item.get('id', '')
        taken_at = item.get('timestamp', '') or item.get('takenAtTimestamp', '')

        date_str = ''
        if taken_at:
            try:
                if isinstance(taken_at, (int, float)):
                    date_str = datetime.fromtimestamp(taken_at).strftime('%Y-%m-%d')
                elif isinstance(taken_at, str) and 'T' in taken_at:
                    date_str = taken_at[:10]
            except Exception:
                pass

        url = f"https://www.instagram.com/p/{shortcode}/" if shortcode else ''

        posts.append({
            'url': url,
            'author': username,
            'text': text[:300],
            'likes': item.get('likesCount', 0) or item.get('likes', 0) or 0,
            'comments': item.get('commentsCount', 0) or item.get('comments', 0) or 0,
            'reposts': 0,
            'shares': 0,
            'date': date_str,
            'platform': 'ig',
            'source': 'apify',
        })
    return posts


# Apify 關鍵字設定
APIFY_KEYWORDS = {
    'bazi': {'threads': ['八字 十神', '八字 格局'], 'ig': ['八字', '命理']},
    'persona': {'threads': ['心理學 感情', '覺察 成長'], 'ig': ['心理學', '感情']},
    'other': {'threads': ['爆文 threads 2026', '熱門 觀點'], 'ig': ['自媒體']},
    'all': {'threads': ['八字 十神', '塔羅 占卜'], 'ig': ['八字', '心理學']},
}


def apify_full_search(category='bazi', threads_per_kw=5, ig_per_kw=3):
    """完整 Apify 搜尋（Threads popular + IG），回傳合併結果"""
    kws = APIFY_KEYWORDS.get(category, APIFY_KEYWORDS['all'])
    all_posts = []
    seen_urls = set()

    # Threads (sortBy: popular)
    for kw in kws.get('threads', []):
        results = apify_search_threads(kw, max_posts=threads_per_kw)
        for p in results:
            if p['url'] and p['url'] not in seen_urls:
                seen_urls.add(p['url'])
                all_posts.append(p)

    # IG
    for tag in kws.get('ig', []):
        results = apify_search_ig(tag, max_posts=ig_per_kw)
        for p in results:
            if p['url'] and p['url'] not in seen_urls:
                seen_urls.add(p['url'])
                all_posts.append(p)

    print(f"  ✅ Apify 共找到 {len(all_posts)} 篇（Threads + IG）")
    return all_posts


if __name__ == '__main__':
    # 測試用
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--category', '-c', default='bazi')
    args = parser.parse_args()
    posts = apify_full_search(args.category)
    for p in posts[:5]:
        print(f"  [{p['platform']}] @{p['author']} 讚:{p['likes']} — {p['text'][:60]}")
