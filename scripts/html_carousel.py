#!/usr/bin/env python3
"""
HTML 輪播圖渲染器
使用 Playwright + Jinja2 將 HTML 模板渲染為 PNG 圖片
"""
import os
import re
import html as _html
import json
import asyncio
from datetime import datetime
from typing import Optional, List, Dict
from pathlib import Path
from jinja2 import Environment, FileSystemLoader


def _apply_inline(s: str) -> str:
    """escape + ==x== → <span class='hl'>x</span>"""
    s = _html.escape(s or '')
    s = re.sub(r'==([^=\n]+)==', r'<span class="hl">\1</span>', s)
    return s


def _calc_compare_font_size(page):
    """根據對比卡片內容長度自動計算字體大小（8字剛好時縮小）"""
    left = page.get('col_left_content', '')
    right = page.get('col_right_content', '')
    max_len = max(len(left), len(right))
    left_lines = left.count('\n') + 1
    right_lines = right.count('\n') + 1
    max_lines = max(left_lines, right_lines)
    # 找最長的單行
    all_lines = left.split('\n') + right.split('\n')
    max_line_len = max((len(ln.strip()) for ln in all_lines), default=0)

    if max_line_len > 8 or max_len > 80 or max_lines > 10:
        return 26
    elif max_line_len > 7 or max_len > 50 or max_lines > 7:
        return 28
    else:
        return 30


def _apply_paragraphs(s: str, smart_split_threshold: int = 12) -> str:
    """escape + ==hl== + \\n\\n → <p>、單 \\n → <br>
    - 條列行（・/•/-/◆ 開頭）→ 左對齊 + hanging indent
    - 長行（>= smart_split_threshold 字且無 \\n）→ 智慧斷句（預設 12 → 積極斷句）"""
    if not s:
        return ''
    pre_lines = s.split('\n')
    processed = []
    for ln in pre_lines:
        if len(ln) >= smart_split_threshold and '\n' not in ln:
            ln = _balance_split_by_comma(ln, min_len=smart_split_threshold)
        processed.append(ln)
    s = '\n'.join(processed)

    escaped = _html.escape(s)
    escaped = re.sub(r'==([^=\n]+)==', r'<span class="hl">\1</span>', escaped)
    paragraphs = [p.strip() for p in escaped.split('\n\n') if p.strip()]

    BULLET_PREFIXES = ('・', '•', '‧', '◆', '◇', '★', '※', '- ', '— ')

    def _wrap_lines(p):
        lines = p.split('\n')
        has_bullet = any(any(ln.lstrip().startswith(b) for b in BULLET_PREFIXES) for ln in lines)
        if not has_bullet:
            return '<br>'.join(lines)
        out = []
        current_bullet = None  # 累積 bullet 及其續行（讓 hanging indent 生效）
        for line in lines:
            stripped = line.lstrip()
            if not stripped:
                # 空行 → 結束當前 bullet
                if current_bullet is not None:
                    out.append(f'<span class="bullet-line">{current_bullet}</span>')
                    current_bullet = None
                out.append('<span class="text-spacer"></span>')
            elif any(stripped.startswith(b) for b in BULLET_PREFIXES):
                # 新 bullet → flush 前一個
                if current_bullet is not None:
                    out.append(f'<span class="bullet-line">{current_bullet}</span>')
                current_bullet = stripped
            else:
                # 非 bullet 行
                if current_bullet is not None:
                    # 視為 bullet 的續行（合併進同一 span，讓 CSS hanging indent 生效）
                    current_bullet += stripped
                else:
                    out.append(f'<span class="text-line">{line}</span>')
        if current_bullet is not None:
            out.append(f'<span class="bullet-line">{current_bullet}</span>')
        return ''.join(out)

    return ''.join(f'<p>{_wrap_lines(p)}</p>' for p in paragraphs)


def _split_all_punct(text: str, sub_line_max: int = 6) -> str:
    """將文字在所有逗號/頓號/句號處斷行，移除行尾標點。
    - 句號/分號分段間會留空行
    - 每個分句若太長，再用連接詞/動詞在 sub_line_max 附近拆成兩行
    適合對比卡片多行短句的場景。
    """
    if not text:
        return text
    # 若 AI 已預先用 \n 分好行，直接尊重不動（只移除行尾標點）
    if '\n' in text.strip():
        out_lines = []
        for ln in text.split('\n'):
            stripped = ln.rstrip('，,、。;； ')
            out_lines.append(stripped)
        return '\n'.join(out_lines)
    # 所有逗號/句號都視為「段落分隔」，每段之間加空行
    GROUP_SEP = '，,、。;；'
    s = text.strip().replace('\n', '')
    raw_groups = []
    buf_phrase = ''
    for c in s:
        if c in GROUP_SEP:
            if buf_phrase.strip():
                raw_groups.append(buf_phrase.strip())
                buf_phrase = ''
        else:
            buf_phrase += c
    if buf_phrase.strip():
        raw_groups.append(buf_phrase.strip())

    groups = [[phrase] for phrase in raw_groups]

    # 每個分句（phrase）若太長，再拆一次
    CONJUNCTIONS = ['其實', '但是', '可是', '不過', '然而', '所以', '因為',
                    '就是', '就像', '比如', '而是', '並且', '於是', '雖然',
                    '只是', '只有', '只要', '即使', '如果', '不僅', '不是',
                    '反而', '畢竟', '甚至', '或許', '也許', '可能', '應該',
                    '卻是', '就算', '而且', '才能', '也能', '必須',
                    '能', '會', '要', '可以', '想要', '需要', '讓', '把']
    # 常見動詞/方位詞 → 在它們前面斷句比較自然
    SPLIT_BEFORE = ['站', '跑', '看', '想', '說', '做', '走', '回', '來', '去',
                    '用', '變', '向', '朝', '把', '被', '讓', '使', '給',
                    '成', '為', '從', '到', '在', '於', '以',
                    '開始', '結束', '準備', '打算',
                    '突然', '忽然', '於是', '然後']

    def _split_phrase(phrase):
        if len(phrase) <= sub_line_max:
            return [phrase]
        mid = len(phrase) // 2
        # min_side = 3 → 兩邊至少 3 字，避免孤字
        lo, hi = 3, len(phrase) - 3
        best = None
        best_dist = 999
        # 候選 1：CONJUNCTIONS（整個 phrase 範圍內找最靠中間）
        for kw in CONJUNCTIONS:
            idx = 0
            while True:
                idx = phrase.find(kw, idx)
                if idx < 0:
                    break
                if lo <= idx <= hi:
                    d = abs(idx - mid)
                    if d < best_dist:
                        best_dist = d
                        best = idx
                idx += 1
        # 候選 2：SPLIT_BEFORE（放寬容差到 ±3，仍需 lo/hi 邊界）
        if best is None or best_dist > 3:
            for kw in SPLIT_BEFORE:
                idx = 0
                while True:
                    idx = phrase.find(kw, idx)
                    if idx < 0:
                        break
                    if lo <= idx <= hi and abs(idx - mid) <= 3:
                        d = abs(idx - mid)
                        if d < best_dist:
                            best_dist = d
                            best = idx
                    idx += 1
        if best is not None:
            return [phrase[:best], phrase[best:]]
        # 都沒有 → 從中間硬切（但避開孤字：調整到最近的 lo-hi 範圍）
        cut = max(lo, min(mid, hi))
        return [phrase[:cut], phrase[cut:]]

    def _recursive_split(phrase):
        """遞迴切分直到每段 <= sub_line_max"""
        if len(phrase) <= sub_line_max:
            return [phrase]
        parts = _split_phrase(phrase)
        if len(parts) == 1 or parts == [phrase]:
            return [phrase]
        result = []
        for p in parts:
            result.extend(_recursive_split(p))
        return result

    out_groups = []
    for g in groups:
        lines = []
        for phrase in g:
            lines.extend(_recursive_split(phrase))
        out_groups.append(lines)

    # 如果全文只有一個 group（沒有標點）且拆出 ≥ 4 行 → 每 2 行自動分一段
    if len(out_groups) == 1 and len(out_groups[0]) >= 4:
        single = out_groups[0]
        out_groups = [single[i:i+2] for i in range(0, len(single), 2)]

    # 用空行分段
    return '\n\n'.join('\n'.join(g) for g in out_groups)


def _balance_split_by_comma(text: str, min_len: int = 12) -> str:
    # min_len：少於此長度不拆（預設 12 → 11 字以下保留原樣）
    """將長文字拆兩行，優先級：
    1. 逗號/頓號/句號（最自然斷點 → 拆完移除行尾標點）
    2. 連接詞前（其實/但是/可是/不過/然而/所以/因為/就是/就像/比如/而是/卻/並且/於是/而/讓/能/會/才/就/也/卻/才...）
    3. 空格
    4. 不拆
    儘量讓兩行字數接近，行尾的標點符號會被移除。
    """
    if not text:
        return text
    # 如果 AI 已按語意斷行（含 \n），保留原始斷行不重新拆
    if '\n' in text.strip():
        return text.strip()
    s = text.strip()
    if len(s) < min_len:
        return s
    # 引號/括號內的完整語句不拆（如「你若留下，我殺豬養你」）
    QUOTE_PAIRS = [('「', '」'), ('『', '』'), ('"', '"'), ('（', '）'), ('【', '】')]
    for lq, rq in QUOTE_PAIRS:
        if lq in s and rq in s:
            qi = s.index(lq)
            qe = s.rindex(rq)
            # 若引號包住大部分文字（>50%），不拆整行
            if (qe - qi) > len(s) * 0.5:
                return s
    mid = len(s) // 2
    PUNCT_TRIM = '，,、。;；'

    def _pick_closest(candidates):
        if not candidates:
            return None
        return min(candidates, key=lambda x: abs(x - mid))

    def _strip_eol_punct(line):
        return line.rstrip(PUNCT_TRIM + ' ')

    # Priority 1: 逗號/頓號/句號（拆於符號之後 + 移除行尾的標點）
    punct_positions = [i for i, c in enumerate(s) if c in PUNCT_TRIM]
    if punct_positions:
        best = _pick_closest(punct_positions)
        line1 = _strip_eol_punct(s[:best+1])
        line2 = _strip_eol_punct(s[best+1:].lstrip())
        if line2:
            return f"{line1}\n{line2}"

    # Priority 2: 連接詞前斷句
    CONJUNCTIONS = ['其實', '但是', '可是', '不過', '然而', '所以', '因為',
                    '就是', '就像', '比如', '而是', '並且', '於是', '雖然',
                    '只是', '只有', '只要', '即使', '如果', '不僅', '不是',
                    '反而', '畢竟', '甚至', '或許', '也許', '可能', '應該',
                    '至少', '至於', '對於', '關於', '何況',
                    '能', '會', '要', '可以', '想要', '需要', '讓', '把', '被']
    # 只考慮在中間 ±30% 範圍內的位置
    range_start = int(len(s) * 0.25)
    range_end = int(len(s) * 0.75)
    conj_positions = []
    for conj in CONJUNCTIONS:
        idx = s.find(conj, range_start)
        while 0 <= idx <= range_end:
            conj_positions.append(idx)
            idx = s.find(conj, idx + 1)
            if idx > range_end:
                break
    if conj_positions:
        best = _pick_closest(conj_positions)
        line1 = s[:best].rstrip()
        line2 = s[best:].lstrip()
        if line1 and line2:
            return f"{line1}\n{line2}"

    # Priority 3: 空格
    space_positions = [i for i, c in enumerate(s) if c == ' ']
    if space_positions:
        best = _pick_closest(space_positions)
        return s[:best].rstrip() + '\n' + s[best+1:].lstrip()

    # 沒有可拆點 → 不拆
    return s


def _apply_title_highlight(title: str, word: str) -> str:
    """把標題中的某個關鍵字包成 <span class='hl-accent'> 綠色"""
    escaped = _html.escape(title or '')
    if word:
        w = _html.escape(word)
        # 只替換第一次出現
        escaped = escaped.replace(w, f'<span class="hl-accent">{w}</span>', 1)
    return escaped

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
TEMPLATE_DIR = PROJECT_ROOT / 'templates' / 'carousel'

# ─── 模板名稱對照 ───
TEMPLATE_MAP = {
    'general_light': 'general_light.html',
    'editorial_serif': 'editorial_serif.html',
    'editorial_serif_wash': 'editorial_serif_wash.html',
    'editorial_banner': 'editorial_banner.html',
}

# ─── editorial_serif 色系定義 ───
def _hex_luminance(hex_color):
    """計算 hex 色的相對亮度 0-1"""
    if not hex_color or not hex_color.startswith('#') or len(hex_color) != 7:
        return 0.5
    try:
        r, g, b = int(hex_color[1:3], 16), int(hex_color[3:5], 16), int(hex_color[5:7], 16)
        return (0.299*r + 0.587*g + 0.114*b) / 255
    except Exception:
        return 0.5

def _load_editorial_palettes():
    try:
        path = PROJECT_ROOT / 'templates' / 'carousel' / 'editorial_palettes.json'
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        return {}
    # 自動：深色卡片上的黑線稿 → invert 變白線（AI 生純白底 + 黑線，PIL 去白後只剩黑線）
    for pid, pal in data.items():
        if 'col_left_img_filter' not in pal:
            left_bg = pal.get('col_left_bg') or (pal.get('colors', ['#FFFFFF', '#F0F0F0'])[1] if pal.get('colors') else '#F0F0F0')
            pal['col_left_img_filter'] = 'invert(1) brightness(1.2)' if _hex_luminance(left_bg) < 0.55 else 'none'
        if 'col_right_img_filter' not in pal:
            right_bg = pal.get('accent_bg') or pal.get('accent', '#888888')
            pal['col_right_img_filter'] = 'invert(1) brightness(1.2)' if _hex_luminance(right_bg) < 0.55 else 'none'
    return data

EDITORIAL_PALETTES = _load_editorial_palettes()

# ─── wash 色盤查詢 ───
WASH_PALETTE_LABELS = {
    'wash_snow_light': '皓白淡灰（定稿）',
    'wash_orange_green': '橙綠',
    'wash_earth': '大地沉穩',
    'wash_pink_gray': '粉灰（深色底）',
    'wash_blue': '藍調',
    'wash_morandi_pink': '莫蘭迪粉',
    'wash_morandi_blue': '莫蘭迪藍',
    'wash_milk_tea': '奶茶暖',
    'wash_sakura': '淡櫻',
    'wash_celadon': '青瓷',
}

def get_wash_palettes():
    """回傳 wash 系列色盤供 Discord 選單用"""
    return [{'id': pid, 'label': label, 'palette': EDITORIAL_PALETTES[pid]}
            for pid, label in WASH_PALETTE_LABELS.items() if pid in EDITORIAL_PALETTES]

def _darken(hex_color, amount=15):
    """將 hex 色加深"""
    r, g, b = int(hex_color[1:3], 16), int(hex_color[3:5], 16), int(hex_color[5:7], 16)
    return f"#{max(0,r-amount):02X}{max(0,g-amount):02X}{max(0,b-amount):02X}"

def _lighten(hex_color, amount=15):
    """將 hex 色調淡"""
    r, g, b = int(hex_color[1:3], 16), int(hex_color[3:5], 16), int(hex_color[5:7], 16)
    return f"#{min(255,r+amount):02X}{min(255,g+amount):02X}{min(255,b+amount):02X}"

# ─── 影視關鍵字偵測 ───
MOVIE_PATTERNS = [
    # 書名號包裹的標題
    r'[《「]([^》」]+)[》」]',
    # 常見影視關鍵字
    r'(?:電影|影集|電視劇|韓劇|日劇|美劇|陸劇|台劇|動畫|紀錄片)\s*[《「]?([^》」\s,，。、]+)',
    # 劇名+角色
    r'(?:主角|角色|演員|導演|劇中|片中|劇情|劇照)\s*[《「]?([^》」\s,，。、]+)',
]


def detect_movie_content(text: str) -> Optional[str]:
    """偵測文案中是否提及特定影視作品，回傳作品名稱或 None"""
    for pattern in MOVIE_PATTERNS:
        match = re.search(pattern, text)
        if match:
            title = match.group(1).strip()
            # 過濾太短或太通用的匹配
            if len(title) >= 2 and title not in ('一個', '這個', '那個', '什麼', '自己'):
                return title
    return None


def _compute_body_size(max_body_len: int) -> int:
    """以整組輪播中最長的內文為基準決定 body 字級（44 → 36）"""
    if max_body_len <= 90:
        return 46
    if max_body_len <= 130:
        return 44
    if max_body_len <= 170:
        return 42
    if max_body_len <= 220:
        return 40
    return 38


def _compute_title_size(title: str, base: int) -> int:
    """標題單行：根據最長行字數縮放，確保單行呈現"""
    if not title:
        return base
    longest = max((len(line) for line in title.split('\n')), default=0)
    if longest <= 8:
        return base
    if longest <= 10:
        return int(base * 0.92)
    if longest <= 12:
        return int(base * 0.84)
    if longest <= 14:
        return int(base * 0.76)
    return int(base * 0.68)


def _compute_quote_size(content: str) -> int:
    """金句：根據總字數決定字級（最多 2 行）"""
    n = len(content or '')
    if n <= 18:
        return 78
    if n <= 26:
        return 70
    if n <= 36:
        return 62
    return 54


def _apply_accent_words(escaped_text: str, accent_words: list) -> str:
    """在已 escape 的文字裡，把 accent_words 第一次出現包成 <span class="accent">"""
    if not accent_words:
        return escaped_text
    out = escaped_text
    for w in accent_words:
        if not w:
            continue
        ew = _html.escape(w)
        out = out.replace(ew, f'<span class="accent">{ew}</span>', 1)
    return out


def _prepare_page_context(page: dict, total_pages: int, brand_mark: str,
                          movie_title: str = None, bg_image: str = None,
                          top_category_override: str = None,
                          body_font_size: int = 44) -> dict:
    """將 page dict 轉換為模板渲染 context"""
    page_num = page.get('page', 1)
    page_type = page.get('type', 'content')
    content = page.get('content', '')
    section_label = page.get('section_label', '')
    title = page.get('title', section_label)

    ctx = {
        'page_type': page_type,
        'page': page_num,
        'page_num': f"{page_num:02d}",
        'total_pages': total_pages,
        'brand_mark': brand_mark,
        'section_label': section_label,
        'title': title,
        'content': content,
        'movie_title': movie_title,
        'bg_image': bg_image,
        'top_category': top_category_override or page.get('top_category', '八字觀察'),
        'edition_label': page.get('edition_label', str(datetime.now().year)),
        'chips': page.get('chips', []) or [],
        'highlight_word': page.get('highlight_word', ''),
        'subtitle': page.get('subtitle', ''),
        'body_font_size': body_font_size,
        # editorial_serif 專用
        'layout_variant': page.get('layout_variant', ''),
        'section_label_en': page.get('section_label_en', ''),
        'series_label': page.get('series_label', ''),
        'show_subtitle': page.get('show_subtitle', True),
        'subtitle_font_size': page.get('subtitle_font_size', 32),
        'items': page.get('items', []),
        'steps': [
            {**s, 'body': _balance_split_by_comma(s.get('body', ''))}
            for s in (page.get('steps', []) or [])
        ],
        'col_left_title': page.get('col_left_title', ''),
        'col_left_content': _split_all_punct(page.get('col_left_content', '')),
        'col_right_title': page.get('col_right_title', ''),
        'col_right_content': _split_all_punct(page.get('col_right_content', '')),
        'col_left_illust': page.get('col_left_illust', ''),
        'col_right_illust': page.get('col_right_illust', ''),
        'big_number': page.get('big_number', ''),
        'cta_text': page.get('cta_text', ''),
        'cta_small': page.get('cta_small', ''),
        'total_pages_str': page.get('total_pages_str', ''),
        'accent_words': page.get('accent_words', []) or [],
        'illustration_path': page.get('illustration_path', ''),
        'illustration_mode': page.get('illustration_mode', 'none'),
        'illust_scale': page.get('illust_scale', 1.0),
        'illust_left': page.get('illust_left', None),
        'illust_right': page.get('illust_right', None),
        'illust_top': page.get('illust_top', None),
        'illust_bottom': page.get('illust_bottom', None),
        'illust_width': page.get('illust_width', None),
        'illust_height': page.get('illust_height', None),
        'illust_opacity': page.get('illust_opacity', None),
        'illust_mode': page.get('illust_mode', ''),
        'illust_offset_x': page.get('illust_offset_x', 0),
        'handle': page.get('handle', '@jhen_insightlab'),
        'concept_tag': page.get('concept_tag', ''),
        'compare_layout': page.get('compare_layout', 'inset'),
        'compare_font_size': _calc_compare_font_size(page),
        'tag_block': page.get('tag_block', ''),
        'tag_desc': page.get('tag_desc', ''),
        'tag_bar': page.get('tag_bar', ''),
        'banner_text': page.get('banner_text', ''),
        'bazi_grid': page.get('bazi_grid', None),
        'cover_style': page.get('cover_style', ''),
        'title_color': page.get('title_color', ''),
        'highlight_style': page.get('highlight_css', ''),
        'note_small': page.get('note_small', ''),
        'palette_obj': page.get('palette_obj') or EDITORIAL_PALETTES.get(page.get('palette', 'sand'), EDITORIAL_PALETTES.get('sand', {})),
    }

    # 自動縮放：標題單行保證
    base_title = 104 if page_type == 'cover' else 78
    if page_type == 'cover' and section_label == 'FOLLOW':
        base_title = 78
    # editorial layouts 用自己的基準
    if ctx['layout_variant'] == 'cover_illust':
        base_title = 96
    elif ctx['layout_variant'] == 'photo_overlay':
        base_title = 84
    ctx['title_font_size'] = _compute_title_size(title, base_title)
    # editorial 內文字級依字數縮放
    if ctx['layout_variant'] == 'photo_overlay':
        n = len(content or '')
        if n <= 60: ctx['body_font_size'] = 36
        elif n <= 100: ctx['body_font_size'] = 32
        elif n <= 150: ctx['body_font_size'] = 28
        else: ctx['body_font_size'] = 26

    # Quote 自動字級
    if page_type == 'quote':
        ctx['quote_font_size'] = _compute_quote_size(content)

    # 預處理 HTML（螢光筆 + 分段 + 標題強調字）
    if ctx['layout_variant']:
        # editorial_serif：用 accent_words 套 .accent class，title 保留 \n
        ctx['title_html'] = _apply_accent_words(_html.escape(title or ''), ctx['accent_words']).replace('\n', '<br>')
        ctx['subtitle_html'] = _apply_accent_words(_html.escape(ctx['subtitle'] or ''), ctx['accent_words']).replace('\n', '<br>')
        # narrative 內文：依 has-illust 做智慧斷句，長行自動拆
        ed_content = content or ''
        if ctx['layout_variant'] in ('narrative', 'cta_button', 'closing', 'bazi_narrative', 'bazi_closing'):
            has_illust = bool(page.get('illustration_path'))
            threshold = 12 if has_illust else 22
            # 逐行套 _balance_split_by_comma（保留既有 \n）
            processed_lines = []
            for ln in ed_content.split('\n'):
                if len(ln) >= threshold:
                    ln = _balance_split_by_comma(ln, min_len=threshold)
                processed_lines.append(ln)
            ed_content = '\n'.join(processed_lines)
        content_with_accent = _apply_accent_words(_html.escape(ed_content), ctx['accent_words'])
        # narrative/cta_button：移除 pre-line，改用 HTML 控制換行和段落間距
        if ctx['layout_variant'] in ('narrative', 'cta_button', 'bazi_narrative'):
            # \n\n → 段落間距（para-gap）；\n → <br> 換行
            content_with_accent = re.sub(
                r'\n\s*\n',
                '<span class="para-gap"></span>',
                content_with_accent
            )
            content_with_accent = content_with_accent.replace('\n', '<br>')
        # closing 特殊處理：列點用 bullet-group 包裹（置中對齊中列點靠左）
        # 非 ・ 開頭但緊接列點的行 → 視為延續行，保持在 bullet-group 內
        if ctx['layout_variant'] in ('closing', 'bazi_closing'):
            lines = content_with_accent.split('\n')
            result_parts = []
            bullet_buf = []
            for ln in lines:
                stripped = ln.strip()
                is_bullet = stripped.startswith('・') or stripped.startswith('‧') or stripped.startswith('•')
                if is_bullet:
                    bullet_buf.append(f'<span class="bullet-line">{ln}</span>')
                elif bullet_buf and stripped and stripped != '':
                    # 延續行：跟在列點後的非空行，用 continuation 樣式靠左對齊
                    bullet_buf.append(f'<span class="bullet-cont">{ln}</span>')
                else:
                    if bullet_buf:
                        result_parts.append('<span class="bullet-group">' + ''.join(bullet_buf) + '</span>')
                        bullet_buf = []
                    # 空行 → 小間隔；一般行 → text-line block
                    if not stripped:
                        result_parts.append('<span class="text-spacer"></span>')
                    else:
                        result_parts.append(f'<span class="text-line">{ln}</span>')
            if bullet_buf:
                result_parts.append('<span class="bullet-group">' + ''.join(bullet_buf) + '</span>')
            ctx['content_html'] = '\n'.join(result_parts)
        else:
            ctx['content_html'] = content_with_accent
    elif page_type == 'cover':
        ctx['title_html'] = _apply_title_highlight(title, ctx['highlight_word'])
        ctx['subtitle_html'] = _apply_inline(ctx['subtitle'] or content)
        ctx['content_html'] = _apply_inline(content)
    elif page_type == 'quote':
        ctx['title_html'] = _apply_inline(title)
        ctx['content_html'] = _apply_inline(content)
    else:
        ctx['title_html'] = _apply_title_highlight(title, ctx['highlight_word'])
        # has-illust 容器較窄 → 閾值 12（積極斷句）；無 illust → 寬容器，閾值 22（短句保留）
        has_illust = bool(page.get('illustration_path'))
        ctx['content_html'] = _apply_paragraphs(content, smart_split_threshold=12 if has_illust else 22)

    # 特殊頁面類型的額外資料
    if page_type == 'toc':
        items = page.get('items', [])
        if not items and content:
            items = [line.strip() for line in content.split('\n') if line.strip()]
        ctx['items'] = items

    elif page_type == 'quote':
        ctx['quote_source'] = page.get('quote_source', '')

    elif page_type == 'comparison':
        ctx['col_left_title'] = page.get('col_left_title', 'A')
        ctx['col_left_content'] = _split_all_punct(page.get('col_left_content', ''))
        ctx['col_right_title'] = page.get('col_right_title', 'B')
        ctx['col_right_content'] = _split_all_punct(page.get('col_right_content', ''))
        # 自動調整字體：根據最長一側的行數/字數縮小
        left_len = len(page.get('col_left_content', ''))
        right_len = len(page.get('col_right_content', ''))
        max_len = max(left_len, right_len)
        left_lines = page.get('col_left_content', '').count('\n') + 1
        right_lines = page.get('col_right_content', '').count('\n') + 1
        max_lines = max(left_lines, right_lines)
        if max_len > 80 or max_lines > 10:
            ctx['compare_font_size'] = 26
        elif max_len > 50 or max_lines > 7:
            ctx['compare_font_size'] = 28
        else:
            ctx['compare_font_size'] = 30

    elif page_type == 'strategy':
        items = page.get('items', [])
        if not items and content:
            lines = [line.strip() for line in content.split('\n') if line.strip()]
            items = [{'text': line} for line in lines]
        processed = []
        for it in items:
            processed.append({
                'label': it.get('label', ''),
                'text_html': _apply_paragraphs(it.get('text', '')),
            })
        ctx['items'] = processed

    return ctx


async def render_carousel_html(
    pages: List[Dict],
    topic: str,
    template: str,
    output_dir: str,
    brand_mark: str = "JHEN'S INSIGHT LAB",
    movie_title: str = None,
    image_mapping: list = None,
    top_category: str = None,
) -> List[str]:
    """
    將輪播頁面渲染為 PNG 圖片

    Args:
        pages: [{page, type, section_label, content, title, ...}, ...]
        topic: 主題名稱
        template: 模板名稱（如 'general_dark'）
        output_dir: 輸出目錄
        brand_mark: 品牌標記文字
        movie_title: 影視作品名稱（影視模板用）
        image_mapping: [{page: 1, image_path: "..."}, ...] 圖文配對

    Returns:
        生成的圖片路徑列表
    """
    template_file = TEMPLATE_MAP.get(template)
    if not template_file:
        raise ValueError(f"未知模板: {template}，可用: {list(TEMPLATE_MAP.keys())}")

    # 設定 Jinja2
    env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)))
    tmpl = env.get_template(template_file)

    # 建立圖文對照表
    img_map = {}
    if image_mapping:
        for mapping in image_mapping:
            pg = mapping.get('page')
            path = mapping.get('image_path', '')
            if pg and path and os.path.exists(path):
                # 轉為 file:// URI
                img_map[pg] = f"file://{os.path.abspath(path)}"

    os.makedirs(output_dir, exist_ok=True)
    total_pages = len(pages)
    generated = []

    # 以最長 content 為基準決定全組 body 字級
    max_body_len = max(
        (len(p.get('content', '') or '') for p in pages if p.get('type') not in ('cover', 'quote')),
        default=0,
    )
    body_font_size = _compute_body_size(max_body_len)

    # 用 Playwright 渲染每頁
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page_obj = await browser.new_page(viewport={'width': 1080, 'height': 1350})

        for page_data in pages:
            page_num = page_data.get('page', 1)

            # 取得該頁的背景圖
            bg_image = img_map.get(page_num)

            # editorial_serif：image_mapping 直接當 illustration_path
            if template.startswith('editorial_serif') and bg_image and not page_data.get('illustration_path'):
                page_data['illustration_path'] = bg_image

            # editorial_serif 系列：把 illustration_path file:// 轉成 base64 data URI
            # （Playwright set_content 不允許 file:// 載入本地檔案）
            # ⚠️ 使用 COPY 避免污染原始 page dict（session 需要保留 file:// 路徑）
            def _to_data_uri(ip):
                if not ip or not ip.startswith('file://'):
                    return ip
                try:
                    import base64
                    local = ip.replace('file://', '')
                    with open(local, 'rb') as f:
                        b64 = base64.b64encode(f.read()).decode('ascii')
                    ext = 'jpeg' if local.lower().endswith(('.jpg', '.jpeg')) else 'png'
                    return f'data:image/{ext};base64,{b64}'
                except Exception as e:
                    print(f"⚠️ data-uri failed: {e}", flush=True)
                    return ''
            # 用淺 copy 避免污染原始 page dict（session 需保留 file:// 路徑）
            import copy
            render_page = copy.copy(page_data)
            if template.startswith('editorial_serif') or template == 'editorial_banner':
                for k in ('illustration_path', 'col_left_illust', 'col_right_illust'):
                    if render_page.get(k):
                        render_page[k] = _to_data_uri(render_page[k])

            # 準備渲染 context（用 render_page 而非 page_data，避免污染原始 session）
            ctx = _prepare_page_context(
                render_page, total_pages, brand_mark,
                movie_title=movie_title, bg_image=bg_image,
                top_category_override=top_category,
                body_font_size=body_font_size,
            )

            # 渲染 HTML
            html = tmpl.render(**ctx)

            # 載入 HTML 並截圖
            await page_obj.set_content(html, wait_until='networkidle')
            output_path = os.path.join(output_dir, f"page_{page_num:02d}.png")
            await page_obj.screenshot(path=output_path, full_page=False)
            generated.append(output_path)

        await browser.close()

    return generated


async def match_images_to_pages(
    pages: List[Dict],
    image_paths: List[str],
    carousel_text: str,
    run_claude_fn=None,
) -> List[Dict]:
    """
    用 Claude 分析文案與圖片的配對關係

    Args:
        pages: 輪播頁面資料
        image_paths: 上傳的圖片路徑列表
        carousel_text: 輪播文案全文
        run_claude_fn: 呼叫 Claude 的函數

    Returns:
        [{page: 1, image_path: "...", reason: "..."}, ...]
    """
    if not run_claude_fn:
        # 預設均勻分配
        result = []
        for i, page in enumerate(pages):
            if i < len(image_paths):
                result.append({
                    'page': page.get('page', i + 1),
                    'image_path': image_paths[i],
                    'reason': '順序分配',
                })
        return result

    # 建立圖片描述
    image_list = '\n'.join([
        f"圖片{chr(65+i)}：{os.path.basename(p)}"
        for i, p in enumerate(image_paths)
    ])

    # 頁面摘要
    page_list = '\n'.join([
        f"第{p.get('page', i+1)}頁（{p.get('type', 'content')}）：{p.get('section_label', '')} — {p.get('content', '')[:80]}"
        for i, p in enumerate(pages)
    ])

    prompt = f"""你是一個輪播圖排版助手。以下是輪播貼文的每頁內容和可用的劇照圖片。
請分析文案內容，將圖片分配到最適合的頁面。

## 輪播頁面
{page_list}

## 可用圖片
{image_list}

## 規則
- 每張圖片最多用一次
- 封面頁（cover）優先分配最有代表性的圖片
- 如果文案提到特定角色或場景，配對相關圖片
- 不是每頁都需要圖片，只配對適合的頁面
- 回傳 JSON 格式

請回傳：
```json
[
  {{"page": 1, "image": "A", "reason": "封面用主視覺"}},
  {{"page": 3, "image": "B", "reason": "提到角色X的場景"}}
]
```"""

    # 加入圖片讀取指令
    for i, path in enumerate(image_paths):
        prompt += f"\n\n請用 Read 工具查看圖片{chr(65+i)}：{path}"

    raw = await asyncio.to_thread(run_claude_fn, prompt)

    # 解析 JSON
    try:
        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', raw)
        if json_match:
            mappings = json.loads(json_match.group(1))
        else:
            mappings = json.loads(raw.strip())

        result = []
        for m in mappings:
            img_idx = ord(m.get('image', 'A')) - 65
            if 0 <= img_idx < len(image_paths):
                result.append({
                    'page': m['page'],
                    'image_path': image_paths[img_idx],
                    'reason': m.get('reason', ''),
                })
        return result
    except Exception as e:
        print(f"⚠️ 圖文配對解析失敗: {e}", flush=True)
        # fallback: 順序分配
        return [
            {'page': pages[i].get('page', i+1), 'image_path': image_paths[i], 'reason': '順序分配'}
            for i in range(min(len(pages), len(image_paths)))
        ]


def get_available_templates(has_movie: bool = False) -> List[Dict]:
    """取得可用模板列表"""
    templates = [
        {'id': 'general_light', 'label': '☀️ HOW-TO GUIDE', 'desc': '莫蘭迪綠 HOW-TO GUIDE 編輯風格'},
        {'id': 'editorial_serif_wash', 'label': '🖌️ 渲染古風', 'desc': '皓白底渲染 + 古風宋體（多色盤）'},
    ]
    if has_movie:
        templates.append({'id': 'editorial_serif', 'label': '📰 Editorial', 'desc': '實色背景 editorial 排版'})
    return templates


# ─── 測試用 ───
if __name__ == '__main__':
    test_pages = [
        {'page': 1, 'type': 'cover', 'title': '測試標題', 'content': '這是副標題測試'},
        {'page': 2, 'type': 'content', 'section_label': '第一章', 'title': '內容標題', 'content': '這是正文內容測試。\n\n這裡有第二段。'},
        {'page': 3, 'type': 'quote', 'section_label': '金句', 'content': '看見慣性，轉化命運', 'quote_source': 'JHEN'},
    ]

    async def test():
        output = await render_carousel_html(
            pages=test_pages,
            topic='測試',
            template='general_dark',
            output_dir='/tmp/carousel_test',
            brand_mark="JHEN'S INSIGHT LAB",
        )
        print(f"生成 {len(output)} 張圖片：{output}")

    asyncio.run(test())
