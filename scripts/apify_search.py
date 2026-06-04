"""
Apify API 封裝 — Threads (sortBy: popular) + IG scraper
用於爆款牆混合爬蟲，補充 Playwright 的搜尋結果
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
    """啟動 Apify Actor 並等待結果"""
    if not APIFY_TOKEN:
        print("  ⚠️ APIFY_API_TOKEN 未設定")
        return []

    url = f"{APIFY_BASE}/acts/{actor_id}/runs?token={APIFY_TOKEN}"
    data = json.dumps(input_data).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            run_id = result.get('data', {}).get('id', '')
            if not run_id:
                print(f"  ⚠️ Apify 啟動失敗")
                return []
    except Exception as e:
        print(f"  ⚠️ Apify 啟動錯誤: {e}")
        return []

    for _ in range(60):
        time.sleep(5)
        try:
            status_url = f"{APIFY_BASE}/actor-runs/{run_id}?token={APIFY_TOKEN}"
            with urllib.request.urlopen(status_url, timeout=15) as resp:
                status_data = json.loads(resp.read())
                status = status_data.get('data', {}).get('status', '')
                if status == 'SUCCEEDED':
                    dataset_id = status_data['data'].get('defaultDatasetId', '')
                    if dataset_id:
                        items_url = f"{APIFY_BASE}/datasets/{dataset_id}/items?token={APIFY_TOKEN}&format=json"
                        with urllib.request.urlopen(items_url, timeout=30) as items_resp:
                            return json.loads(items_resp.read())
                    return []
                elif status in ('FAILED', 'ABORTED', 'TIMED-OUT'):
                    print(f"  ⚠️ Apify run {status}")
                    return []
        except Exception:
            pass

    print("  ⚠️ Apify 超時")
    return []


def apify_search_threads(keyword, max_posts=10):
    """用 Apify Threads Scraper 搜尋（sortBy: popular）"""
    print(f"  🔎 Apify Threads 搜尋「{keyword}」(popular)...")
    raw = _apify_run('apify/threads-scraper', {
        'searchTerms': [keyword],
        'maxPosts': max_posts,
        'sortBy': 'popular',
    })

    posts = []
    for item in raw:
        text = item.get('text', '') or item.get('caption', '') or ''
        username = item.get('username', '') or item.get('ownerUsername', '') or ''
        url = item.get('url', '') or ''
        if not url and username:
            code = item.get('shortCode', '') or item.get('id', '')
            url = f"https://www.threads.net/@{username}/post/{code}" if code else f"https://www.threads.net/@{username}"

        taken_at = item.get('timestamp', '') or item.get('createdAt', '')
        date_str = ''
        if taken_at:
            try:
                if isinstance(taken_at, (int, float)):
                    date_str = datetime.fromtimestamp(taken_at).strftime('%Y-%m-%d')
                elif isinstance(taken_at, str) and len(taken_at) >= 10:
                    date_str = taken_at[:10]
            except Exception:
                pass

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
        })

    print(f"  ✅ Apify Threads 找到 {len(posts)} 篇")
    return posts


def apify_search_ig(hashtag, max_posts=5):
    """用 Apify IG Scraper 搜尋"""
    clean_tag = hashtag.lstrip('#')
    print(f"  🔎 Apify IG 搜尋「#{clean_tag}」...")
    raw = _apify_run('apify/instagram-scraper', {
        'hashtags': [clean_tag],
        'resultsLimit': max_posts,
        'resultsType': 'posts',
    })

    posts = []
    for item in raw:
        text = item.get('caption', '') or ''
        username = item.get('ownerUsername', '') or ''
        url = item.get('url', '') or ''
        taken_at = item.get('timestamp', '') or item.get('takenAtTimestamp', '')
        date_str = ''
        if taken_at:
            try:
                if isinstance(taken_at, (int, float)):
                    date_str = datetime.fromtimestamp(taken_at).strftime('%Y-%m-%d')
                elif isinstance(taken_at, str) and len(taken_at) >= 10:
                    date_str = taken_at[:10]
            except Exception:
                pass

        posts.append({
            'url': url,
            'author': username,
            'text': text[:300],
            'likes': item.get('likesCount', 0) or 0,
            'comments': item.get('commentsCount', 0) or 0,
            'reposts': 0,
            'date': date_str,
            'platform': 'ig',
        })

    print(f"  ✅ Apify IG 找到 {len(posts)} 篇")
    return posts


APIFY_KEYWORDS = {
    'bazi': {'threads': ['八字 十神', '八字 格局'], 'ig': ['#八字', '#命理']},
    'tarot': {'threads': ['塔羅 覺察', '塔羅 感情'], 'ig': ['#塔羅', '#牌卡']},
    'mindful': {'threads': ['正念 修行', '覺察 成長'], 'ig': ['#正念', '#覺察']},
    'persona': {'threads': ['心理學 感情', '覺察 成長'], 'ig': ['#心理學', '#感情']},
    'all': {'threads': ['八字 十神', '塔羅 覺察'], 'ig': ['#八字', '#塔羅']},
    'other': {'threads': ['爆文 threads', '熱門 觀點'], 'ig': ['#自媒體']},
}


def apify_full_search(category='bazi'):
    """完整 Apify 搜尋：Threads popular + IG"""
    kw_config = APIFY_KEYWORDS.get(category, APIFY_KEYWORDS['all'])
    all_posts = []

    for kw in kw_config.get('threads', []):
        posts = apify_search_threads(kw, max_posts=5)
        all_posts.extend(posts)

    for tag in kw_config.get('ig', []):
        posts = apify_search_ig(tag, max_posts=3)
        all_posts.extend(posts)

    print(f"  ✅ Apify 完整搜尋 [{category}] 共 {len(all_posts)} 篇")
    return all_posts


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Apify 搜尋測試')
    parser.add_argument('--threads', '-t', help='Threads 搜尋關鍵字')
    parser.add_argument('--ig', '-i', help='IG hashtag 搜尋')
    parser.add_argument('--count', '-n', type=int, default=5)
    args = parser.parse_args()

    if args.threads:
        results = apify_search_threads(args.threads, args.count)
        for r in results:
            print(f"  @{r['author']} 讚:{r['likes']} — {r['text'][:60]}...")
    if args.ig:
        results = apify_search_ig(args.ig, args.count)
        for r in results:
            print(f"  @{r['author']} 讚:{r['likes']} — {r['text'][:60]}...")
