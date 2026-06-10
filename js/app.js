/**
 * Insight Lab — 內容創作工作台
 * 前端邏輯：頁面導航 + 各功能頁面
 */

const API_BASE = window.location.protocol === 'file:'
  ? 'http://localhost:8080'
  : window.location.origin;

async function apiCall(endpoint, body, method) {
  try {
    var opts = {};
    if (!method) method = body ? 'POST' : 'GET';
    opts.method = method;
    opts.headers = { 'Content-Type': 'application/json' };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    const res = await fetch(API_BASE + endpoint, opts);
    if (!res.ok) {
      const err = await res.json().catch(function() { return {}; });
      throw new Error(err.error || 'HTTP ' + res.status);
    }
    return await res.json();
  } catch (e) {
    if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
      return null;
    }
    throw e;
  }
}

// ── API Health Check ──
(async function checkApi() {
  const el = document.getElementById('apiStatus');
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (res.ok) {
      el.classList.add('online');
      el.querySelector('.api-label').textContent = '已連線';
    } else { throw new Error(); }
  } catch {
    el.classList.remove('online');
    el.querySelector('.api-label').textContent = '離線';
  }
  setTimeout(checkApi, 30000);
})();

// ── Page Navigation ──

const sidebarItems = document.querySelectorAll('.sidebar-item');
const tabItems = document.querySelectorAll('.tab-item[data-page]');
const pages = document.querySelectorAll('.page');
const sidebar = document.getElementById('sidebar');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const moreTab = document.getElementById('moreTab');

function switchPage(pageId) {
  // Update pages
  pages.forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`page-${pageId}`);
  if (target) target.classList.add('active');

  // Update sidebar
  sidebarItems.forEach(item => {
    item.classList.toggle('active', item.dataset.page === pageId);
  });

  // Update bottom tabs
  tabItems.forEach(item => {
    item.classList.toggle('active', item.dataset.page === pageId);
  });

  // Close mobile sidebar
  sidebar.classList.remove('open');

  // Update URL hash
  window.location.hash = pageId;

  // Lazy-load pages
  if (pageId === 'templates' && typeof loadTemplatePage === 'function') loadTemplatePage();
  if (pageId === 'notion-collection' && typeof renderNotionCollectionPage === 'function') renderNotionCollectionPage();
}

// Sidebar click
sidebarItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    switchPage(item.dataset.page);
  });
});

// Bottom tab click
tabItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    switchPage(item.dataset.page);
  });
});

// Mobile menu toggle
mobileMenuBtn.addEventListener('click', () => {
  sidebar.classList.toggle('open');
});

// More tab (mobile) → toggle sidebar
if (moreTab) {
  moreTab.addEventListener('click', (e) => {
    e.preventDefault();
    sidebar.classList.toggle('open');
  });
}

// Handle URL hash on load
const initialPage = window.location.hash.replace('#', '') || 'inspiration';
switchPage(initialPage);


// ── Viral Analyzer: Inline Image Attach ──

const imageFileInput = document.getElementById('imageFileInput');
const attachPreviews = document.getElementById('attachPreviews');
let attachedFiles = [];

const fileUploadInput = document.getElementById('fileUploadInput');

imageFileInput.addEventListener('change', (e) => {
  for (const file of e.target.files) {
    if (!file.type.startsWith('image/')) continue;
    attachedFiles.push(file);
  }
  imageFileInput.value = '';
  renderAttachPreviews();
});

fileUploadInput.addEventListener('change', (e) => {
  for (const file of e.target.files) {
    attachedFiles.push(file);
  }
  fileUploadInput.value = '';
  renderAttachPreviews();
});

function renderAttachPreviews() {
  attachPreviews.innerHTML = '';
  if (!attachedFiles.length) {
    attachPreviews.classList.add('hidden');
    return;
  }
  attachPreviews.classList.remove('hidden');
  attachedFiles.forEach((file, idx) => {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const thumb = document.createElement('div');
        thumb.className = 'attach-thumb';
        thumb.innerHTML = `
          <img src="${e.target.result}" alt="">
          <button class="attach-thumb-remove">&times;</button>
        `;
        thumb.querySelector('.attach-thumb-remove').addEventListener('click', () => {
          attachedFiles.splice(idx, 1);
          renderAttachPreviews();
        });
        attachPreviews.appendChild(thumb);
      };
      reader.readAsDataURL(file);
    } else {
      // Non-image file: show file chip
      const chip = document.createElement('div');
      chip.className = 'attach-file-chip';
      const ext = file.name.split('.').pop().toUpperCase();
      chip.innerHTML = `
        <span class="attach-file-icon">📄</span>
        <span class="attach-file-name">${file.name.length > 20 ? file.name.slice(0, 18) + '...' : file.name}</span>
        <button class="attach-chip-remove">&times;</button>
      `;
      chip.querySelector('.attach-chip-remove').addEventListener('click', () => {
        attachedFiles.splice(idx, 1);
        renderAttachPreviews();
      });
      attachPreviews.appendChild(chip);
    }
  });
}

// Also support paste image into textarea
document.getElementById('viralInput').addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        attachedFiles.push(file);
        renderAttachPreviews();
      }
    }
  }
});


// ── Viral Analyzer ──

const viralInput = document.getElementById('viralInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const loadingState = document.getElementById('loadingState');
const loadingText = document.getElementById('loadingText');
const loadingBar = document.getElementById('loadingBar');
const statsBar = document.getElementById('statsBar');
const statTotal = document.getElementById('statTotal');
const statPicked = document.getElementById('statPicked');
const resultsArea = document.getElementById('resultsArea');

const LOADING_STEPS = [
  { text: '正在解析貼文數據⋯', progress: 15 },
  { text: '計算互動數據排名⋯', progress: 30 },
  { text: '提煉爆文精華⋯', progress: 50 },
  { text: '拆解開頭公式與分析⋯', progress: 70 },
  { text: '產生可直接套用的模板⋯', progress: 90 },
];

// Keyboard shortcut
viralInput.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    analyzeBtn.click();
  }
});

// ── Viral Analyzer: Pillar Selector ──
var currentViralPillar = '八字';
document.querySelectorAll('#viralPillarSelector .pill').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('#viralPillarSelector .pill').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    currentViralPillar = btn.dataset.pillar;
  });
});

analyzeBtn.addEventListener('click', async () => {
  const input = viralInput.value.trim();
  const hasImages = attachedFiles.length > 0;
  if (!input && !hasImages) {
    viralInput.focus();
    viralInput.style.borderColor = '#e74c3c';
    setTimeout(() => viralInput.style.borderColor = '', 2000);
    return;
  }

  // Show loading
  loadingState.classList.remove('hidden');
  statsBar.classList.add('hidden');
  resultsArea.classList.add('hidden');
  resultsArea.innerHTML = '';
  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML = '<span class="btn-icon">⏳</span><span>分析中...</span>';

  // Start loading animation
  let loadingIdx = 0;
  const loadingInterval = setInterval(() => {
    if (loadingIdx < LOADING_STEPS.length) {
      loadingText.textContent = LOADING_STEPS[loadingIdx].text;
      loadingBar.style.width = LOADING_STEPS[loadingIdx].progress + '%';
      loadingIdx++;
    }
  }, 3000);

  loadingText.textContent = LOADING_STEPS[0].text;
  loadingBar.style.width = LOADING_STEPS[0].progress + '%';

  // Collect image data — convert File objects to base64
  var imageData = [];
  if (hasImages) {
    imageData = await Promise.all(attachedFiles.map(function(file) {
      return new Promise(function(resolve) {
        if (typeof file === 'string') { resolve(file); return; }
        if (file.data) { resolve(file.data); return; }
        var reader = new FileReader();
        reader.onload = function(ev) { resolve(ev.target.result); };
        reader.onerror = function() { resolve(''); };
        reader.readAsDataURL(file);
      });
    }));
  }

  // Try real API first
  let result = null;
  try {
    result = await apiCall('/api/analyze-viral', {
      text: input,
      images: imageData,
      pillar: currentViralPillar
    });
  } catch (e) {
    console.log('API error, using mock:', e.message);
  }

  clearInterval(loadingInterval);

  if (!result) {
    // Fallback to mock
    for (let i = loadingIdx; i < LOADING_STEPS.length; i++) {
      loadingText.textContent = LOADING_STEPS[i].text;
      loadingBar.style.width = LOADING_STEPS[i].progress + '%';
      await sleep(400);
    }
    result = generateMockAnalysis(input);
    result = {
      total_posts: result.totalPosts,
      analyses: result.analyses.map(a => ({
        author: a.author,
        hook_type: a.hookType,
        hook_formula: a.hookFormula,
        similar_hooks: a.similarHooks,
        why_viral: a.whyViral,
        likes: a.likes, comments: a.comments,
        reposts: a.reposts, shares: a.shares,
        templates: a.templates,
        matched_template_id: '', matched_template_name: '',
        sample_post: '', sample_pillar: currentViralPillar,
        fact_checks: [],
      })),
    };
  }

  // Complete loading
  loadingBar.style.width = '100%';
  await sleep(300);
  loadingState.classList.add('hidden');

  // Normalize field names
  const analyses = (result.analyses || []).map(a => ({
    author: a.author || '分析結果',
    originalText: a.original_text || '',
    hookType: a.hook_type || a.hookType || '—',
    hookFormula: a.hook_formula || a.hookFormula || '—',
    similarHooks: a.similar_hooks || a.similarHooks || [],
    whyViral: a.why_viral || a.whyViral || '—',
    likes: a.likes || '—', comments: a.comments || '—',
    reposts: a.reposts || '—', shares: a.shares || '—',
    templates: a.templates || [],
    matchedTemplateId: a.matched_template_id || '',
    matchedTemplateName: a.matched_template_name || '',
    samplePost: a.sample_post || '',
    samplePillar: a.sample_pillar || currentViralPillar,
    factChecks: a.fact_checks || [],
    rawText: a.raw_text || '',
  }));

  // Show stats
  statTotal.textContent = result.total_posts || analyses.length;
  statPicked.textContent = analyses.length;
  statsBar.classList.remove('hidden');

  // Show results
  renderResults(analyses);
  resultsArea.classList.remove('hidden');

  // Reset button
  analyzeBtn.disabled = false;
  analyzeBtn.innerHTML = '<span class="btn-icon">✨</span><span>開始拆解</span>';
});

function renderResults(analyses) {
  resultsArea.innerHTML = analyses.map((a, i) => {
    var fcHtml = '';
    if (a.factChecks && a.factChecks.length > 0) {
      fcHtml = a.factChecks.map(function(fc) {
        return '<div class="fc-item"><span class="fc-status">' + (fc.status || '—') + '</span> <strong>' + (fc.content || '') + '</strong><br><span class="fc-note">' + (fc.note || '') + '</span></div>';
      }).join('');
    }

    var sampleHtml = '';
    if (a.samplePost) {
      var escapedPost = a.samplePost.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      sampleHtml = `
        <div class="result-section sample-section">
          <div class="result-section-title">
            ${a.matchedTemplateName ? '<span class="template-badge">' + a.matchedTemplateName + '</span>' : ''}
            套用範文（${a.samplePillar}）
          </div>
          <div class="sample-post-container">
            <pre class="sample-post-text" id="samplePost${i}">${escapedPost}</pre>
            <div class="sample-actions">
              <button class="btn btn-sm btn-outline" onclick="handleSampleAction(${i}, 'suggest')">
                <span>💡</span> 給建議調整
              </button>
              <button class="btn btn-sm btn-outline" onclick="handleSampleAction(${i}, 'edit')">
                <span>✏️</span> 編輯文案
              </button>
              <button class="btn btn-sm btn-outline" onclick="handleSampleAction(${i}, 'rewrite')">
                <span>🔄</span> 重新生成
              </button>
              <button class="btn btn-sm btn-outline" onclick="handleSampleAction(${i}, 'factcheck')">
                <span>🔍</span> 事實查核
              </button>
              <button class="btn btn-sm btn-primary" onclick="handleSampleAction(${i}, 'copy')">
                <span>📋</span> 複製文案
              </button>
            </div>
            <div class="save-notion-row">
              <button class="save-notion-btn" id="saveBtn${i}" onclick="saveAnalysisToNotion(${i})">⭐ 收藏到 Notion</button>
              <span class="save-status" id="saveStatus${i}"></span>
            </div>
            <div class="sample-feedback hidden" id="sampleFeedback${i}"></div>
          </div>
        </div>`;
    }

    return `
    <div class="result-card${i === 0 ? ' open' : ''}" data-index="${i}">
      <div class="result-card-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="result-card-num">${i + 1}</span>
        <span class="result-card-title">${a.author}</span>
        ${a.matchedTemplateName ? '<span class="template-tag">' + a.matchedTemplateName + '</span>' : ''}
        <span class="result-card-toggle">▼</span>
      </div>
      <div class="result-card-body">
        <div class="result-section">
          <div class="result-section-title">HOOK 開頭公式拆解</div>
          <div class="result-content">
            <ol>
              <li><strong>開頭類型：</strong>${a.hookType}</li>
              <li><strong>公式拆解：</strong>${a.hookFormula}</li>
              <li><strong>類似句子（你的領域改寫）：</strong>
                <ul>${a.similarHooks.map(h => '<li>' + h + '</li>').join('')}</ul>
              </li>
              <li><strong>為什麼會紅：</strong>${a.whyViral}</li>
            </ol>
          </div>
        </div>

        <div class="result-section">
          <div class="result-section-title">互動數據</div>
          <div class="result-engagement">
            <span>❤️ ${a.likes || '—'}</span>
            <span>💬 ${a.comments || '—'}</span>
            <span>🔄 ${a.reposts || '—'}</span>
            <span>📤 ${a.shares || '—'}</span>
          </div>
        </div>

        <div class="result-section">
          <div class="result-section-title">可直接套用格式</div>
          <div class="result-content">
            <ol>${a.templates.map(t => '<li>' + t + '</li>').join('')}</ol>
          </div>
        </div>

        ${sampleHtml}

        ${fcHtml ? '<div class="result-section"><div class="result-section-title">🔍 事實查核</div><div class="fact-check-list">' + fcHtml + '</div></div>' : ''}
      </div>
    </div>`;
  }).join('');

  // Store analyses globally for action handlers
  window._viralAnalyses = analyses;
}

// ── Sample Post Action Handlers ──
var _actionLoading = {};

async function handleSampleAction(index, action) {
  var analyses = window._viralAnalyses || [];
  var a = analyses[index];
  if (!a) return;

  var feedbackEl = document.getElementById('sampleFeedback' + index);
  var postEl = document.getElementById('samplePost' + index);
  if (!feedbackEl || !postEl) return;

  if (action === 'copy') {
    var text = a.samplePost || postEl.textContent;
    try {
      await navigator.clipboard.writeText(text);
      feedbackEl.classList.remove('hidden');
      feedbackEl.innerHTML = '<div class="feedback-success">✅ 已複製到剪貼簿</div>';
      setTimeout(function() { feedbackEl.classList.add('hidden'); }, 2000);
    } catch(e) {
      feedbackEl.classList.remove('hidden');
      feedbackEl.innerHTML = '<div class="feedback-error">複製失敗，請手動選取</div>';
    }
    return;
  }

  if (action === 'edit') {
    if (postEl.contentEditable === 'true') {
      postEl.contentEditable = 'false';
      postEl.classList.remove('editing');
      var editedText = postEl.textContent;
      feedbackEl.classList.remove('hidden');
      feedbackEl.innerHTML = '<div class="feedback-actions"><button class="btn btn-sm btn-primary" onclick="submitEdit(' + index + ')">送出修改（AI 潤稿+查核）</button><button class="btn btn-sm btn-outline" onclick="cancelEdit(' + index + ')">取消</button></div>';
      a._editedText = editedText;
    } else {
      postEl.contentEditable = 'true';
      postEl.classList.add('editing');
      postEl.focus();
      feedbackEl.classList.remove('hidden');
      feedbackEl.innerHTML = '<div class="feedback-hint">✏️ 直接在上方編輯文案，完成後再次點擊「編輯文案」</div>';
    }
    return;
  }

  if (_actionLoading[index]) return;
  _actionLoading[index] = true;

  feedbackEl.classList.remove('hidden');
  feedbackEl.innerHTML = '<div class="feedback-loading">⏳ 處理中...</div>';

  try {
    if (action === 'suggest') {
      var res = await apiCall('/api/template-adjust', {
        post: a.samplePost, action: 'suggest', pillar: a.samplePillar
      });
      if (res && res.suggestions) {
        var html = '<div class="suggestions-list"><h4>💡 調整建議</h4>';
        res.suggestions.forEach(function(s) {
          html += '<div class="suggestion-item"><strong>' + s.point + '</strong>';
          if (s.before) html += '<div class="sg-before">修改前：' + s.before + '</div>';
          if (s.after) html += '<div class="sg-after">修改後：' + s.after + '</div>';
          if (s.reason) html += '<div class="sg-reason">' + s.reason + '</div>';
          html += '</div>';
        });
        html += '</div>';
        feedbackEl.innerHTML = html;
      } else {
        feedbackEl.innerHTML = '<div class="feedback-error">無法取得建議</div>';
      }
    } else if (action === 'rewrite') {
      var res = await apiCall('/api/template-adjust', {
        post: a.samplePost, action: 'rewrite', pillar: a.samplePillar
      });
      if (res && res.rewritten_post) {
        a.samplePost = res.rewritten_post;
        postEl.textContent = res.rewritten_post;
        feedbackEl.innerHTML = '<div class="feedback-success">✅ 已重新生成</div>';
        setTimeout(function() { feedbackEl.classList.add('hidden'); }, 2000);
      } else {
        feedbackEl.innerHTML = '<div class="feedback-error">重新生成失敗</div>';
      }
    } else if (action === 'factcheck') {
      var res = await apiCall('/api/fact-check', {
        post: postEl.textContent, pillar: a.samplePillar
      });
      if (res && res.fact_checks) {
        var html = '<div class="fact-check-result"><h4>🔍 事實查核結果</h4>';
        if (res.overall) html += '<div class="fc-overall">' + res.overall + '</div>';
        res.fact_checks.forEach(function(fc) {
          html += '<div class="fc-item"><span class="fc-status">' + fc.status + '</span> <strong>' + fc.content + '</strong><br><span class="fc-note">' + fc.note + '</span>';
          if (fc.source) html += '<br><span class="fc-source">📎 ' + fc.source + '</span>';
          html += '</div>';
        });
        html += '</div>';
        feedbackEl.innerHTML = html;
      } else {
        feedbackEl.innerHTML = '<div class="feedback-error">查核失敗</div>';
      }
    }
  } catch(e) {
    feedbackEl.innerHTML = '<div class="feedback-error">操作失敗：' + e.message + '</div>';
  }
  _actionLoading[index] = false;
}

async function submitEdit(index) {
  var analyses = window._viralAnalyses || [];
  var a = analyses[index];
  if (!a || !a._editedText) return;
  var feedbackEl = document.getElementById('sampleFeedback' + index);
  var postEl = document.getElementById('samplePost' + index);
  feedbackEl.innerHTML = '<div class="feedback-loading">⏳ AI 潤稿+查核中...</div>';
  try {
    var res = await apiCall('/api/template-adjust', {
      post: a.samplePost, action: 'apply_edit', pillar: a.samplePillar, user_edit: a._editedText
    });
    if (res && res.polished_post) {
      a.samplePost = res.polished_post;
      postEl.textContent = res.polished_post;
      var html = '<div class="feedback-success">✅ 已潤稿完成</div>';
      if (res.fact_checks && res.fact_checks.length > 0) {
        html += '<div class="fact-check-result"><h4>🔍 查核結果</h4>';
        res.fact_checks.forEach(function(fc) {
          html += '<div class="fc-item"><span class="fc-status">' + fc.status + '</span> <strong>' + fc.content + '</strong><br><span class="fc-note">' + fc.note + '</span></div>';
        });
        html += '</div>';
      }
      feedbackEl.innerHTML = html;
    }
  } catch(e) {
    feedbackEl.innerHTML = '<div class="feedback-error">潤稿失敗：' + e.message + '</div>';
  }
}

function cancelEdit(index) {
  var feedbackEl = document.getElementById('sampleFeedback' + index);
  var postEl = document.getElementById('samplePost' + index);
  var analyses = window._viralAnalyses || [];
  var a = analyses[index];
  if (a) postEl.textContent = a.samplePost;
  feedbackEl.classList.add('hidden');
}

function generateMockAnalysis(input) {
  var lines = input.split('\n').filter(l => l.trim());
  var postCount = Math.max(1, Math.floor(lines.length / 3));
  return {
    totalPosts: postCount,
    analyses: [{
      author: '示範帖文分析',
      hookType: '情境代入型 + 痛點呼喚型',
      hookFormula: '描述讀者日常場景的痛點 + 帶出專業身份的衝突感',
      similarHooks: [
        '你是不是總覺得，另一半怎麼都不懂你在氣什麼？',
        '每次吵完架，你是不是那個先道歉的人？',
        '為什麼你的感情總是走到同一個死胡同？',
      ],
      whyViral: '用日常感情場景讓 25-38 歲女性瞬間對號入座',
      likes: '—', comments: '—', reposts: '—', shares: '—',
      templates: [
        '[用你的領域開頭：描述一個具體的感情/人際場景]',
        '[點出痛點：「不是不愛，是...」的翻轉句]',
        '[帶入專業概念（八字/十神/牌卡），自然不生硬]',
        '[具體可執行的建議]',
        '[餘韻結尾：引發反思的一句話]',
      ],
    }],
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ── URL Detection: Auto-crawl Threads URLs ──

const THREADS_URL_REGEX = /https?:\/\/(www\.)?threads\.net\/@[^\s]+/i;

function detectThreadsUrl(text) {
  var match = text.match(THREADS_URL_REGEX);
  return match ? match[0] : null;
}

// Inject URL detection into analyzeBtn click — patch the existing handler
(function patchAnalyzeForUrlCrawl() {
  var origClick = analyzeBtn.onclick;
  var origListeners = analyzeBtn._patchedUrlCrawl;
  if (origListeners) return;
  analyzeBtn._patchedUrlCrawl = true;

  var origHandler = null;
  analyzeBtn.addEventListener('click', async function urlCrawlIntercept(e) {
    var input = viralInput.value.trim();
    var threadsUrl = detectThreadsUrl(input);
    if (!threadsUrl) return; // let original handler proceed

    // If entire input is just a URL, crawl it first
    if (input.replace(threadsUrl, '').trim().length < 10) {
      e.stopImmediatePropagation();
      loadingState.classList.remove('hidden');
      loadingText.textContent = '正在爬取 Threads 貼文...';
      loadingBar.style.width = '20%';
      analyzeBtn.disabled = true;
      analyzeBtn.innerHTML = '<span class="btn-icon">⏳</span><span>爬取中...</span>';

      try {
        var crawlResult = await apiCall('/api/crawl-thread', { url: threadsUrl });
        if (crawlResult && crawlResult.text) {
          var enriched = '';
          if (crawlResult.author) enriched += '帳號：' + crawlResult.author + '\n';
          enriched += '❤️ ' + (crawlResult.likes || 0) + ' 💬 ' + (crawlResult.comments || 0) + '\n';
          enriched += '來源：' + threadsUrl + '\n\n';
          enriched += crawlResult.text;
          viralInput.value = enriched;
          loadingText.textContent = '爬取成功，開始分析...';
          loadingBar.style.width = '40%';
          // Trigger the real analysis
          setTimeout(function() {
            loadingState.classList.add('hidden');
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = '<span class="btn-icon">✨</span><span>開始拆解</span>';
            analyzeBtn.click();
          }, 500);
          return;
        }
      } catch (err) {
        console.log('URL crawl failed:', err);
      }
      loadingState.classList.add('hidden');
      analyzeBtn.disabled = false;
      analyzeBtn.innerHTML = '<span class="btn-icon">✨</span><span>開始拆解</span>';
    }
  }, true); // capture phase so it runs first
})();


// ── Save to Notion + localStorage ──

function getSavedCollection() {
  try {
    return JSON.parse(localStorage.getItem('viralCollection') || '[]');
  } catch(e) { return []; }
}

function saveToCollection(analysis) {
  var collection = getSavedCollection();
  var entry = {
    id: Date.now().toString(36),
    savedAt: new Date().toISOString(),
    author: analysis.author || '',
    hookType: analysis.hookType || '',
    hookFormula: analysis.hookFormula || '',
    whyViral: analysis.whyViral || '',
    similarHooks: analysis.similarHooks || [],
    matchedTemplateName: analysis.matchedTemplateName || '',
    samplePost: analysis.samplePost || '',
    samplePillar: analysis.samplePillar || '',
    factChecks: analysis.factChecks || [],
    likes: analysis.likes, comments: analysis.comments,
    reposts: analysis.reposts, shares: analysis.shares,
    originalText: analysis.originalText || '',
  };
  collection.unshift(entry);
  if (collection.length > 100) collection = collection.slice(0, 100);
  localStorage.setItem('viralCollection', JSON.stringify(collection));
  return entry;
}

function removeFromCollection(id) {
  var collection = getSavedCollection().filter(function(e) { return e.id !== id; });
  localStorage.setItem('viralCollection', JSON.stringify(collection));
  renderCollectionPage();
}

window.saveAnalysisToNotion = async function(index) {
  var analyses = window._viralAnalyses || [];
  var a = analyses[index];
  if (!a) return;

  var btn = document.getElementById('saveBtn' + index);
  var statusEl = document.getElementById('saveStatus' + index);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 儲存中...'; }

  // Save to localStorage first
  var localEntry = saveToCollection(a);

  // Then try Notion
  try {
    var res = await apiCall('/api/notion/save-analysis', { analysis: a });
    if (res && res.url) {
      if (statusEl) statusEl.innerHTML = '✅ 已收藏 — <a href="' + res.url + '" target="_blank">在 Notion 查看</a>';
      if (btn) btn.textContent = '✅ 已收藏';
    } else {
      if (statusEl) statusEl.innerHTML = '✅ 已存到本地（Notion 同步失敗）';
      if (btn) btn.textContent = '⭐ 已存本地';
    }
  } catch(e) {
    if (statusEl) statusEl.innerHTML = '✅ 已存到本地（Notion: ' + e.message + '）';
    if (btn) btn.textContent = '⭐ 已存本地';
  }
};


// ── Template Library Page ──

var _templatesLoaded = false;

async function loadTemplatePage() {
  if (_templatesLoaded) return;
  var grid = document.getElementById('templateGrid');
  if (!grid) return;

  try {
    var res = await apiCall('/api/templates/details');
    if (!res || !res.templates) throw new Error('no data');
    _templatesLoaded = true;

    grid.innerHTML = res.templates.map(function(t, i) {
      var emoji = t.name.split(' ')[0] || '📄';
      var name = t.name.replace(/^[^\s]+\s*/, '');
      var detailHtml = '';
      if (t.format) {
        detailHtml += '<div class="tpl-detail-section"><div class="tpl-detail-title">格式結構</div><div class="tpl-detail-code">' + t.format.replace(/</g,'&lt;') + '</div></div>';
      }
      if (t.sample) {
        detailHtml += '<div class="tpl-detail-section"><div class="tpl-detail-title">範例</div><div class="tpl-detail-code">' + t.sample.replace(/</g,'&lt;') + '</div></div>';
      }
      if (t.why) {
        detailHtml += '<div class="tpl-detail-section"><div class="tpl-detail-title">為什麼有效</div><div class="tpl-detail-code">' + t.why.replace(/</g,'&lt;') + '</div></div>';
      }
      return '<div class="tpl-card" data-tpl-id="' + t.id + '" onclick="this.classList.toggle(\'expanded\')">' +
        '<div class="tpl-card-header"><span class="tpl-card-emoji">' + emoji + '</span><span class="tpl-card-name">' + name + '</span></div>' +
        '<div class="tpl-card-desc">' + (t.desc || '') + '</div>' +
        '<div class="tpl-card-tags">' +
          '<span class="tpl-tag">' + t.id + '</span>' +
        '</div>' +
        '<div class="tpl-card-detail">' + detailHtml +
          '<div class="tpl-card-actions"><button class="tpl-use-btn" onclick="event.stopPropagation(); useTemplate(\'' + t.id + '\', \'' + name.replace(/'/g,'') + '\')">用這個模板寫文案 →</button></div>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch(e) {
    grid.innerHTML = '<p style="color:var(--text-light)">載入失敗：' + e.message + '</p>';
  }
}

window.useTemplate = function(templateId, templateName) {
  // Navigate to copywriter with template pre-selected
  var formatSelect = document.getElementById('formatSelect');
  if (formatSelect) formatSelect.value = templateName;
  var selectedFormat = document.getElementById('selectedFormat');
  var selectedFormatName = document.getElementById('selectedFormatName');
  if (selectedFormatName) selectedFormatName.textContent = templateName;
  if (selectedFormat) selectedFormat.classList.remove('hidden');
  var matrixCta = document.getElementById('matrixCta');
  if (matrixCta) matrixCta.classList.add('hidden');
  switchPage('copywriter');
};

// Template filter
document.querySelectorAll('[data-tpl-filter]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('[data-tpl-filter]').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    var filter = btn.dataset.tplFilter;
    document.querySelectorAll('.tpl-card').forEach(function(card) {
      if (filter === 'all') { card.style.display = ''; return; }
      var text = card.textContent;
      card.style.display = text.includes(filter) ? '' : 'none';
    });
  });
});


// ── Collection Page ──

function renderCollectionPage() {
  var collection = getSavedCollection();
  var list = document.getElementById('collectionList');
  var stats = document.getElementById('collectionStats');
  if (!list) return;

  if (stats) {
    stats.querySelector('.collection-count').textContent = collection.length + ' 篇收藏';
  }

  if (collection.length === 0) {
    list.innerHTML = '<div class="collection-empty"><p>還沒有收藏</p><p>到「🔍 爆文拆解」分析貼文後，點擊「⭐ 收藏」即可加入</p></div>';
    return;
  }

  list.innerHTML = collection.map(function(entry) {
    var date = entry.savedAt ? new Date(entry.savedAt).toLocaleDateString('zh-TW') : '';
    var samplePreview = (entry.samplePost || '').substring(0, 80).replace(/</g, '&lt;');
    return '<div class="coll-card" onclick="this.classList.toggle(\'expanded\')">' +
      '<div class="coll-card-header">' +
        '<span class="coll-card-title">' + (entry.author || '未知來源') + '</span>' +
        '<span class="coll-card-date">' + date + '</span>' +
      '</div>' +
      '<div class="coll-card-meta">' +
        (entry.matchedTemplateName ? '<span class="tpl-tag">' + entry.matchedTemplateName + '</span>' : '') +
        (entry.samplePillar ? '<span class="tpl-tag">' + entry.samplePillar + '</span>' : '') +
        '<span>❤️ ' + (entry.likes || '—') + '</span>' +
      '</div>' +
      '<div class="coll-card-body">' +
        (entry.samplePost ? '<div class="coll-sample">' + entry.samplePost.replace(/</g,'&lt;') + '</div>' : '') +
        '<div class="coll-card-actions">' +
          '<button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); copyCollectionItem(\'' + entry.id + '\')">📋 複製</button>' +
          '<button class="coll-delete-btn" onclick="event.stopPropagation(); removeFromCollection(\'' + entry.id + '\')">🗑️ 刪除</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// Load pages when navigating
window.copyCollectionItem = function(id) {
  var collection = getSavedCollection();
  var entry = collection.find(function(e) { return e.id === id; });
  if (entry && entry.samplePost) {
    navigator.clipboard.writeText(entry.samplePost).catch(function() {});
  }
};

var _origSwitchPage = typeof switchPage === 'function' ? switchPage : null;


// ── Notion Collection Page ──

var _ncData = [];
var _ncSourceFilter = '';
var _ncAccountFilter = '';

async function renderNotionCollectionPage() {
  var list = document.getElementById('ncList');
  var stats = document.getElementById('ncStats');
  if (!list) return;

  list.innerHTML = '<div class="collection-empty"><p>載入中...</p></div>';

  try {
    var res = await apiCall('/api/notion/collection', null, 'GET');
    _ncData = (res && res.items) || [];
  } catch(e) {
    list.innerHTML = '<div class="collection-empty"><p>載入失敗</p></div>';
    return;
  }

  var accounts = {};
  _ncData.forEach(function(item) {
    if (item.author) accounts[item.author] = true;
  });
  var sel = document.getElementById('ncAccountFilter');
  if (sel) {
    sel.innerHTML = '<option value="">全部帳號</option>';
    Object.keys(accounts).sort().forEach(function(a) {
      sel.innerHTML += '<option value="' + a + '">' + a + '</option>';
    });
  }

  _renderNcList();
}

function _renderNcList() {
  var list = document.getElementById('ncList');
  var stats = document.getElementById('ncStats');
  if (!list) return;

  var filtered = _ncData.filter(function(item) {
    if (_ncSourceFilter && item.source !== _ncSourceFilter) return false;
    if (_ncAccountFilter && item.author !== _ncAccountFilter) return false;
    return true;
  });

  if (stats) {
    stats.querySelector('.nc-count').textContent = filtered.length + ' 篇收藏';
  }

  if (filtered.length === 0) {
    list.innerHTML = '<div class="collection-empty"><p>沒有符合條件的收藏</p></div>';
    return;
  }

  list.innerHTML = filtered.map(function(item) {
    var date = item.date || '';
    var sourceClass = 'source-' + (item.source || '');

    var bodyHtml = '';
    var sections = {};
    var currentSection = '';
    (item.body || []).forEach(function(blk) {
      if (blk.type === 'heading_2') {
        currentSection = blk.content;
        sections[currentSection] = [];
      } else if (currentSection) {
        sections[currentSection] = sections[currentSection] || [];
        if (blk.content) sections[currentSection].push(blk.content);
      }
    });

    Object.keys(sections).forEach(function(title) {
      var content = sections[title].join('\n');
      if (!content.trim()) return;
      var icon = '📄';
      if (title.indexOf('格式') >= 0 || title.indexOf('Hook') >= 0) icon = '🎣';
      else if (title.indexOf('範文') >= 0) icon = '📝';
      else if (title.indexOf('原始') >= 0) icon = '📋';
      else if (title.indexOf('查核') >= 0) icon = '🔍';
      else if (title.indexOf('Sub') >= 0) icon = '☑️';
      bodyHtml += '<div class="nc-section">'
        + '<div class="nc-section-title">' + icon + ' ' + title + '</div>'
        + '<div class="nc-section-content">' + content.replace(/</g, '&lt;') + '</div>'
        + '</div>';
    });

    var engLevel = '';
    var likes = parseInt((item.engagement || '').replace(/[^0-9]/g, '')) || 0;
    if (likes >= 500) engLevel = '🔥🔥🔥';
    else if (likes >= 200) engLevel = '🔥🔥';
    else if (likes >= 100) engLevel = '🔥';

    return '<div class="nc-card" onclick="this.classList.toggle(\'expanded\')">'
      + '<div class="nc-card-header">'
      +   '<span class="nc-card-title">' + (item.title || '未知') + '</span>'
      +   '<span class="nc-card-date">' + date + '</span>'
      + '</div>'
      + '<div class="nc-card-meta">'
      +   '<span class="nc-tag ' + sourceClass + '">' + (item.source || '') + '</span>'
      +   (item.templateName ? '<span class="nc-tag">' + item.templateName + '</span>' : '')
      +   (item.pillar ? '<span class="nc-tag">' + item.pillar + '</span>' : '')
      +   '<span>' + (item.engagement || '') + '</span>'
      +   (engLevel ? ' <span>' + engLevel + '</span>' : '')
      + '</div>'
      + '<div class="nc-card-body">'
      +   bodyHtml
      +   '<div class="nc-card-actions">'
      +     '<button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); ncCopyItem(\'' + item.id + '\')">📋 複製</button>'
      +     '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); ncUseForCopy(\'' + item.id + '\')">📝 用這個寫文案</button>'
      +     '<a href="' + (item.url || '#') + '" target="_blank" class="btn btn-sm btn-outline" onclick="event.stopPropagation()">🔗 Notion</a>'
      +   '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}

window.ncCopyItem = function(id) {
  var item = _ncData.find(function(e) { return e.id === id; });
  if (!item) return;
  var sections = {};
  var cur = '';
  (item.body || []).forEach(function(blk) {
    if (blk.type === 'heading_2') { cur = blk.content; sections[cur] = []; }
    else if (cur && blk.content) { sections[cur] = sections[cur] || []; sections[cur].push(blk.content); }
  });
  var sampleKey = Object.keys(sections).find(function(k) { return k.indexOf('範文') >= 0; });
  var text = sampleKey ? sections[sampleKey].join('\n') : JSON.stringify(item, null, 2);
  navigator.clipboard.writeText(text).catch(function() {});
};

window.ncUseForCopy = function(id) {
  var item = _ncData.find(function(e) { return e.id === id; });
  if (!item) return;
  var sections = {};
  var cur = '';
  (item.body || []).forEach(function(blk) {
    if (blk.type === 'heading_2') { cur = blk.content; sections[cur] = []; }
    else if (cur && blk.content) { sections[cur] = sections[cur] || []; sections[cur].push(blk.content); }
  });
  var sampleKey = Object.keys(sections).find(function(k) { return k.indexOf('範文') >= 0; });
  var hookKey = Object.keys(sections).find(function(k) { return k.indexOf('格式') >= 0 || k.indexOf('Hook') >= 0; });
  var hint = '';
  if (hookKey) hint += '【格式參考】\n' + sections[hookKey].join('\n') + '\n\n';
  if (sampleKey) hint += '【範文參考】\n' + sections[sampleKey].join('\n');
  switchPage('copywriter');
  document.getElementById('copywriterInput').value = hint || item.title;
};

document.addEventListener('click', function(e) {
  if (e.target.classList.contains('nc-filter-btn')) {
    var toolbar = e.target.closest('.nc-toolbar');
    if (toolbar) {
      toolbar.querySelectorAll('.nc-filter-btn').forEach(function(b) { b.classList.remove('active'); });
    }
    e.target.classList.add('active');
    _ncSourceFilter = e.target.dataset.source || '';
    _renderNcList();
  }
});

var ncAccSel = document.getElementById('ncAccountFilter');
if (ncAccSel) {
  ncAccSel.addEventListener('change', function() {
    _ncAccountFilter = this.value;
    _renderNcList();
  });
}


// ── Copywriter: Clear format + go to matrix ──

document.getElementById('clearFormat').addEventListener('click', () => {
  document.getElementById('selectedFormat').classList.add('hidden');
  document.getElementById('matrixCta').classList.remove('hidden');
  document.getElementById('formatSelect').value = '';
  document.getElementById('copywriterInput').value = '';
});

document.getElementById('goToMatrix').addEventListener('click', (e) => {
  e.preventDefault();
  switchPage('matrix');
});

document.getElementById('backToMatrix').addEventListener('click', (e) => {
  e.preventDefault();
  switchPage('matrix');
});


// ── Search: Quick keyword buttons ──

document.querySelectorAll('.search-quick').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('searchKeyword').value = btn.dataset.kw;
  });
});


// ── Matrix: Data & Rendering ──

// ── 矩陣：子主題定義 ──
var MATRIX_PILLARS = {
  bazi: { label: '\u516b\u5b57', columns: ['\u516b\u5b57\u6559\u5b78', '\u516b\u5b57\u89c0\u5bdf'] },
  tarot: { label: '\u5854\u7f85', columns: ['\u5854\u7f85\u89ba\u5bdf\u6848\u4f8b', '\u5854\u7f85\u89ba\u5bdf\u6559\u5b78'] },
  awareness: { label: '\u89ba\u5bdf\u4fee\u884c', columns: ['\u6b63\u5ff5\u89ba\u5bdf', '\u4f5b\u6cd5\u667a\u6167', '\u5fc3\u7406\u5b78'] },
  persona: { label: '\u4eba\u8a2d\u6587', columns: ['\u611f\u60c5\u89c0\u5bdf', '\u65e5\u5e38\u5206\u4eab', '\u500b\u4eba\u6210\u9577'] },
};
var currentMatrixPillar = 'bazi';

// ── 矩陣資料（按大分類 × 桶子）──
var MATRIX_DATA = {
  bazi: {
    sunflower: [
      { form: '\u6975\u77ed\u91d1\u53e5', cells: ['\u300c\u516b\u5b57\u5176\u5be6\u53ea\u8981\u641e\u61c2\u9019\u4e09\u4ef6\u4e8b\u300d', '\u300c\u592b\u59bb\u5bae\u4e0d\u597d\u4e0d\u4ee3\u8868\u611f\u60c5\u5dee\u2014\u2014\u90a3\u53ea\u662f\u4f60\u7684\u6163\u6027\u8d77\u9ede\u300d'] },
      { form: '\u63d0\u554f\u4e92\u52d5', cells: ['\u300c\u4f60\u807d\u904e\u6700\u96e2\u8b5c\u7684\u516b\u5b57\u8aaa\u6cd5\uff1f\u6211\u5148\u4f86\u300d', '\u300c\u4f60\u8eab\u908a\u6709\u6c92\u6709\u4e00\u7a2e\u4eba\uff0c\u8aaa\u8a71\u5f88\u72b9\u5229\u4f46\u5176\u5be6\u5f88\u5fc3\u8edf\uff1f\u300d'] },
      { form: '\u6bd4\u55bb\u964d\u7dad', cells: ['\u300c\u516b\u5b57\u5c31\u50cf\u4f7f\u7528\u8aaa\u660e\u66f8\u2014\u2014\u70ba\u4ec0\u9ebc\u4e0d\u770b\u81ea\u5df1\u7684\uff1f\u300d', '\u300c\u5341\u795e\u5c31\u662f\u4f60\u7684\u51fa\u5ee0\u8a2d\u5b9a\uff0c\u770b\u61c2\u4e86\u624d\u77e5\u9053\u54ea\u88e1\u8a72\u8abf\u6574\u300d'] },
      { form: '\u5341\u795e\u00d7\u5834\u666f', cells: ['\u300c\u98df\u795e\u7684\u4eba\u6700\u53d7\u4e0d\u4e86\u53c3\u52a0\u4e0d\u559c\u6b61\u7684\u61c9\u916c\u300d', '\u300c\u6b63\u5b98\u7684\u4eba\u5728\u611f\u60c5\u88e1\u7e3d\u662f\u9019\u6a23\u53cd\u61c9\u300d'] },
      { form: '\u7834\u89e3\u8ff7\u601d', cells: ['\u300c\u516b\u5b57\u5341\u795e\u6c92\u6709\u597d\u58de\uff0c\u4f60\u88ab\u9a19\u4e86\u300d', '\u300c\u592b\u59bb\u5bae\u5750\u6bd4\u52ab\u5c31\u6ce8\u5b9a\u96e2\u5a5a\uff1f\u624d\u4e0d\u662f\u300d'] },
      { form: '\u6b63\u9762\u5c0d\u865f\u5165\u5ea7', cells: ['\u300c\u8d8a\u4f86\u8d8a\u6709\u9322\u7684\u5973\u547d\u2014\u2014\u4f60\u4e2d\u4e86\u5e7e\u500b\u300d', '\u300c\u5929\u751f\u5c31\u6709\u9818\u5c0e\u6c23\u8cea\u7684\u5341\u795e\u7d44\u5408\u300d'] },
      { form: '\u52f8\u544a\u578b', cells: ['\u300c\u52f8\u4f60\u4e0d\u8981\u6e2c\u8a66\u547d\u76e4\u5e36\u5370\u661f\u7684\u4eba\u300d', '\u300c\u4e03\u6bba\u7684\u4eba\u5728\u611f\u60c5\u88e1\u6709\u500b\u5730\u96f7\u4f60\u5343\u842c\u5225\u8e29\u300d'] },
    ],
    succulent: [
      { form: 'N\u6b65\u9a5f\u6559\u5b78', cells: ['\u300c3 \u6b65\u9a5f\u770b\u61c2\u4f60\u7684\u547d\u76e4\u611f\u60c5\u5340\u300d', '\u300c\u5341\u795e\u89c0\u5bdf\u65e5\u8a18\u600e\u9ebc\u5beb\uff1f\u6211\u7684\u65b9\u6cd5\u300d'] },
      { form: '\u5c0d\u6bd4\u62c6\u89e3', cells: ['\u300c\u6b63\u5b98 vs \u4e03\u6bba\u2014\u2014\u5dee\u5728\u54ea\uff1f\u300d', '\u300c\u98df\u795e vs \u50b7\u5b98\u2014\u2014\u540c\u6a23\u611f\u6027\uff0c\u5dee\u5f88\u5927\u300d'] },
      { form: '\u6e05\u55ae\u578b', cells: ['\u300c\u6211\u6700\u5e38\u7528\u7684 5 \u500b\u516b\u5b57\u5feb\u901f\u5224\u65b7\u6cd5\u300d', '\u300c\u5b78\u516b\u5b57\u6700\u5e38\u6703\u641e\u6df7\u7684 5 \u500b\u6982\u5ff5\u300d'] },
      { form: '\u75db\u9ede\u89e3\u65b9', cells: ['\u300c\u611f\u60c5\u4e00\u76f4\u5361\u5728\u540c\u4e00\u95dc\uff1f\u770b\u61c2\u9019\u500b\u5c31\u597d\u4e86\u300d', '\u300c\u547d\u76e4\u88e1\u6700\u8b93\u4eba\u5d29\u6f70\u7684\u7d44\u5408\u2014\u2014\u89e3\u6cd5\u5728\u9019\u300d'] },
      { form: '\u6050\u61fc+\u653b\u7565', cells: ['\u300c\u516b\u5b57\u521d\u5b78\u8005\u6700\u5bb9\u6613\u8e29\u7684\u5751\u300d', '\u300c\u770b\u61c2\u547d\u76e4\u88e1\u7684\u5438\u5f15\u529b\u6cd5\u5247\u300d'] },
    ],
    pine: [
      { form: '\u6df1\u5ea6\u89c0\u9ede', cells: ['\u300c\u6211\u82b1\u4e86 3 \u500b\u6708\u7814\u7a76\u98df\u795e\uff0c\u767c\u73fe...\u300d', '\u300c\u516b\u5b57\u6c92\u6709\u597d\u58de\u2014\u2014\u6211\u5b78\u5230\u73fe\u5728\u7684\u9ad4\u6703\u300d'] },
      { form: '\u771f\u5be6\u5206\u4eab', cells: ['\u300c\u525b\u525b\u770b\u5b8c\u4e00\u500b\u547d\u76e4\uff0c\u6574\u500b\u4eba\u6114\u4f4f\u300d', '\u300c\u5b78\u516b\u5b57\u5f8c\u6211\u7b2c\u4e00\u6b21\u770b\u61c2\u81ea\u5df1\u7684\u6163\u6027\u300d'] },
      { form: '\u66ec\u53ce\u85cf/\u4e92\u52d5', cells: ['\u300c\u5927\u5bb6\u7b2c\u4e00\u6b21\u7b97\u547d\u662f\u5e7e\u6b72\uff1f\u6211\u5148\u8aaa\u300d', '\u300c\u4f60\u89ba\u5f97\u54ea\u500b\u5341\u795e\u6700\u96e3\u61c2\uff1f\u300d'] },
      { form: '\u6210\u679c\u5c55\u793a', cells: ['\u300c\u5b78\u516b\u5b57 3 \u500b\u6708\uff0c\u5e6b\u4e86 20 \u500b\u4eba\u770b\u61c2\u81ea\u5df1\u300d', '\u300c\u6211\u7684\u5341\u795e\u89c0\u5bdf\u7b46\u8a18\u7b2c 30 \u7bc7\u300d'] },
    ],
  },
  tarot: {
    sunflower: [
      { form: '\u6975\u77ed\u91d1\u53e5', cells: ['\u300c\u5979\u62bd\u5230\u9019\u5f35\u724c\u5f8c\u7d42\u65bc\u653e\u4e0b\u4e86\u300d', '\u300c\u5854\u7f85\u4e0d\u662f\u7b97\u547d\uff0c\u662f\u7167\u93e1\u5b50\u300d'] },
      { form: '\u63d0\u554f\u4e92\u52d5', cells: ['\u300c\u4f60\u62bd\u5230\u54ea\u5f35\u724c\u5f8c\u6574\u500b\u4eba\u6114\u4f4f\uff1f\u300d', '\u300c\u5854\u7f85\u91cd\u8907\u554f\u540c\u500b\u554f\u984c\u771f\u7684\u6703\u4e0d\u6e96\u55ce\uff1f\u300d'] },
      { form: '\u7834\u89e3\u8ff7\u601d', cells: ['\u300c\u62bd\u5230\u6b7b\u795e\u724c\u4e0d\u662f\u4f60\u60f3\u7684\u90a3\u6a23\u300d', '\u300c\u9006\u4f4d\u4e0d\u662f\u4e0d\u597d\u2014\u2014\u662f\u53e6\u4e00\u7a2e\u89d2\u5ea6\u300d'] },
    ],
    succulent: [
      { form: 'N\u6b65\u9a5f\u6559\u5b78', cells: ['\u300c\u4e00\u5f35\u724c\u770b\u61c2\u4f60\u73fe\u5728\u7684\u72c0\u614b\u300d', '\u300c\u5854\u7f85\u89ba\u5bdf 3 \u6b65\u9a5f\u5165\u9580\u300d'] },
      { form: '\u6e05\u55ae\u578b', cells: ['\u300c\u611f\u60c5\u5360\u535c\u6700\u5e38\u51fa\u73fe\u7684 5 \u5f35\u724c\u300d', '\u300c\u65b0\u624b\u5fc5\u5b78\u7684 10 \u5f35\u5927\u724c\u542b\u7fa9\u300d'] },
      { form: '\u75db\u9ede\u89e3\u65b9', cells: ['\u300c\u62bd\u5230\u5854\u724c\u5225\u6154\u2014\u2014\u9019\u6a23\u7406\u89e3\u5c31\u5c0d\u4e86\u300d', '\u300c\u70ba\u4ec0\u9ebc\u6bcf\u6b21\u5360\u535c\u90fd\u62bd\u5230\u540c\u4e00\u5f35\uff1f\u300d'] },
    ],
    pine: [
      { form: '\u771f\u5be6\u5206\u4eab', cells: ['\u300c\u4eca\u5929\u5e6b\u4eba\u89e3\u724c\uff0c\u5979\u54ed\u4e86\u300d', '\u300c\u5854\u7f85\u7ffb\u51fa\u6b7b\u795e\u724c\u90a3\u4e00\u523b\u300d'] },
      { form: '\u6df1\u5ea6\u89c0\u9ede', cells: ['\u300c\u5854\u7f85\u6559\u6211\u7684\u4e0d\u662f\u7b54\u6848\uff0c\u662f\u63d0\u554f\u300d', '\u300c\u70ba\u4ec0\u9ebc\u6211\u4e0d\u505a\u5927\u773e\u5360\u535c\u4e86\u300d'] },
    ],
  },
  awareness: {
    sunflower: [
      { form: '\u6975\u77ed\u91d1\u53e5', cells: ['\u300c\u6539\u904b\u6700\u5feb\u7684\u65b9\u6cd5\uff0c\u662f\u6539\u6389\u4f60\u7684\u81ea\u52d5\u53cd\u61c9\u300d', '\u300c\u653e\u4e0b\u4e0d\u662f\u5fd8\u8a18\uff0c\u662f\u770b\u898b\u4e86\u9084\u662f\u9078\u64c7\u5f80\u524d\u8d70\u300d', '\u300c\u60c5\u7dd2\u4e0d\u662f\u4f60\u7684\u6575\u4eba\uff0c\u662f\u4f60\u7684\u4fe1\u5dee\u300d'] },
      { form: '\u63d0\u554f\u4e92\u52d5', cells: ['\u300c\u4f60\u6709\u6c92\u6709\u767c\u73fe\u2014\u2014\u6bcf\u6b21\u751f\u6c23\u7684\u6a21\u5f0f\u90fd\u4e00\u6a23\uff1f\u300d', '\u300c\u4f60\u76f8\u4fe1\u300c\u56e0\u679c\u300d\u9084\u662f\u300c\u547d\u904b\u300d\uff1f\u300d', '\u300c\u5b78\u4e86\u89ba\u5bdf\u5f8c\u6700\u9707\u649e\u7684\u767c\u73fe\uff1f\u300d'] },
      { form: '\u7834\u89e3\u8ff7\u601d', cells: ['\u300c\u6539\u904b\u4e0d\u662f\u71d2\u9999\u62dc\u62dc\u2014\u2014\u662f\u6539\u6389\u91cd\u8907\u7684\u9078\u64c7\u300d', '\u300c\u4fee\u884c\u4e0d\u662f\u8b93\u4f60\u8b8a\u5b8c\u7f8e\uff0c\u662f\u8b93\u4f60\u770b\u898b\u4e0d\u5b8c\u7f8e\u300d', '\u300c\u5fc3\u7406\u5b78\u4e0d\u662f\u6559\u4f60\u63a7\u5236\u60c5\u7dd2\uff0c\u662f\u7406\u89e3\u5b83\u300d'] },
    ],
    succulent: [
      { form: 'N\u6b65\u9a5f\u6559\u5b78', cells: ['\u300c\u6b63\u5ff5\u89ba\u5bdf\u5165\u9580 3 \u6b65\u9a5f\u300d', '\u300c\u4f5b\u6cd5\u667a\u6167\u5982\u4f55\u61c9\u7528\u5728\u65e5\u5e38\u300d', '\u300c\u4f9d\u9644\u95dc\u4fc2\u81ea\u6211\u6aa2\u6e2c 5 \u500b\u8de1\u8c61\u300d'] },
      { form: '\u5c0d\u6bd4\u62c6\u89e3', cells: ['\u300c\u51a5\u60f3 vs \u89ba\u5bdf\u2014\u2014\u4e0d\u4e00\u6a23\u7684\u300d', '\u300c\u653e\u4e0b vs \u58d3\u6291\u2014\u2014\u5dee\u5f88\u5927\u300d', '\u300c\u9ad8\u654f\u611f vs \u7384\u5b78\u2014\u2014\u5225\u6df7\u70ba\u4e00\u8ac7\u300d'] },
      { form: '\u6e05\u55ae\u578b', cells: ['\u300c6 \u500b\u89ba\u5bdf\u5c0f\u7df4\u7fd2\u300d', '\u300c\u4f5b\u6cd5\u6559\u6211\u7684 3 \u500b\u65e5\u5e38\u667a\u6167\u300d', '\u300c\u8a8d\u77e5\u504f\u8aa4\u81ea\u6211\u6aa2\u6e2c\u6e05\u55ae\u300d'] },
    ],
    pine: [
      { form: '\u771f\u5be6\u5206\u4eab', cells: ['\u300c\u5b78\u89ba\u5bdf\u4e09\u500b\u6708\uff0c\u6211\u7b2c\u4e00\u6b21\u5c0d\u81ea\u5df1\u8aa0\u5be6\u300d', '\u300c\u4fee\u884c\u8b93\u6211\u5931\u53bb\u4e86\u4e00\u6bb5\u53cb\u60c5\u300d', '\u300c\u7406\u89e3\u4f9d\u9644\u95dc\u4fc2\u5f8c\uff0c\u6211\u653e\u904e\u4e86\u81ea\u5df1\u300d'] },
      { form: '\u6df1\u5ea6\u89c0\u9ede', cells: ['\u300c\u6539\u904b\u7684\u672c\u8cea\u662f\u4ec0\u9ebc\uff1f\u6211\u7684\u89c0\u5bdf\u300d', '\u300c\u70ba\u4ec0\u9ebc\u4f5b\u6cd5\u8aaa\u300c\u7121\u5e38\u300d\u53cd\u800c\u8b93\u4eba\u5b89\u5fc3\u300d', '\u300c\u60c5\u7dd2\u52d2\u7d22\u662f\u4ec0\u9ebc\uff1f\u5f9e\u5fc3\u7406\u5b78\u89d2\u5ea6\u770b\u300d'] },
    ],
  },
  persona: {
    sunflower: [
      { form: '\u6975\u77ed\u91d1\u53e5', cells: ['\u300c\u660e\u660e\u5f88\u96e3\u904e\uff0c\u537b\u9084\u5728\u66ff\u5c0d\u65b9\u7684\u51b7\u6de1\u627e\u7406\u7531\u300d', '\u300c\u4eca\u5929\u5168\u5bb6\u512a\u60e0\uff0c\u6211\u8cb7\u4e86\u4e09\u676f\u300d', '\u300c\u8d8a\u61c2\u4e8b\u7684\u4eba\u8d8a\u59d4\u5c48\uff1f\u5176\u5be6\u662f\u4f60\u6c92\u770b\u898b\u81ea\u5df1\u7684\u9700\u8981\u300d'] },
      { form: '\u63d0\u554f\u4e92\u52d5', cells: ['\u300c\u4f60\u901a\u5e38\u6703\u56e0\u70ba\u4ec0\u9ebc\u800c\u8d70\u5fc3\u5462\uff1f\u300d', '\u300c\u4eca\u5929\u505a\u4e86\u4ec0\u9ebc\u8b93\u4f60\u89ba\u5f97\u5f88\u5e78\u798f\uff1f\u300d', '\u300c\u4f60\u89ba\u5f97\u300c\u6210\u9577\u300d\u6700\u75db\u7684\u90e8\u5206\u662f\u4ec0\u9ebc\uff1f\u300d'] },
      { form: '\u60c5\u5883\u5e36\u5165', cells: ['\u300c\u6628\u5929\u9084\u4e00\u8d77\u5403\u98ef\u770b\u5287\uff0c\u4eca\u5929\u4ed6\u537b\u7a81\u7136\u8aaa\u4e0d\u9069\u5408\u300d', '\u300c\u9019\u662f\u6211\u4eca\u5929\u7684\u65e9\u9910\uff0c\u4e00\u500b\u4eba\u5403\u4e5f\u5f88\u597d\u300d', '\u300c\u53c8\u5931\u7720\u4e86\uff0c\u4f46\u9019\u6b21\u6211\u6c92\u6709\u8cac\u602a\u81ea\u5df1\u300d'] },
    ],
    succulent: [
      { form: '\u75db\u9ede\u89e3\u65b9', cells: ['\u300c\u5047\u6027\u548c\u89e3\u662f\u4ec0\u9ebc\uff1f\u70ba\u4ec0\u9ebc\u4f60\u7e3d\u662f\u5148\u59a5\u5354\u300d', '\u300c\u4e00\u500b\u4eba\u7684\u6642\u5019\u600e\u9ebc\u4e0d\u5b64\u55ae\uff1f\u300d', '\u300c\u60f3\u6539\u8b8a\u4f46\u4e0d\u77e5\u9053\u5f9e\u54ea\u958b\u59cb\uff1f\u5148\u505a\u9019\u4ef6\u4e8b\u300d'] },
      { form: '\u6e05\u55ae\u578b', cells: ['\u300c\u611f\u60c5\u4e2d\u4e0d\u5065\u5eb7\u7684 5 \u500b\u8de1\u8c61\u300d', '\u300c\u8b93\u751f\u6d3b\u6709\u8cea\u611f\u7684 3 \u500b\u5c0f\u7fd2\u6163\u300d', '\u300c\u500b\u4eba\u6210\u9577\u6700\u91cd\u8981\u7684 3 \u500b\u8f49\u6298\u9ede\u300d'] },
    ],
    pine: [
      { form: '\u771f\u5be6\u5206\u4eab', cells: ['\u300c\u6211\u81ea\u5df1\u5176\u5be6\u6709\u4e00\u9ede\u9ad8\u654f\u611f\u300d', '\u300c\u4eca\u5929\u8ddf\u670b\u53cb\u804a\u5929\u7684\u4e00\u500b\u9818\u609f\u300d', '\u300c\u904e\u53bb\u7684\u6211\u6703\u8aaa\u300c\u6c92\u95dc\u4fc2\u300d\uff0c\u73fe\u5728\u6211\u6703\u8aaa\u300c\u6211\u9700\u8981\u300d\u300d'] },
      { form: '\u6545\u4e8b\u7ffb\u8f49', cells: ['\u300c\u89ba\u5bdf\u8b93\u6211\u5931\u53bb\u4e86\u4e00\u6bb5\u53cb\u60c5\u300d', '\u300c\u6628\u5929\u7684\u4e00\u4ef6\u5c0f\u4e8b\u8b93\u6211\u60f3\u901a\u4e86\u300d', '\u300c\u5f9e\u524d\u6211\u89ba\u5f97\u8edf\u5f31\u662f\u4e0d\u597d\u7684\uff0c\u73fe\u5728\u6211\u77e5\u9053\u90a3\u662f\u529b\u91cf\u300d'] },
    ],
  },
};

// ── 矩陣 Tab 切換 ──
var currentBucket = 'sunflower';

// 大分類 tab
document.querySelectorAll('.matrix-pillar-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.matrix-pillar-tab').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    currentMatrixPillar = tab.dataset.pillar;
    // 顯示/隱藏看劇專區
    var dramaEl = document.getElementById('dramaBaziSection');
    if (dramaEl) dramaEl.style.display = currentMatrixPillar === 'bazi' ? '' : 'none';
    renderMatrix();
  });
});

// 桶子 tab
document.querySelectorAll('.bucket-tab[data-bucket]').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.bucket-tab[data-bucket]').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    currentBucket = tab.dataset.bucket;
    renderMatrix();
  });
});

renderMatrix();


// 🤖 AI 發想：讓 AI 根據矩陣生成新的主題靈感
document.getElementById('aiMatrixBtn')?.addEventListener('click', async function() {
  var btn = this;
  btn.disabled = true;
  btn.innerHTML = '\u23f3 AI \u767c\u60f3\u4e2d...';
  var resultsEl = document.getElementById('matrixAiResults');
  resultsEl.classList.remove('hidden');
  resultsEl.innerHTML = '<div class="info-box"><p>\u23f3 AI \u6b63\u5728\u641c\u5c0b\u8da8\u52e2\u4e26\u767c\u60f3\u65b0\u4e3b\u984c...</p></div>';

  try {
    var pillarDef = MATRIX_PILLARS[currentMatrixPillar];
    var topicText = '\u8acb\u6839\u64da\u6700\u65b0 Threads \u8da8\u52e2\uff0c\u70ba\u300c' + pillarDef.label + '\u300d\u7684\u5b50\u4e3b\u984c\uff08' + pillarDef.columns.join('\u3001') + '\uff09\u5404\u63d0\u4f9b 2 \u500b\u65b0\u9bae\u4e3b\u984c\u9748\u611f\u3002\u7d50\u5408\u53d7\u773e\u75db\u9ede\uff1a\u60c5\u611f\u5167\u8017\u578b\u3001\u7126\u616e\u5c0b\u89c5\u578b\u3001\u89ba\u9192\u7834\u5c40\u578b\u3001\u5206\u624b\u7642\u7652\u578b\u3001\u516b\u5b57\u597d\u5947\u8005';
    var result = await apiCall('/api/generate-hooks', {
      pillar: pillarDef.label,
      topic: topicText,
    });
    if (result && result.hooks && result.hooks.length) {
      var html = '<div class="flow-step-card"><div class="flow-step-header"><span class="status-pass"><span class="status-dot"></span> AI \u767c\u60f3\u7d50\u679c</span></div>';
      result.hooks.forEach(function(h) {
        html += '<div class="hook-option" style="cursor:pointer;" onclick="switchPage(\'copywriter\');document.getElementById(\'copywriterInput\').value=\'' + (h.text || '').replace(/'/g, "\\'").replace(/\n/g, '\\n') + '\';">'
          + '<div class="hook-formula">' + (h.formula || '') + '</div>'
          + '<div class="hook-text">' + (h.text || '').replace(/\n/g, '<br>') + '</div>'
          + '</div>';
      });
      html += '</div>';
      resultsEl.innerHTML = html;
    } else {
      resultsEl.innerHTML = '<div class="info-box"><p>\u26a0\ufe0f AI \u767c\u60f3\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u91cd\u8a66</p></div>';
    }
  } catch(e) {
    console.error('AI matrix error:', e);
    resultsEl.innerHTML = '<div class="info-box"><p>\u26a0\ufe0f AI \u767c\u60f3\u932f\u8aa4\uff1a' + (e.message || '\u8acb\u7a0d\u5f8c\u91cd\u8a66') + '</p></div>';
  }
  btn.disabled = false;
  btn.innerHTML = '\ud83e\udd16 AI \u767c\u60f3';
});


// ── 看劇說八字專區 ──
document.getElementById('refreshDramaBtn')?.addEventListener('click', async function() {
  var btn = this;
  btn.disabled = true;
  btn.innerHTML = '\u23f3 \u641c\u5c0b\u4e2d...';
  var list = document.getElementById('dramaList');
  list.innerHTML = '<div class="info-box"><p>\u23f3 AI \u6b63\u5728\u641c\u5c0b\u6700\u65b0\u71b1\u9580\u5287\u96c6...</p></div>';

  try {
    var result = await apiCall('/api/drama-bazi', {});
    if (result && result.dramas && result.dramas.length) {
      list.innerHTML = result.dramas.map(function(d) {
        var angles = (d.angles || []).map(function(a) { return '<span class="drama-angle">' + a + '</span>'; }).join('');
        return '<div class="drama-card">'
          + '<div class="drama-card-header">'
          + '<span class="drama-title">' + (d.title || '') + '</span>'
          + '<span class="drama-heat">' + (d.heat || '') + '</span>'
          + '</div>'
          + (angles ? '<div class="drama-angles">' + angles + '</div>' : '')
          + (d.ref ? '<div class="drama-ref">' + d.ref + '</div>' : '')
          + '<div class="trending-actions">'
          + '<button class="btn btn-outline btn-sm" onclick="useAsTemplate(\'' + (d.title + ' ' + (d.angles || [])[0] || '').replace(/'/g, "\\'") + '\')">\u2192 \u751f\u6210\u6587\u6848</button>'
          + '</div></div>';
      }).join('');
    } else {
      list.innerHTML = '<div class="info-box"><p>\u641c\u5c0b\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u91cd\u8a66</p></div>';
    }
  } catch(e) {
    list.innerHTML = '<div class="info-box"><p>\u26a0\ufe0f ' + e.message + '</p></div>';
  }
  btn.disabled = false;
  btn.innerHTML = '\ud83d\udd04 \u641c\u5c0b\u71b1\u9580\u5287';
});

// ── Schedule: Week Grid ──

const DAYS = ['日', '一', '二', '三', '四', '五', '六'];
const SCHEDULE_HINTS = {
  1: { bucket: '🌻⭐', label: '八字 20-22', cls: 'day-bucket-sun' },
  2: { bucket: '🌲', label: '人設/覺察/深度', cls: 'day-bucket-pine' },
  3: { bucket: '🌵⭐', label: '八字 20-22', cls: 'day-bucket-cac' },
  4: { bucket: '🌻⭐', label: '八字 20-22', cls: 'day-bucket-sun' },
  5: { bucket: '🌲', label: '人設/覺察/深度', cls: 'day-bucket-pine' },
  6: { bucket: '📱', label: 'IG 輪播', cls: '' },
  0: { bucket: '📊', label: '休息/限動', cls: '' },
};

let weekOffset = 0;
let scheduleData = []; // 從 Notion 載入的排程

async function loadSchedule() {
  try {
    var result = await apiCall('/api/schedule');
    if (result && result.items) scheduleData = result.items;
  } catch (e) { console.log('Schedule API failed'); }
  renderWeek();
}

function _dateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function renderWeek() {
  const grid = document.getElementById('weekGrid');
  const label = document.getElementById('weekLabel');
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);

  const endSun = new Date(monday);
  endSun.setDate(monday.getDate() + 6);
  label.textContent = (monday.getMonth()+1) + '/' + monday.getDate() + ' \u2014 ' + (endSun.getMonth()+1) + '/' + endSun.getDate();

  grid.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const isToday = d.toDateString() === now.toDateString();
    const dow = d.getDay();
    const hint = SCHEDULE_HINTS[dow] || {};
    const dateKey = _dateStr(d);

    // 找該日排程
    var dayPosts = scheduleData.filter(function(s) { return s.date === dateKey; });

    var contentHtml = '';
    if (dayPosts.length) {
      contentHtml = dayPosts.map(function(p) {
        return '<div class="day-scheduled">'
          + '<span class="day-scheduled-time">' + (p.time || '') + '</span>'
          + '<span class="day-scheduled-title">' + (p.title || '').substring(0, 20) + '</span>'
          + '</div>';
      }).join('');
    } else {
      contentHtml = '<div class="day-empty">\u5c1a\u672a\u6392\u6587</div>';
    }

    grid.innerHTML += '<div class="day-card' + (isToday ? ' today' : '') + '" data-date="' + dateKey + '">'
      + '<div class="day-card-header">'
      + '<span class="day-name">\u9031' + DAYS[dow] + '</span>'
      + '<span class="day-date">' + d.getDate() + '</span>'
      + '</div>'
      + (hint.label ? '<span class="day-bucket ' + (hint.cls || '') + '">' + hint.bucket + ' ' + hint.label + '</span>' : '')
      + '<div class="day-content">' + contentHtml + '</div>'
      + '</div>';
  }
}

// ── Trending Wall ──

const TRENDING_DATA = [
  { likes: 37000, comments: 2, reposts: 0, level: '🔥🔥🔥',
    text: '你知道嗎？一個人被誇久了，真的會變好看、變順、變有底氣。心理學叫「皮格馬利翁效應」：你怎麼期待一個人，他就會慢慢長成那個樣子。',
    domain: '心理學', form: '極短金句型', cat: 'cross',
    hook: '重點提前 — 用心理學術語製造好奇，一句話就讓人想分享',
    why: '極短（3行以內）+ 反直覺認知 + 正面能量 = 分享慾爆棚',
    apply: '「你知道嗎？命盤裡的食神，被鼓勵久了真的會發光。心理學叫⋯」' },
  { likes: 16000, comments: 2, reposts: 0, level: '🔥🔥🔥',
    text: '一句話形容「最高級、最健康的戀愛狀態」：我先來——「有你真好，但沒你也不是不行。」換你們',
    domain: '感情', form: '提問互動型', cat: 'cross',
    hook: '問句破題 — 先示範答案降低留言門檻，「換你們」引爆互動',
    why: '提問+先給答案+簡單回覆門檻 = 留言率爆炸',
    apply: '「一句話形容你的八字命盤：我先來——『看懂了不代表接受了』」' },
  { likes: 4900, comments: 36, reposts: 134, level: '🔥🔥',
    text: '滿月落在巨蟹座的日子，請準備好利用這股強大的能量，釋放任何阻礙你實現 2025 願望的包袱。',
    domain: '星座', form: '時事蹭流', cat: 'cross',
    hook: '時事蹭流 — 蹭「滿月×星座」天文熱點，結合能量概念',
    why: '時效性話題 + 行動呼籲（準備好釋放）+ 正面期許',
    apply: '「[節氣/滿月] 的能量最適合重新審視你的命盤——今天很適合問自己一個問題」' },
  { likes: 4600, comments: 29, reposts: 460, level: '🔥🔥',
    text: '盤點那些活人感行為——前輩一位時做怪表情以示尊重、前輩飆高音時做怪表情以示尊重、把ADHD當玩笑展現幽默感⋯',
    domain: '生活', form: '盤點型', cat: 'cross',
    hook: '盤點型 — 「盤點那些___」清單格式引發共鳴，轉發率高（460轉發）',
    why: '清單型好收藏 + 生活共鳴 + 幽默感 = 高轉發',
    apply: '「盤點那些八字裡帶傷官的人會做的事——開會時內心已經翻了 87 次白眼⋯」' },
  { likes: 4000, comments: 53, reposts: 122, level: '🔥🔥',
    text: '有人知道哪裡改運很厲害不是騙錢的嗎？希望是推薦的廟可以去走走。近一兩週連續發生不好的事情⋯',
    domain: '命理', form: '提問互動型', cat: 'my',
    hook: '真實提問 — 用真實困擾引發共鳴，不是創作者身份而是「普通人」視角',
    why: '真實痛點 + 求助感 + 留言推薦 = 高回覆（53留言）',
    apply: '「最近有人問我：八字真的能看出什麼時候轉運嗎？老實說⋯」' },
  { likes: 3000, comments: 31, reposts: 316, level: '🔥🔥',
    text: '每天正式開始工作前，我推薦可以用這 6 個步驟規劃一天的工作：1. 拿出一張白紙 2. 畫一個倒T⋯',
    domain: '生產力', form: 'N步驟教學', cat: 'cross',
    hook: '數字成效 — 「6 個步驟」承諾具體知識量，讓人想收藏',
    why: '清楚的步驟 + 簡單可執行 + 收藏價值 = 高轉發（316轉發）',
    apply: '「3 步驟看懂你的命盤感情區：1. 找到日柱 2. 看夫妻宮⋯」' },
  { likes: 1600, comments: 122, reposts: 53, level: '🔥🔥',
    text: '東區有一間老式算命館，命理界老油男。算命收費一次六千，算的超江湖術士，一點內容都沒有，扯不過就找神明⋯',
    domain: '命理', form: '故事翻轉型', cat: 'my',
    hook: '現場故事 — 真實經歷爆料，有現場感和爭議性',
    why: '真實故事 + 爆料感 + 爭議性 = 超高留言（122留言）',
    apply: '「上週有人拿著別家的命盤分析來找我，我看完之後整個人沉默了⋯」' },
  { likes: 486, comments: 0, reposts: 0, level: '🔥',
    text: '食神的人最受不了參加不喜歡的應酬',
    domain: '八字', form: '十神×場景', cat: 'my',
    hook: '點名受眾 — 用十神點名特定人群，讓人對號入座',
    why: '精準打中特定族群 + 「被說中」的快感 = 自然分享',
    apply: '「偏印的人最受不了被問『你到底在想什麼？』」' },
  { likes: 270, comments: 19, reposts: 16, level: '🔥',
    text: '八字中有偏印的你，來看看自己有沒有以下這幾點：1.獨處時通常最有能量 2.對人事敏感度比一般人高⋯',
    domain: '八字', form: '正面對號入座', cat: 'my',
    hook: '點名受眾+清單 — 正面標籤讓人想對照，清單格式好收藏',
    why: '正面標籤 + 自我驗證慾望 + 「中了幾個」互動感',
    apply: '「夫妻宮坐比劫的你，來看看有沒有這幾點⋯」' },
];

// ── Trending: 爆款牆 ──
// Gist-based: 每個分類獨立 JSON，前端直接 fetch Gist
var GIST_BASE = 'https://gist.githubusercontent.com/JHEN0907/1d5953637739f53475702dbc24551d79/raw';
var trendingCache = { all: null, bazi: null, tarot: null, mindful: null, persona: null, other: null };
var currentPlatformFilter = 'all';

function currentTrendingFilter() {
  var active = document.querySelector('.trending-tab.active');
  return active ? active.dataset.tfilter : 'all';
}

function _trendingScore(t) {
  return (t.likes || 0) + (t.comments || 0) * 3 + (t.reposts || 0) * 5;
}

async function _fetchGist(category) {
  var url = GIST_BASE + '/trending_' + category + '.json?t=' + Date.now();
  try {
    var resp = await fetch(url);
    if (!resp.ok) return null;
    var data = await resp.json();
    return data;
  } catch(e) {
    return null;
  }
}

async function _fetchFromApi(category) {
  var endpoint = category === 'all' ? '/api/trending' :
                 '/api/' + category + '-trending';
  try {
    var result = await apiCall(endpoint);
    return result;
  } catch(e) {
    return null;
  }
}

function _filterBadPosts(items) {
  // 過濾被 AI 標記為不適合的貼文
  var badKeywords = ['\u6c42\u6559\u6587', '\u4e0d\u9069\u5408\u53c3\u8003', '\u65b7\u8a00\u5f0f', '\u5b97\u6559\u795e\u79d8', '\u4e0d\u7b26\u5408\u54c1\u724c'];
  return items.filter(function(t) {
    var hook = (t.hook || '').toLowerCase();
    return !badKeywords.some(function(kw) { return hook.indexOf(kw) >= 0; });
  });
}

async function loadTrendingForCategory(cat) {
  // 1. 先試 Gist（雲端最新）
  var data = await _fetchGist(cat);
  if (data && data.items && data.items.length) {
    var filtered = _filterBadPosts(data.items);
    filtered.forEach(function(t) { t._score = _trendingScore(t); });
    filtered.sort(function(a, b) { return (b._score || 0) - (a._score || 0); });
    trendingCache[cat] = filtered;
    return;
  }
  // 2. 再試 API（本機 api_server）
  data = await _fetchFromApi(cat);
  if (data && data.items && data.items.length) {
    var filtered2 = _filterBadPosts(data.items);
    filtered2.forEach(function(t) { t._score = _trendingScore(t); });
    filtered2.sort(function(a, b) { return (b._score || 0) - (a._score || 0); });
    trendingCache[cat] = filtered2;
    return;
  }
}

async function loadAllTrending(forceRefresh) {
  var cat = currentTrendingFilter();
  if (cat === 'all') {
    // 全部 = 合併三個分類
    await Promise.all([
      loadTrendingForCategory('bazi'),
      loadTrendingForCategory('tarot'),
      loadTrendingForCategory('mindful'),
      loadTrendingForCategory('persona'),
      loadTrendingForCategory('other'),
    ]);
    var merged = [];
    var seen = {};
    ['bazi', 'tarot', 'mindful', 'persona', 'other'].forEach(function(c) {
      (trendingCache[c] || []).forEach(function(t) {
        var key = (t.text || '').substring(0, 50);
        if (!seen[key]) { seen[key] = true; merged.push(t); }
      });
    });
    merged.sort(function(a, b) { return (b._score || 0) - (a._score || 0); });
    trendingCache.all = merged;
  } else {
    await loadTrendingForCategory(cat);
  }
  renderTrending();
}

function renderTrending() {
  var list = document.getElementById('trendingList');
  var catFilter = currentTrendingFilter();
  var data = trendingCache[catFilter] || [];

  // 平台篩選
  var filtered = data;
  if (currentPlatformFilter !== 'all') {
    filtered = data.filter(function(t) {
      var p = (t.platform || '').toLowerCase();
      if (currentPlatformFilter === 'threads') return p === 'threads';
      if (currentPlatformFilter === 'xiaohongshu') return p === 'xiaohongshu' || p.indexOf('\u5c0f\u7d05\u66f8') >= 0;
      if (currentPlatformFilter === 'ig') return p === 'ig' || p === 'instagram';
      return true;
    });
  }

  if (!filtered.length) {
    var msg = trendingCache[catFilter] === null ? '\u8f09\u5165\u4e2d...' : '\u9019\u500b\u5206\u985e\u66ab\u7121\u8cc7\u6599\uff0c\u8acb\u9ede\u300c\ud83d\udd04 \u66f4\u65b0\u7206\u6587\u300d';
    list.innerHTML = '<div class="info-box"><p>' + msg + '</p></div>';
    return;
  }

  var mega = filtered.filter(function(t) { return t._score >= 5000; });
  var hot = filtered.filter(function(t) { return t._score >= 1000 && t._score < 5000; });
  var warm = filtered.filter(function(t) { return t._score >= 100 && t._score < 1000; });
  var rest = filtered.filter(function(t) { return t._score < 100; });

  var html = '';
  if (mega.length) { html += '<div class="trending-level-header">\ud83d\udd25\ud83d\udd25\ud83d\udd25 \u8d85\u7d1a\u7206\u6587</div>'; html += mega.map(renderCard).join(''); }
  if (hot.length) { html += '<div class="trending-level-header">\ud83d\udd25\ud83d\udd25 \u71b1\u9580\u7206\u6587</div>'; html += hot.map(renderCard).join(''); }
  if (warm.length) { html += '<div class="trending-level-header">\ud83d\udd25 \u6f5b\u529b\u8cbc\u6587</div>'; html += warm.map(renderCard).join(''); }
  if (rest.length) { html += '<div class="trending-level-header">\u53c3\u8003\u8cbc\u6587</div>'; html += rest.map(renderCard).join(''); }
  list.innerHTML = html;
}

function renderCard(t) {
  var text = (t.text || '').replace(/</g, '&lt;').substring(0, 250);
  var author = t.author ? '@' + t.author : '';
  var hook = t.hook || '';
  var why = t.why || '';
  var apply = t.apply || t.angle || '';
  var knowledge = t.knowledge || '';
  var note = t.note || '';
  var url = t.url || '';
  var platformLabel = {'threads':'Threads','xiaohongshu':'\u5c0f\u7d05\u66f8','ig':'IG','instagram':'IG'}[t.platform] || t.platform || '';

  return '<div class="trending-card">'
    + '<div class="trending-header">'
    + (t.level ? '<span class="trending-level">' + t.level + '</span>' : '')
    + (platformLabel ? '<span class="trending-platform">' + platformLabel + '</span>' : '')
    + (author ? '<span class="trending-author">' + author + '</span>' : '')
    + (t.date ? '<span class="trending-date">' + t.date + '</span>' : '')
    + '<span class="trending-stats">\u2764\ufe0f ' + (t.likes || 0).toLocaleString() + ' \u00b7 \ud83d\udcac ' + (t.comments || 0) + ' \u00b7 \ud83d\udd04 ' + (t.reposts || 0) + '</span>'
    + (url ? '<a href="' + url + '" target="_blank" rel="noopener" class="trending-link" title="\u67e5\u770b\u539f\u6587">\ud83d\udd17</a>' : '')
    + '</div>'
    // 分析區
    + (hook ? '<div class="trending-insight"><span class="trending-insight-label">Hook \u62c6\u89e3</span>' + hook + '</div>' : '')
    + (why ? '<div class="trending-insight"><span class="trending-insight-label">\u7206\u6587\u539f\u56e0</span>' + why + '</div>' : '')
    // 內容
    + '<p class="trending-text">' + text + '</p>'
    // 知識驗證
    + (knowledge ? '<div class="bazi-knowledge"><span class="bazi-knowledge-label">\ud83d\udcda \u547d\u7406\u77e5\u8b58</span> ' + knowledge + '</div>' : '')
    + (note ? '<div class="bazi-note">\u26a0\ufe0f ' + note + '</div>' : '')
    // 套用建議
    + (apply ? '<div class="trending-insight trending-insight-apply"><span class="trending-insight-label">\ud83c\udfaf \u5957\u7528\u5efa\u8b70</span>' + apply + '</div>' : '')
    // 按鈕
    + '<div class="trending-actions">'
    + '<button class="btn btn-outline btn-sm" onclick="useAsTemplate(\'' + (apply || text).replace(/'/g, "\\'").replace(/\n/g, ' ').substring(0, 80) + '\')">\u2192 \u5957\u7528\u9019\u500b\u5f62\u5f0f</button>'
    + (hook ? '<button class="btn btn-outline btn-sm" onclick="useAsTemplate(\'' + hook.replace(/'/g, "\\'").substring(0, 60) + '\')">\u2192 \u5957\u7528 Hook</button>' : '')
    + '<button class="btn btn-outline btn-sm trending-save-btn" onclick="saveTrendingCard(this)" data-card=\'' + JSON.stringify({author:t.author||'',text:(t.text||'').substring(0,200),hook:hook,why:why,apply:apply,url:url,platform:t.platform||'',likes:t.likes||0,date:t.date||''}).replace(/'/g,'&#39;') + '\'>\u2b50 \u6536\u85cf</button>'
    + '</div></div>';
}

function useAsTemplate(text) {
  switchPage('copywriter');
  document.getElementById('copywriterInput').value = text;
}

function saveTrendingCard(btn) {
  try {
    var card = JSON.parse(btn.dataset.card);
    var saved = JSON.parse(localStorage.getItem('savedTrending') || '[]');
    var exists = saved.some(function(s) { return s.url === card.url && s.text === card.text; });
    if (exists) {
      btn.innerHTML = '\u2705 \u5df2\u6536\u85cf';
      return;
    }
    card.savedAt = new Date().toISOString();
    card.source = '\u7206\u6b3e\u7246';
    saved.unshift(card);
    if (saved.length > 50) saved = saved.slice(0, 50);
    localStorage.setItem('savedTrending', JSON.stringify(saved));
    btn.innerHTML = '\u2b50 \u5132\u5b58\u4e2d...';
    btn.classList.add('saved');

    var analysis = {
      author: card.author || '\u672a\u77e5\u4f86\u6e90',
      originalText: card.text || '',
      hookType: (card.hook || '').split('\uff1a')[0] || '',
      hookFormula: card.hook || '',
      whyViral: card.why || '',
      samplePost: card.apply || '',
      samplePillar: '\u516b\u5b57',
      sourceUrl: card.url || '',
      likes: String(card.likes || 0),
      comments: '0', reposts: '0', shares: '0',
      matchedTemplateName: '\u7206\u6b3e\u7246\u6536\u85cf',
      source: '\u7206\u6b3e\u7246',
    };
    apiCall('/api/notion/save-analysis', { analysis: analysis }).then(function(res) {
      btn.innerHTML = '\u2705 \u5df2\u540c\u6b65 Notion';
    }).catch(function() {
      btn.innerHTML = '\u2705 \u5df2\u6536\u85cf\uff08\u672a\u540c\u6b65\uff09';
    });
  } catch(e) {
    btn.innerHTML = '\u274c \u5931\u6557';
  }
}

// 領域 Tab 切換（有快取直接顯示，無快取 fetch Gist）
document.querySelectorAll('.trending-tab').forEach(function(tab) {
  tab.addEventListener('click', async function() {
    document.querySelectorAll('.trending-tab').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    var cat = tab.dataset.tfilter;
    if (trendingCache[cat] && trendingCache[cat].length) {
      renderTrending();
    } else {
      document.getElementById('trendingList').innerHTML = '<div class="info-box"><p>\u8f09\u5165\u4e2d...</p></div>';
      await loadAllTrending(false);
    }
  });
});

// 平台子篩選（純前端篩選，不重新搜尋）
document.querySelectorAll('.platform-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.platform-tab').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    currentPlatformFilter = tab.dataset.platform;
    renderTrending();
  });
});

// 更新爆文（觸發伺服器爬文+分析+上傳 Gist，然後重新 fetch）
document.getElementById('refreshTrendingBtn')?.addEventListener('click', async function() {
  var btn = this;
  btn.disabled = true;
  btn.innerHTML = '\u23f3 \u5df2\u89f8\u767c Discord \u722c\u6587... \u7d04\u9700 5-10 \u5206\u9418';

  try {
    var res = await apiCall('/api/trending/refresh', { method: 'POST', body: JSON.stringify({}) });
    if (res && res.discord_triggered) {
      btn.innerHTML = '\u2705 Discord \u5df2\u63a5\u6536\uff0c\u7b49\u5f85\u722c\u6587\u5b8c\u6210...';
    } else {
      btn.innerHTML = '\u26a0\ufe0f Gemini \u5099\u63f4\u4e2d... \u7d04\u9700 1-2 \u5206\u9418';
    }
  } catch(e) {
    btn.innerHTML = '\u26a0\ufe0f \u89f8\u767c\u5931\u6557\uff0c\u91cd\u8a66\u4e2d...';
  }

  btn.innerHTML = '\u23f3 \u8b80\u53d6\u6700\u65b0\u8cc7\u6599...';
  await new Promise(function(r) { setTimeout(r, 5000); });

  trendingCache = { all: null, bazi: null, tarot: null, mindful: null, persona: null, other: null };
  await loadAllTrending(true);

  btn.disabled = false;
  btn.innerHTML = '\ud83d\udd04 \u66f4\u65b0\u7206\u6587';
});
loadAllTrending(false);


// ── Inspiration: Save + List (Notion 同步 + localStorage fallback) ──

let inspirations = JSON.parse(localStorage.getItem('inspirations') || '[]');
let notionInspirations = null; // null = 尚未載入

// 靈感標籤按鈕切換
document.querySelectorAll('.insp-pill').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.insp-pill').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
  });
});

// 從 Notion 載入靈感
async function loadInspirations() {
  try {
    var result = await apiCall('/api/inspirations', null, 'GET');
    if (result && result.items) {
      notionInspirations = result.items;
      renderInspirations();
      return;
    }
  } catch (e) { console.log('Notion inspiration load failed, using localStorage'); }
  renderInspirations(); // fallback to localStorage
}

document.getElementById('saveInspirationBtn').addEventListener('click', async () => {
  const text = document.getElementById('inspirationInput').value.trim();
  if (!text) return;
  var activeTag = document.querySelector('.insp-pill.active');
  const tag = activeTag ? activeTag.dataset.tag : '八字';

  // 先存 localStorage
  const item = { text, tag, date: new Date().toLocaleDateString('zh-TW'), id: Date.now() };
  inspirations.unshift(item);
  localStorage.setItem('inspirations', JSON.stringify(inspirations));
  document.getElementById('inspirationInput').value = '';
  renderInspirations();

  // 同步到 Notion
  try {
    await apiCall('/api/inspirations', { text: text, tag: tag });
    loadInspirations(); // 重新從 Notion 載入
  } catch (e) { console.log('Notion save failed, kept in localStorage'); }
});

function isScreenshot(title) {
  if (!title) return false;
  return /^\[?\u5716\u7247|^IMG_|^\u622a\u5716|\.png|\.jpg|\.jpeg/i.test(title);
}

function renderInspirations() {
  const list = document.getElementById('inspirationList');
  // 優先用 Notion 資料，fallback 到 localStorage
  var items = notionInspirations || inspirations;
  var isNotion = !!notionInspirations;

  if (!items.length) {
    list.innerHTML = '<div class="info-box"><p>儲存的靈感會顯示在這裡</p></div>';
    return;
  }
  list.innerHTML = items.map(function(item) {
    var title = item.title || item.text || '';
    var tag = item.pillar || item.tag || '未分類';
    var date = item.created || item.date || '';
    var itemId = item.id || '';
    var safeText = title.replace(/'/g, "\\'").replace(/\n/g, '\\n');
    return '<div class="insp-item" data-id="' + itemId + '">'
      + '<div>'
      + '<div class="insp-item-top">'
      + '<span class="insp-item-tag insp-tag-editable" data-id="' + itemId + '" data-notion="' + (isNotion ? '1' : '0') + '" title="\u9ede\u64ca\u4fee\u6539\u6a19\u7c64">' + tag + '</span>'
      + '<span class="insp-item-meta">' + date + '</span>'
      + (item.source ? '<span class="insp-item-source">' + item.source + '</span>' : '')
      + '<button class="btn-icon-only insp-delete" data-id="' + itemId + '" data-notion="' + (isNotion ? '1' : '0') + '" title="刪除">✕</button>'
      + '</div>'
      + '<div class="insp-item-text">' + (isScreenshot(title) ? '<span style="color:var(--text-muted);font-style:italic;">\ud83d\uddbc\ufe0f \u622a\u5716\u9748\u611f\uff08\u5c1a\u672a\u8fa8\u8b58\u6587\u5b57\uff09</span>' : title.substring(0, 150)) + '</div>'
      + '<div class="insp-item-actions">'
      + '<button class="btn btn-outline btn-sm" onclick="useInspiration(\'' + safeText + '\')">\u2192 \u751f\u6210\u6587\u6848</button>'
      + '</div>'
      + '</div></div>';
  }).join('');

  list.querySelectorAll('.insp-delete').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var id = btn.dataset.id;
      var isNotionItem = btn.dataset.notion === '1';
      if (isNotionItem && id) {
        try { await apiCall('/api/inspirations/' + id, null, 'DELETE'); } catch(e) {}
        loadInspirations();
      } else {
        var numId = parseInt(id);
        inspirations = inspirations.filter(function(i) { return i.id !== numId; });
        localStorage.setItem('inspirations', JSON.stringify(inspirations));
        renderInspirations();
      }
    });
  });

  // 標籤點一下循環切換
  var TAG_CYCLE = ['\u516b\u5b57\u89c0\u5bdf', '\u516b\u5b57\u6559\u5b78', '\u5854\u7f85', '\u89ba\u5bdf', '\u4eba\u8a2d', '\u770b\u5287\u8aaa\u516b\u5b57', '\u672a\u5206\u985e'];
  list.querySelectorAll('.insp-tag-editable').forEach(function(tagEl) {
    tagEl.addEventListener('click', async function(e) {
      e.stopPropagation();
      var current = tagEl.textContent.trim();
      var idx = TAG_CYCLE.indexOf(current);
      var next = TAG_CYCLE[(idx + 1) % TAG_CYCLE.length];
      tagEl.textContent = next;
      // 更新 Notion
      var pageId = tagEl.dataset.id;
      if (tagEl.dataset.notion === '1' && pageId) {
        try { await apiCall('/api/inspirations/' + pageId + '/tag', { tag: next }, 'PATCH'); } catch(err) {}
      }
      // 更新 localStorage
      inspirations.forEach(function(item) {
        if (String(item.id) === String(pageId)) { item.tag = next; item.pillar = next; }
      });
      localStorage.setItem('inspirations', JSON.stringify(inspirations));
    });
  });
}

function useInspiration(text) {
  switchPage('copywriter');
  document.getElementById('copywriterInput').value = text.replace(/\\n/g, '\n');
}

loadInspirations(); // 從 Notion 載入靈感（fallback localStorage）
document.getElementById('weekPrev').addEventListener('click', () => { weekOffset--; loadSchedule(); });
document.getElementById('weekNext').addEventListener('click', () => { weekOffset++; loadSchedule(); });
loadSchedule(); // 從 Notion 載入排程


// ── Copywriter: Mode Tabs ──
let copyMode = 'generate'; // 'generate' | 'rewrite' | 'refine'
const MODE_HINTS = {
  generate: { icon: '✏️', label: '輸入主題或補充說明', placeholder: '直接輸入主題，AI 自動挑選形式並套用寫作技巧\n\n例如：夫妻宮坐比劫的感情模式', btn: '生成文案' },
  rewrite: { icon: '💡', label: '貼上你的原始想法', placeholder: '把你的粗糙想法、語音轉文字、筆記貼在這裡\n\nAI 會保留你的觀點和例子，大幅改寫結構和文筆', btn: '改寫文案' },
  refine: { icon: '📝', label: '貼上幾乎完成的文案', placeholder: '把你寫好的文案貼在這裡\n\nAI 只做最小幅度微調：亮點前移、壓縮冗字、AI味修正', btn: '微調文案' },
};
document.querySelectorAll('.copy-mode-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.copy-mode-tab').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    copyMode = tab.dataset.mode;
    var hint = MODE_HINTS[copyMode];
    document.getElementById('copyModeHint').innerHTML = '<span class="tool-card-icon">' + hint.icon + '</span><span>' + hint.label + '</span>';
    document.getElementById('copywriterInput').placeholder = hint.placeholder;
    document.getElementById('generateCopyBtn').innerHTML = '<span class="btn-icon">\u2728</span><span>' + hint.btn + '</span>';
  });
});

// ── Copywriter: File Upload ──
let uploadedFiles = []; // {name, type, data (base64 or text)}

function renderUploadPreview() {
  var el = document.getElementById('uploadPreview');
  var status = document.getElementById('uploadStatus');
  if (!uploadedFiles.length) {
    el.innerHTML = '';
    status.textContent = '\u53ef\u4e0a\u50b3\u5716\u7247\u6216\u6587\u4ef6\u8b93 AI \u53c3\u8003';
    return;
  }
  status.textContent = uploadedFiles.length + ' \u500b\u6a94\u6848\u5df2\u9644\u52a0';
  el.innerHTML = uploadedFiles.map(function(f, i) {
    var icon = f.type.startsWith('image') ? '\ud83d\uddbc\ufe0f' : '\ud83d\udcc4';
    var thumb = f.type.startsWith('image') ? '<img class="upload-thumb" src="' + f.data + '">' : '';
    return '<div class="upload-item">' + thumb + icon + ' ' + f.name
      + '<span class="upload-remove" data-idx="' + i + '">\u2715</span></div>';
  }).join('');
  el.querySelectorAll('.upload-remove').forEach(function(btn) {
    btn.addEventListener('click', function() {
      uploadedFiles.splice(parseInt(btn.dataset.idx), 1);
      renderUploadPreview();
    });
  });
}

document.getElementById('copyUploadImages').addEventListener('change', function(e) {
  Array.from(e.target.files).forEach(function(file) {
    var reader = new FileReader();
    reader.onload = function(ev) {
      uploadedFiles.push({ name: file.name, type: file.type, data: ev.target.result });
      renderUploadPreview();
    };
    reader.readAsDataURL(file);
  });
  e.target.value = '';
});

document.getElementById('copyUploadFiles').addEventListener('change', function(e) {
  Array.from(e.target.files).forEach(function(file) {
    var reader = new FileReader();
    reader.onload = function(ev) {
      uploadedFiles.push({ name: file.name, type: file.type, data: ev.target.result });
      renderUploadPreview();
    };
    if (file.type.startsWith('text') || file.name.endsWith('.md') || file.name.endsWith('.txt')) {
      reader.readAsText(file);
    } else {
      reader.readAsDataURL(file);
    }
  });
  e.target.value = '';
});

// ── Copywriter: Generate ──

const MOCK_COPIES = {
  '八字': {
    '極短金句型': '夫妻宮不好，不代表感情差。\n\n那只是你的慣性起點，不是結局。\n\n命盤告訴你的，從來不是「你會怎樣」，\n而是「你習慣怎樣」。\n\n改掉習慣，命就開始轉了。',
    '比喻降維型': '八字就像一本使用說明書。\n\n買家電都會翻說明書，\n但你活了二三十年，\n卻從來沒看過自己的。\n\n十神不是你的命運判決書，\n是你的出廠設定。\n\n看懂了，才知道哪裡該調整、\n哪裡該放大、哪裡該放過自己。',
    'default': '你有沒有想過——\n為什麼你的感情總是走到同一個死胡同？\n\n不是你不夠好，\n是你的命盤裡有一個「自動駕駛」模式，\n每次遇到壓力就啟動。\n\n在八字裡，這叫做慣性。\n看見它，你就有機會改寫它。',
  },
  '塔羅占卜': {
    'default': '塔羅不是算命，是照鏡子。\n\n鏡子不會改變你的臉，\n但看到了，你才知道今天要調什麼。\n\n下次抽牌的時候，\n試著不問「會怎樣」，\n改問「我現在需要看見什麼」。\n\n答案，一直都在你手上。',
  },
  '覺察修行': {
    'default': '改運最快的方法，不是燒香拜拜。\n\n是改掉你重複的選擇。\n\n你有沒有發現——\n每次遇到一樣的情境，你的反應也一樣？\n\n那個自動反應，就是你的「命」。\n覺察它，才有機會不再被它帶著走。\n\n命不是注定的。\n是你還沒意識到，你可以選別的。',
  },
};

// Flow step helper
function setFlowStep(step) {
  document.querySelectorAll('#aiFlowSteps .ai-flow-step').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.remove('active', 'completed');
    if (s < step) el.classList.add('completed');
    else if (s === step) el.classList.add('active');
  });
}

let currentCopy = '';
let currentTopic = '';
let currentPillar = '';
let currentFormat = '';

document.getElementById('generateCopyBtn').addEventListener('click', async () => {
  const pillar = document.querySelector('#pillarPills .pill.active')?.dataset.value || '八字';
  const format = document.getElementById('formatSelect').value;
  const topic = document.getElementById('copywriterInput').value.trim();
  const resultsEl = document.getElementById('copywriterResults');

  if (!topic) { document.getElementById('copywriterInput').focus(); return; }

  currentTopic = topic;
  currentPillar = pillar;
  currentFormat = format;

  const btn = document.getElementById('generateCopyBtn');
  btn.disabled = true;
  resultsEl.innerHTML = '';
  resultsEl.classList.remove('hidden');

  // ── B1/B2 原稿處理模式 ──
  if (copyMode === 'rewrite' || copyMode === 'refine') {
    var endpoint = copyMode === 'rewrite' ? '/api/rewrite-original' : '/api/refine-original';
    var modeLabel = copyMode === 'rewrite' ? '改寫' : '微調';
    btn.innerHTML = '<span class="btn-icon">\u23f3</span><span>AI ' + modeLabel + '\u4e2d...</span>';
    setFlowStep(2);

    var apiResult = null;
    try { apiResult = await apiCall(endpoint, { text: topic, pillar: pillar }); } catch(e) {}

    if (apiResult && apiResult.copy) {
      currentCopy = apiResult.copy;
      var techniques = apiResult.techniques_used || apiResult.changes || [];
      renderCopyResult(apiResult.copy, techniques, '', pillar, format, resultsEl);
    } else {
      resultsEl.innerHTML = '<div class="info-box"><p>\u26a0\ufe0f API \u66ab\u6642\u7121\u6cd5\u56de\u61c9\uff0c\u8acb\u7a0d\u5f8c\u91cd\u8a66</p></div>';
    }
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">\u2728</span><span>' + MODE_HINTS[copyMode].btn + '</span>';
    return;
  }

  // ── 一般生成模式（含 Hook 選項）──
  btn.innerHTML = '<span class="btn-icon">\u23f3</span><span>\u751f\u6210 Hook \u9078\u9805\u4e2d...</span>';
  setFlowStep(1);

  // ── Step 1：生成 Hook 選項 ──
  let hooks = [];
  try {
    const hookResult = await apiCall('/api/generate-hooks', { pillar, topic });
    if (hookResult && hookResult.hooks) hooks = hookResult.hooks;
  } catch (e) { console.log('Hook API error:', e.message); }

  if (hooks.length >= 2) {
    // 顯示 Hook 選項（點選高亮 + 確認按鈕）
    function renderHookPicker(hooksArr) {
      setFlowStep(1);
      var html = '<div class="flow-step-card"><div class="flow-step-header"><span class="flow-step-badge ai">\u9078\u64c7 Hook \u958b\u982d</span><span class="flow-check-brief">\u9ede\u9078\u5f8c\u6309\u78ba\u8a8d</span></div><div class="hook-options">';
      hooksArr.forEach(function(h, i) {
        html += '<div class="hook-option" data-idx="' + i + '">'
          + '<div class="hook-formula">' + (i+1) + '. ' + (h.formula || '\u5207\u5165\u89d2\u5ea6') + '</div>'
          + '<div class="hook-text">' + (h.text || '').replace(/\n/g, '<br>') + '</div>'
          + '</div>';
      });
      html += '</div>';
      html += '<div class="hook-confirm-bar">';
      html += '<span class="hook-selected-label" id="hookSelectedLabel">\u8acb\u5148\u9ede\u9078\u4e00\u500b Hook</span>';
      html += '<button class="btn btn-primary" id="hookConfirmBtn" disabled>\u2705 \u78ba\u8a8d\u9078\u64c7</button>';
      html += '<button class="btn btn-outline" id="hookSkipBtn">\u23ed\ufe0f \u4e0d\u6311\u4e86</button>';
      html += '<button class="btn btn-outline" id="hookRegenBtn">\ud83d\udd04 \u91cd\u65b0\u751f\u6210</button>';
      html += '</div></div>';
      resultsEl.innerHTML = html;
    }

    renderHookPicker(hooks);

    let selectedHook = await new Promise(function(resolve) {
      var pickedIdx = -99;

      function bindEvents() {
        // 點選 Hook 高亮
        resultsEl.querySelectorAll('.hook-option').forEach(function(el) {
          el.addEventListener('click', function() {
            resultsEl.querySelectorAll('.hook-option').forEach(function(o) { o.classList.remove('selected'); });
            el.classList.add('selected');
            pickedIdx = parseInt(el.dataset.idx);
            var label = document.getElementById('hookSelectedLabel');
            var confirmBtn = document.getElementById('hookConfirmBtn');
            if (label) label.textContent = '\u5df2\u9078\uff1a' + (pickedIdx + 1) + '. ' + (hooks[pickedIdx] ? hooks[pickedIdx].formula || '' : '');
            if (confirmBtn) confirmBtn.disabled = false;
          });
        });
        // 確認按鈕
        document.getElementById('hookConfirmBtn').addEventListener('click', function() {
          if (pickedIdx >= 0 && hooks[pickedIdx]) resolve(hooks[pickedIdx]);
        });
        // 跳過
        document.getElementById('hookSkipBtn').addEventListener('click', function() { resolve(null); });
        // 重新生成
        document.getElementById('hookRegenBtn').addEventListener('click', function() { resolve('REGEN'); });
      }
      bindEvents();
    });

    // 重新生成 Hook 迴圈
    while (selectedHook === 'REGEN') {
      resultsEl.innerHTML = '<div class="flow-step-card"><div class="flow-step-header"><span class="flow-step-badge ai">\ud83d\udd04 \u91cd\u65b0\u751f\u6210 Hook \u4e2d...</span></div></div>';
      hooks = [];
      try {
        var hookResult2 = await apiCall('/api/generate-hooks', { pillar, topic });
        if (hookResult2 && hookResult2.hooks) hooks = hookResult2.hooks;
      } catch(e) {}

      if (hooks.length < 2) { selectedHook = null; break; }

      renderHookPicker(hooks);

      selectedHook = await new Promise(function(resolve) {
        var pickedIdx = -99;
        resultsEl.querySelectorAll('.hook-option').forEach(function(el) {
          el.addEventListener('click', function() {
            resultsEl.querySelectorAll('.hook-option').forEach(function(o) { o.classList.remove('selected'); });
            el.classList.add('selected');
            pickedIdx = parseInt(el.dataset.idx);
            var label = document.getElementById('hookSelectedLabel');
            var confirmBtn = document.getElementById('hookConfirmBtn');
            if (label) label.textContent = '\u5df2\u9078\uff1a' + (pickedIdx + 1) + '. ' + (hooks[pickedIdx] ? hooks[pickedIdx].formula || '' : '');
            if (confirmBtn) confirmBtn.disabled = false;
          });
        });
        document.getElementById('hookConfirmBtn').addEventListener('click', function() {
          if (pickedIdx >= 0 && hooks[pickedIdx]) resolve(hooks[pickedIdx]);
        });
        document.getElementById('hookSkipBtn').addEventListener('click', function() { resolve(null); });
        document.getElementById('hookRegenBtn').addEventListener('click', function() { resolve('REGEN'); });
      });
    }

    // ── Step 2：用選定 Hook 生成完整文案 ──
    btn.innerHTML = '<span class="btn-icon">⏳</span><span>AI 寫初稿中...</span>';
    setFlowStep(2);

    let copy = '', techniques = [], hookType = '', sources = [];
    if (selectedHook) {
      try {
        const apiResult = await apiCall('/api/generate-with-hook', { pillar, format, topic, hook: selectedHook.text, attachments: uploadedFiles });
        if (apiResult && apiResult.copy) {
          copy = apiResult.copy;
          techniques = apiResult.techniques_used || [];
          hookType = apiResult.hook_type || selectedHook.formula || '';
          sources = apiResult.sources || [];
        }
      } catch (e) { console.log('API error:', e.message); }
    }

    if (!copy) {
      try {
        const apiResult = await apiCall('/api/generate-copy', { pillar, format, topic, attachments: uploadedFiles });
        if (apiResult && apiResult.copy) {
          copy = apiResult.copy;
          techniques = apiResult.techniques_used || [];
          hookType = apiResult.hook_type || '';
          sources = apiResult.sources || [];
        }
      } catch (e) { console.log('API fallback error:', e.message); }
    }

    if (!copy) {
      await sleep(1500);
      const pillarCopies = MOCK_COPIES[pillar] || MOCK_COPIES['八字'];
      copy = pillarCopies[format] || pillarCopies['default'] || MOCK_COPIES['八字']['default'];
      techniques = ['震撼亮點前移', '極致壓縮句型', '餘韻設計'];
    }

    currentCopy = copy;
    renderCopyResult(copy, techniques, hookType, pillar, format, resultsEl, sources);

  } else {
    // Hook API 不可用，直接生成
    btn.innerHTML = '<span class="btn-icon">⏳</span><span>AI 寫初稿中...</span>';
    setFlowStep(2);

    let copy = '', techniques = [], hookType = '', sources2 = [];
    try {
      const apiResult = await apiCall('/api/generate-copy', { pillar, format, topic, attachments: uploadedFiles });
      if (apiResult && apiResult.copy) {
        copy = apiResult.copy;
        techniques = apiResult.techniques_used || [];
        hookType = apiResult.hook_type || '';
        sources2 = apiResult.sources || [];
      }
    } catch (e) { console.log('API error:', e.message); }

    if (!copy) {
      await sleep(1500);
      const pillarCopies = MOCK_COPIES[pillar] || MOCK_COPIES['八字'];
      copy = pillarCopies[format] || pillarCopies['default'] || MOCK_COPIES['八字']['default'];
      techniques = ['震撼亮點前移', '極致壓縮句型', '餘韻設計'];
    }

    currentCopy = copy;
    renderCopyResult(copy, techniques, hookType, pillar, format, resultsEl, sources2);
  }

  btn.disabled = false;
  btn.innerHTML = '<span class="btn-icon">✨</span><span>生成文案</span>';
});

function renderCopyResult(copy, techniques, hookType, pillar, format, resultsEl, sources) {
  sources = sources || [];
  setFlowStep(3);

  // AI 味檢測
  const aiChecks = [
    { label: '開頭現場感', pass: !/^(近年來|隨著|在當今)/.test(copy) },
    { label: '無模板轉折詞', pass: !/(此外|另外值得|最後讓我們)/.test(copy) },
    { label: '有具體細節', pass: /\d/.test(copy) || /我|朋友|那天|昨天/.test(copy) },
    { label: '有明確立場', pass: !/這樣也對.*那樣也/.test(copy) },
    { label: 'Emoji 適量', pass: (copy.match(/[\u{1F000}-\u{1FFFF}]/gu) || []).length <= 2 },
  ];
  const passCount = aiChecks.filter(c => c.pass).length;

  // 字數分析
  const charCount = copy.replace(/\s/g, '').length;
  const charStatus = charCount <= 300 ? '✅ 適中' : charCount <= 500 ? '⚠️ 偏長' : '❌ 過長';

  resultsEl.innerHTML = `
    <!-- AI 寫初稿 + 查核結果 -->
    <div class="flow-step-card">
      <div class="flow-step-header">
        <span class="flow-step-badge ai">AI 初稿（已查核）</span>
        <span class="flow-step-status">字數 ${charCount} ${charStatus}</span>
      </div>
      <div class="result-content copy-output">${copy.replace(/\n/g, '<br>')}</div>
      <div class="flow-step-meta">${pillar}${format ? ' · ' + format : ''}</div>
    </div>

    <!-- 查核狀況（收合式） -->
    <details class="collapsible-section">
      <summary class="collapsible-header">
        <span class="collapsible-icon">\u25b6</span>
        <span class="status-pass"><span class="status-dot"></span> \u81ea\u52d5\u67e5\u6838\u5b8c\u6210</span>
        <span class="flow-check-brief">${passCount === aiChecks.length
          ? '<span class="status-pass"><span class="status-dot"></span> ' + passCount + '/' + aiChecks.length + ' \u5168\u901a\u904e</span>'
          : '<span class="status-warn"><span class="status-dot"></span> ' + passCount + '/' + aiChecks.length + ' \u901a\u904e</span>'}</span>
      </summary>
      <div class="collapsible-body">
        ${aiChecks.map(c => '<div class="check-item"><span class="check-icon ' + (c.pass ? 'check-icon-pass' : 'check-icon-warn') + '">' + (c.pass ? '\u2713' : '!' ) + '</span><span>' + c.label + '</span></div>').join('')}
      </div>
    </details>

    <!-- 套用技巧（收合式） -->
    <details class="collapsible-section">
      <summary class="collapsible-header">
        <span class="collapsible-icon">\u25b6</span>
        <span class="status-pass"><span class="status-dot"></span> \u5957\u7528\u6280\u5de7</span>
        <span class="flow-check-brief">${techniques.length} \u9805</span>
      </summary>
      <div class="collapsible-body">
        ${techniques.map(t => '<div class="check-item"><span class="check-icon check-icon-pass">\u2713</span><span>' + t + '</span></div>').join('')}
      </div>
    </details>

    <!-- 快速修改（可點選按鈕） -->
    <div class="quick-fix-bar">
      <button class="quick-fix-btn" data-action="rewrite-opening">\u270f\ufe0f \u91cd\u5beb\u958b\u982d</button>
      <button class="quick-fix-btn" data-action="rewrite-ending">\u270f\ufe0f \u91cd\u5beb\u7d50\u5c3e</button>
      <button class="quick-fix-btn" data-action="add-details">\ud83d\udd0d \u52a0\u5165\u7d30\u7bc0</button>
      <button class="quick-fix-btn" data-action="compress">\u2702\ufe0f \u58d3\u7e2e\u5197\u5b57</button>
    </div>

    <!-- 查核來源（收合式） -->
    <details class="collapsible-section">
      <summary class="collapsible-header">
        <span class="collapsible-icon">\u25b6</span>
        <span class="status-pass"><span class="status-dot"></span> \u67e5\u6838\u4f86\u6e90</span>
        <span class="flow-check-brief">${sources.length ? sources.length + ' \u7b46\u641c\u5c0b\u7d50\u679c' : '\u5167\u90e8\u898f\u7bc4'}</span>
      </summary>
      <div class="collapsible-body">
        <div class="check-item"><span class="check-icon check-icon-pass">\u2713</span><span>brand/brand_voice.md\uff08\u54c1\u724c\u8a9e\u6c23\uff09</span></div>
        <div class="check-item"><span class="check-icon check-icon-pass">\u2713</span><span>skills/writing-technique/SKILL.md\uff08\u5beb\u4f5c\u6280\u5de7\uff09</span></div>
        ${hookType ? '<div class="check-item"><span class="check-icon check-icon-pass">\u2713</span><span>Hook \u985e\u578b\uff1a' + hookType + '</span></div>' : ''}
        ${sources.length ? '<div class="flow-check-title" style="margin-top:8px;">\ud83d\udd0d \u641c\u5c0b\u53c3\u8003</div>' + sources.map(function(s) { return '<div class="check-item"><span class="check-icon check-icon-pass">\u2713</span><span>' + s + '</span></div>'; }).join('') : ''}
      </div>
    </details>

    <!-- 操作按鈕（類似 Discord） -->
    <div class="flow-step-card">
      <div class="flow-step-header">
        <span class="flow-step-badge you">下一步</span>
      </div>
      <div class="copy-actions">
        <button class="btn btn-primary btn-copy" onclick="navigator.clipboard.writeText(document.querySelector('.copy-output').innerText);this.innerHTML='✅ 已複製';setTimeout(()=>this.innerHTML='📋 複製文案',1500)">📋 複製文案</button>
        <button class="btn btn-outline" id="btnRewriteCopy">✏️ 我要修改</button>
        <button class="btn btn-outline" id="btnAiSuggest">💡 給修改建議</button>
        <button class="btn btn-outline" id="btnAiRewrite">🔄 AI 重寫一版</button>
        <button class="btn btn-outline" onclick="switchPage('carousel')">📱 轉輪播</button>
        <button class="btn btn-outline" onclick="switchPage('schedule')">📅 排入排程</button>
        <button class="btn btn-outline" id="btnSaveNotion">📌 存入 Notion</button>
      </div>
    </div>
  `;

  // 「我要修改」按鈕：展開編輯區
  document.getElementById('btnRewriteCopy')?.addEventListener('click', () => {
    const editArea = document.createElement('div');
    editArea.className = 'flow-step-card';
    editArea.innerHTML = '<div class="flow-step-header"><span class="flow-step-badge you">編輯文案</span></div>'
      + '<textarea class="tool-textarea" id="editCopyArea" style="min-height:200px;">' + currentCopy + '</textarea>'
      + '<div class="copy-actions" style="margin-top:8px;">'
      + '<button class="btn btn-primary" id="saveCopyEdit">💾 儲存修改</button>'
      + '<button class="btn btn-outline" id="aiCheckEdit">🔍 AI 重新查核</button>'
      + '</div>';
    resultsEl.appendChild(editArea);
    document.getElementById('editCopyArea').focus();
    setFlowStep(3);

    document.getElementById('saveCopyEdit')?.addEventListener('click', () => {
      currentCopy = document.getElementById('editCopyArea').value;
      document.querySelector('.copy-output').innerHTML = currentCopy.replace(/\n/g, '<br>');
      const newCount = currentCopy.replace(/\s/g, '').length;
      editArea.innerHTML = '<div class="flow-step-header"><span class="flow-step-badge check">✅ 已儲存</span><span class="flow-step-status">字數 ' + newCount + '</span></div>';
      setFlowStep(4);
    });

    // 「AI 重新查核」按鈕
    document.getElementById('aiCheckEdit')?.addEventListener('click', async () => {
      const editedCopy = document.getElementById('editCopyArea').value.trim();
      if (!editedCopy) return;
      currentCopy = editedCopy;

      const checkBtn = document.getElementById('aiCheckEdit');
      checkBtn.disabled = true;
      checkBtn.innerHTML = '🔍 查核中...';

      let reviewResult = null;
      try {
        reviewResult = await apiCall('/api/review-copy', { copy: editedCopy, topic: currentTopic });
      } catch (e) { console.log('Review API error:', e.message); }

      if (reviewResult) {
        const reviewCard = document.createElement('div');
        reviewCard.className = 'flow-step-card';
        let reviewHtml = '<div class="flow-step-header"><span class="flow-step-badge check">AI 查核結果</span></div>';

        if (reviewResult.passed && reviewResult.passed.length) {
          reviewHtml += '<div class="flow-step-checks"><div class="flow-check-title">✅ 通過</div><ul>' + reviewResult.passed.map(function(p) { return '<li>\u2705 ' + p + '</li>'; }).join('') + '</ul></div>';
        }
        if (reviewResult.highlights && reviewResult.highlights.length) {
          reviewHtml += '<div class="flow-step-checks"><div class="flow-check-title">💡 亮點</div><ul>' + reviewResult.highlights.map(function(h) { return '<li>\u2728 ' + h + '</li>'; }).join('') + '</ul></div>';
        }
        if (reviewResult.warnings && reviewResult.warnings.length) {
          reviewHtml += '<div class="flow-step-checks"><div class="flow-check-title">⚠️ 建議調整</div><ul>' + reviewResult.warnings.map(function(w) { return '<li>\u26a0\ufe0f ' + w + '</li>'; }).join('') + '</ul></div>';
        }
        if (reviewResult.errors && reviewResult.errors.length) {
          reviewHtml += '<div class="flow-step-checks"><div class="flow-check-title">❌ 必須修正</div><ul>' + reviewResult.errors.map(function(e) { return '<li>\u274c ' + e + '</li>'; }).join('') + '</ul></div>';
        }

        // 如果有建議修正版本
        if (reviewResult.suggestion && reviewResult.suggestion.trim()) {
          reviewHtml += '<div class="copy-actions" style="margin-top:12px;">'
            + '<button class="btn btn-primary" id="applySuggestion">✅ 套用建議修正</button>'
            + '<button class="btn btn-outline" id="skipSuggestion">⏭️ 不調整</button>'
            + '</div>';
        }

        reviewCard.innerHTML = reviewHtml;
        resultsEl.appendChild(reviewCard);
        setFlowStep(4);

        // 套用建議
        document.getElementById('applySuggestion')?.addEventListener('click', function() {
          currentCopy = reviewResult.suggestion;
          document.querySelector('.copy-output').innerHTML = currentCopy.replace(/\n/g, '<br>');
          document.getElementById('editCopyArea').value = currentCopy;
          reviewCard.innerHTML = '<div class="flow-step-header"><span class="flow-step-badge check">✅ 已套用建議修正</span></div>';
        });
        document.getElementById('skipSuggestion')?.addEventListener('click', function() {
          reviewCard.innerHTML = '<div class="flow-step-header"><span class="flow-step-badge check">✅ 保持原文</span></div>';
        });
      } else {
        checkBtn.innerHTML = '⚠️ 查核暫不可用';
      }
      checkBtn.disabled = false;
      checkBtn.innerHTML = '🔍 AI 重新查核';
    });
  });

  // 「存入 Notion」按鈕
  document.getElementById('btnSaveNotion')?.addEventListener('click', async function() {
    var btn = this;
    btn.disabled = true;
    btn.innerHTML = '📌 儲存中...';
    try {
      await apiCall('/api/save-content', {
        title: currentTopic,
        content: currentCopy,
        pillar: currentPillar,
        status: '草稿-50%',
        db: 'threads',
      });
      btn.innerHTML = '✅ 已存入 Notion';
    } catch (e) {
      btn.innerHTML = '⚠️ 儲存失敗';
      setTimeout(function() { btn.innerHTML = '📌 存入 Notion'; btn.disabled = false; }, 2000);
    }
  });

  // 快速修改按鈕
  var FORMAT_RULE = '⚠️ 格式規則：保留所有換行和空行、每句獨立一行不超過25字、emoji整篇最多2個、不要合併短句成長句。';
  var QUICK_FIX_PROMPTS = {
    'rewrite-opening': '請只修改這篇文案的「開頭前 2-3 行」，換一個更有衝擊力的 Hook。保持其他部分不變。用現場感、具體場景或反問句替換。' + FORMAT_RULE,
    'rewrite-ending': '請只修改這篇文案的「結尾最後 2-3 行」，換一個更有餘韻的收尾。保持其他部分不變。用金句、反思問句或懸念替換。' + FORMAT_RULE,
    'add-details': '請在這篇文案中加入更多具體細節（人名、地點、時間、數字、個人經驗），讓文案更有真實感。盡量保持原結構。' + FORMAT_RULE,
    'compress': '請壓縮這篇文案，刪除冗字冗句（通常/可能/應該/或許），讓每句更精簡有力。保留核心觀點和所有細節。' + FORMAT_RULE,
  };
  resultsEl.querySelectorAll('.quick-fix-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var action = btn.dataset.action;
      var instruction = QUICK_FIX_PROMPTS[action];
      if (!instruction) return;
      btn.disabled = true;
      var origText = btn.innerHTML;
      btn.innerHTML = '\u23f3 AI \u8655\u7406\u4e2d...';

      try {
        var result = await apiCall('/api/refine-original', {
          text: currentCopy + '\n\n---\u4fee\u6539\u6307\u4ee4---\n' + instruction,
        });
        if (result && result.copy) {
          var card = document.createElement('div');
          card.className = 'flow-step-card';
          card.innerHTML = '<div class="flow-step-header"><span class="status-pass"><span class="status-dot"></span> ' + origText.replace(/[\u270f\ufe0f\ud83d\udd0d\u2702\ufe0f]/g, '').trim() + ' \u5b8c\u6210</span></div>'
            + '<div class="result-content" style="white-space:pre-line;margin:8px 0;font-size:13px;">' + result.copy.replace(/\n/g, '<br>') + '</div>'
            + '<div class="copy-actions" style="margin-top:8px;">'
            + '<button class="btn btn-primary use-fix-btn">\u2705 \u63a1\u7528</button>'
            + '<button class="btn btn-outline dismiss-fix-btn">\u274c \u4e0d\u7528</button>'
            + '</div>';
          resultsEl.appendChild(card);
          card.querySelector('.use-fix-btn').addEventListener('click', function() {
            currentCopy = result.copy;
            document.querySelector('.copy-output').innerHTML = currentCopy.replace(/\n/g, '<br>');
            card.innerHTML = '<div class="flow-step-header"><span class="status-pass"><span class="status-dot"></span> \u5df2\u63a1\u7528</span></div>';
          });
          card.querySelector('.dismiss-fix-btn').addEventListener('click', function() {
            card.remove();
          });
        }
      } catch(e) {}
      btn.disabled = false;
      btn.innerHTML = origText;
    });
  });

  // 「給修改建議」按鈕：AI 查核 + 給建議但不改
  document.getElementById('btnAiSuggest')?.addEventListener('click', async function() {
    var btn = this;
    btn.disabled = true;
    btn.innerHTML = '\ud83d\udca1 AI \u5206\u6790\u4e2d...';

    var reviewResult = null;
    try {
      reviewResult = await apiCall('/api/review-copy', { copy: currentCopy, topic: currentTopic });
    } catch(e) {}

    if (reviewResult) {
      var card = document.createElement('div');
      card.className = 'flow-step-card';
      var html = '<div class="flow-step-header"><span class="status-pass"><span class="status-dot"></span> AI \u4fee\u6539\u5efa\u8b70</span></div>';

      if (reviewResult.highlights && reviewResult.highlights.length) {
        html += '<div style="margin:8px 0;"><div class="flow-check-title">\u4eae\u9ede</div>';
        html += reviewResult.highlights.map(function(h) { return '<div class="check-item"><span class="check-icon check-icon-pass">\u2605</span><span>' + h + '</span></div>'; }).join('');
        html += '</div>';
      }
      if (reviewResult.errors && reviewResult.errors.length) {
        html += '<div style="margin:8px 0;"><div class="flow-check-title" style="color:#a04030;">\u5fc5\u9808\u4fee\u6b63</div>';
        html += reviewResult.errors.map(function(e) { return '<div class="check-item"><span class="check-icon check-icon-fail">\u2717</span><span>' + e + '</span></div>'; }).join('');
        html += '</div>';
      }
      if (reviewResult.warnings && reviewResult.warnings.length) {
        html += '<div style="margin:8px 0;"><div class="flow-check-title" style="color:#8a6a40;">\u5efa\u8b70\u8abf\u6574</div>';
        html += reviewResult.warnings.map(function(w) { return '<div class="check-item"><span class="check-icon check-icon-warn">!</span><span>' + w + '</span></div>'; }).join('');
        html += '</div>';
      }
      if (reviewResult.passed && reviewResult.passed.length) {
        html += '<details class="collapsible-section" style="margin-top:8px;"><summary class="collapsible-header"><span class="collapsible-icon">\u25b6</span><span class="status-pass"><span class="status-dot"></span> \u901a\u904e\u9805\u76ee</span><span class="flow-check-brief">' + reviewResult.passed.length + ' \u9805</span></summary>';
        html += '<div class="collapsible-body">' + reviewResult.passed.map(function(p) { return '<div class="check-item"><span class="check-icon check-icon-pass">\u2713</span><span>' + p + '</span></div>'; }).join('') + '</div></details>';
      }

      // 如果有建議修正版本
      if (reviewResult.suggestion && reviewResult.suggestion.trim()) {
        html += '<div class="copy-actions" style="margin-top:12px;">'
          + '<button class="btn btn-primary apply-suggestion-btn">\u2705 \u5957\u7528\u5efa\u8b70\u4fee\u6b63</button>'
          + '<button class="btn btn-outline dismiss-suggestion-btn">\u26a0\ufe0f \u4e0d\u8abf\u6574</button>'
          + '</div>';
      }
      card.innerHTML = html;
      resultsEl.appendChild(card);

      card.querySelector('.apply-suggestion-btn')?.addEventListener('click', function() {
        currentCopy = reviewResult.suggestion;
        document.querySelector('.copy-output').innerHTML = currentCopy.replace(/\n/g, '<br>');
        card.innerHTML = '<div class="flow-step-header"><span class="flow-step-badge check">\u2705 \u5df2\u5957\u7528\u5efa\u8b70\u4fee\u6b63</span></div>';
      });
      card.querySelector('.dismiss-suggestion-btn')?.addEventListener('click', function() {
        card.innerHTML = '<div class="flow-step-header"><span class="flow-step-badge check">\u2705 \u4fdd\u6301\u539f\u6587</span></div>';
      });
    } else {
      var errCard = document.createElement('div');
      errCard.className = 'flow-step-card';
      errCard.innerHTML = '<div class="flow-step-header"><span class="flow-step-badge check">\u26a0\ufe0f AI \u67e5\u6838\u66ab\u4e0d\u53ef\u7528</span></div>';
      resultsEl.appendChild(errCard);
    }
    btn.disabled = false;
    btn.innerHTML = '\ud83d\udca1 \u7d66\u4fee\u6539\u5efa\u8b70';
  });

  // 「AI 重寫一版」按鈕：AI 根據現有文案重寫
  document.getElementById('btnAiRewrite')?.addEventListener('click', async function() {
    var btn = this;
    btn.disabled = true;
    btn.innerHTML = '\ud83d\udd04 AI \u91cd\u5beb\u4e2d...';

    var rewriteResult = null;
    try {
      rewriteResult = await apiCall('/api/rewrite-original', { text: currentCopy, pillar: currentPillar });
    } catch(e) {}

    if (rewriteResult && rewriteResult.copy) {
      var card = document.createElement('div');
      card.className = 'flow-step-card';
      var newCopy = rewriteResult.copy;
      var charCount = newCopy.replace(/\s/g, '').length;
      card.innerHTML = '<div class="flow-step-header"><span class="flow-step-badge ai">\ud83d\udd04 AI \u91cd\u5beb\u7248\u672c</span><span class="flow-step-status">\u5b57\u6578 ' + charCount + '</span></div>'
        + '<div class="result-content" style="white-space:pre-line;margin:8px 0;">' + newCopy.replace(/\n/g, '<br>') + '</div>'
        + '<div class="copy-actions" style="margin-top:8px;">'
        + '<button class="btn btn-primary use-rewrite-btn">\u2705 \u63a1\u7528\u9019\u7248</button>'
        + '<button class="btn btn-outline dismiss-rewrite-btn">\u274c \u4e0d\u7528</button>'
        + '</div>';
      resultsEl.appendChild(card);

      card.querySelector('.use-rewrite-btn')?.addEventListener('click', function() {
        currentCopy = newCopy;
        document.querySelector('.copy-output').innerHTML = currentCopy.replace(/\n/g, '<br>');
        card.innerHTML = '<div class="flow-step-header"><span class="flow-step-badge check">\u2705 \u5df2\u63a1\u7528\u91cd\u5beb\u7248\u672c</span></div>';
      });
      card.querySelector('.dismiss-rewrite-btn')?.addEventListener('click', function() {
        card.innerHTML = '<div class="flow-step-header"><span class="flow-step-badge check">\u2705 \u4fdd\u6301\u539f\u6587</span></div>';
      });
    } else {
      var errCard = document.createElement('div');
      errCard.className = 'flow-step-card';
      errCard.innerHTML = '<div class="flow-step-header"><span class="flow-step-badge check">\u26a0\ufe0f \u91cd\u5beb\u5931\u6557</span></div>';
      resultsEl.appendChild(errCard);
    }
    btn.disabled = false;
    btn.innerHTML = '\ud83d\udd04 AI \u91cd\u5beb\u4e00\u7248';
  });

  resultsEl.classList.remove('hidden');
}


// ── Bazi Trending: 八字命理爆文 ──

var baziTrendingData = [];

document.querySelectorAll('[data-bazi-filter]').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('[data-bazi-filter]').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    renderBaziTrending(tab.dataset.baziFilter);
  });
});

document.getElementById('refreshBaziBtn')?.addEventListener('click', async function() {
  var btn = this;
  var activeFilter = document.querySelector('[data-bazi-filter].active');
  var sub = activeFilter ? activeFilter.dataset.baziFilter : 'all';
  btn.disabled = true;
  btn.innerHTML = '\u23f3 \u641c\u5c0b\u4e2d...';
  document.getElementById('baziTrendingList').innerHTML = '<div class="info-box"><p>\u23f3 AI \u6b63\u5728\u641c\u5c0b\u516b\u5b57\u547d\u7406\u76f8\u95dc\u7206\u6587...</p></div>';

  try {
    var result = await apiCall('/api/bazi-trending?sub=' + sub);
    if (result && result.items) {
      baziTrendingData = result.items;
      renderBaziTrending(sub);
    } else {
      document.getElementById('baziTrendingList').innerHTML = '<div class="info-box"><p>\u26a0\ufe0f \u641c\u5c0b\u5931\u6557</p></div>';
    }
  } catch(e) {
    document.getElementById('baziTrendingList').innerHTML = '<div class="info-box"><p>\u26a0\ufe0f ' + e.message + '</p></div>';
  }
  btn.disabled = false;
  btn.innerHTML = '\ud83d\udd04 \u641c\u5c0b\u6700\u65b0';
});

function renderBaziTrending(filter) {
  var list = document.getElementById('baziTrendingList');
  if (!baziTrendingData.length) {
    list.innerHTML = '<div class="info-box"><p>\u9ede\u300c\ud83d\udd04 \u641c\u5c0b\u6700\u65b0\u300d\u8f09\u5165\u516b\u5b57\u547d\u7406\u76f8\u95dc\u7206\u6587</p></div>';
    return;
  }
  var filtered = filter === 'all' ? baziTrendingData : baziTrendingData.filter(function(p) { return p.sub === filter; });
  if (!filtered.length) {
    list.innerHTML = '<div class="info-box"><p>\u9019\u500b\u5206\u985e\u7684\u641c\u5c0b\u7d50\u679c\u70ba\u7a7a</p></div>';
    return;
  }

  list.innerHTML = filtered.map(function(t) {
    var text = (t.text || '').replace(/</g, '&lt;').substring(0, 250);
    var correctBadge = '';
    if (t.correct === true) correctBadge = '<span class="status-pass"><span class="status-dot"></span> \u77e5\u8b58\u6b63\u78ba</span>';
    else if (t.correct === false) correctBadge = '<span class="status-fail"><span class="status-dot"></span> \u77e5\u8b58\u6709\u8aa4</span>';

    return '<div class="trending-card">'
      + '<div class="trending-header">'
      + '<span class="trending-level">' + (t.level || '') + '</span>'
      + (t.author ? '<span class="trending-author">@' + t.author + '</span>' : '')
      + '<span class="trending-likes">\u2764\ufe0f ' + (t.likes || 0).toLocaleString() + '</span>'
      + '<span class="trending-engagement">\ud83d\udcac ' + (t.comments || 0) + ' \ud83d\udd04 ' + (t.reposts || 0) + '</span>'
      + '</div>'
      + '<p class="trending-text">' + text + '</p>'
      + (t.knowledge ? '<div class="bazi-knowledge"><span class="bazi-knowledge-label">\ud83d\udcda \u547d\u7406\u77e5\u8b58\u9ede</span> ' + t.knowledge + ' ' + correctBadge + '</div>' : '')
      + (t.note ? '<div class="bazi-note">\u26a0\ufe0f ' + t.note + '</div>' : '')
      + '<details class="trending-analysis-details"><summary class="trending-analysis-summary">Hook \u5206\u6790</summary>'
      + '<div class="trending-analysis">'
      + (t.hook ? '<div class="trending-analysis-row"><span class="trending-analysis-label">Hook</span><span>' + t.hook + '</span></div>' : '')
      + (t.why ? '<div class="trending-analysis-row"><span class="trending-analysis-label">\u70ba\u4ec0\u9ebc\u7206</span><span>' + t.why + '</span></div>' : '')
      + '</div></details>'
      + '<div class="trending-actions">'
      + '<button class="btn btn-outline btn-sm" onclick="useAsTemplate(\'' + text.replace(/'/g, "\\'").substring(0, 80) + '\')">\u2192 \u5957\u7528</button>'
      + '</div></div>';
  }).join('');
}


// ── Persona Trending: 人設爆文 ──

var personaTrendingData = [];

document.querySelectorAll('[data-persona-filter]').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('[data-persona-filter]').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    renderPersonaTrending(tab.dataset.personaFilter);
  });
});

document.getElementById('refreshPersonaBtn')?.addEventListener('click', async function() {
  var btn = this;
  var activeFilter = document.querySelector('[data-persona-filter].active');
  var sub = activeFilter ? activeFilter.dataset.personaFilter : 'all';
  btn.disabled = true;
  btn.innerHTML = '\u23f3 \u641c\u5c0b\u4e2d...';
  document.getElementById('personaTrendingList').innerHTML = '<div class="info-box"><p>\u23f3 AI \u6b63\u5728\u641c\u5c0b\u4eba\u8a2d\u76f8\u95dc\u7206\u6587...</p></div>';

  try {
    var result = await apiCall('/api/persona-trending?sub=' + sub);
    if (result && result.items) {
      personaTrendingData = result.items;
      renderPersonaTrending(sub);
    } else {
      document.getElementById('personaTrendingList').innerHTML = '<div class="info-box"><p>\u26a0\ufe0f \u641c\u5c0b\u5931\u6557</p></div>';
    }
  } catch(e) {
    document.getElementById('personaTrendingList').innerHTML = '<div class="info-box"><p>\u26a0\ufe0f ' + e.message + '</p></div>';
  }
  btn.disabled = false;
  btn.innerHTML = '\ud83d\udd04 \u641c\u5c0b\u6700\u65b0';
});

function renderPersonaTrending(filter) {
  var list = document.getElementById('personaTrendingList');
  if (!personaTrendingData.length) {
    list.innerHTML = '<div class="info-box"><p>\u9ede\u300c\ud83d\udd04 \u641c\u5c0b\u6700\u65b0\u300d\u8f09\u5165\u4eba\u8a2d\u76f8\u95dc\u7206\u6587</p></div>';
    return;
  }
  var filtered = filter === 'all' ? personaTrendingData : personaTrendingData.filter(function(p) { return p.sub === filter; });
  if (!filtered.length) {
    list.innerHTML = '<div class="info-box"><p>\u9019\u500b\u5206\u985e\u7684\u641c\u5c0b\u7d50\u679c\u70ba\u7a7a</p></div>';
    return;
  }

  list.innerHTML = filtered.map(function(t) {
    var text = (t.text || '').replace(/</g, '&lt;').substring(0, 250);
    return '<div class="trending-card">'
      + '<div class="trending-header">'
      + '<span class="trending-level">' + (t.level || '') + '</span>'
      + (t.author ? '<span class="trending-author">@' + t.author + '</span>' : '')
      + '<span class="trending-likes">\u2764\ufe0f ' + (t.likes || 0).toLocaleString() + '</span>'
      + '<span class="trending-engagement">\ud83d\udcac ' + (t.comments || 0) + ' \ud83d\udd04 ' + (t.reposts || 0) + '</span>'
      + '</div>'
      + '<p class="trending-text">' + text + '</p>'
      + (t.angle ? '<div class="bazi-knowledge"><span class="bazi-knowledge-label">\ud83c\udfaf \u5957\u7528\u5efa\u8b70</span> ' + t.angle + '</div>' : '')
      + '<details class="trending-analysis-details"><summary class="trending-analysis-summary">Hook \u5206\u6790</summary>'
      + '<div class="trending-analysis">'
      + (t.hook ? '<div class="trending-analysis-row"><span class="trending-analysis-label">Hook</span><span>' + t.hook + '</span></div>' : '')
      + (t.why ? '<div class="trending-analysis-row"><span class="trending-analysis-label">\u70ba\u4ec0\u9ebc\u7206</span><span>' + t.why + '</span></div>' : '')
      + '</div></details>'
      + '<div class="trending-actions">'
      + '<button class="btn btn-outline btn-sm" onclick="useAsTemplate(\'' + (t.angle || text).replace(/'/g, "\\'").substring(0, 80) + '\')">\u2192 \u5957\u7528</button>'
      + '</div></div>';
  }).join('');
}


// ── Carousel: WYSIWYG Editor ──

var _carouselPages = [];
var _carouselSessionId = '';
var _carouselTemplates = [];
var _carouselPalettes = [];
var _carouselLayoutTypes = [];

(async function initCarouselTemplates() {
  try {
    var res = await apiCall('/api/carousel-templates', null, 'GET');
    if (!res) return;
    _carouselTemplates = res.templates || [];
    _carouselPalettes = res.palettes || [];
    _carouselLayoutTypes = res.layout_types || [];

    var tplSel = document.getElementById('carouselTemplateSelect');
    if (tplSel) {
      tplSel.innerHTML = _carouselTemplates.map(function(t) {
        return '<option value="' + t.id + '"' + (t.id === 'editorial_serif_wash' ? ' selected' : '') + '>' + t.name + '</option>';
      }).join('');
    }
    var palSel = document.getElementById('carouselPaletteSelect');
    if (palSel) {
      palSel.innerHTML = '<option value="">自動</option>' + _carouselPalettes.map(function(p) {
        return '<option value="' + p.id + '">' + p.name + '</option>';
      }).join('');
      palSel.addEventListener('change', function() { _updatePalettePreview(this.value); });
    }
  } catch(e) {}
})();

function _updatePalettePreview(palId) {
  var dots = document.getElementById('palettePreviewDots');
  if (!dots) return;
  var pal = _carouselPalettes.find(function(p) { return p.id === palId; });
  if (!pal || !pal.colors) { dots.innerHTML = ''; return; }
  dots.innerHTML = pal.colors.slice(0, 5).map(function(c) {
    return '<span class="palette-dot" style="background:' + c + '"></span>';
  }).join('') + '<span class="palette-dot" style="background:' + pal.accent + ';border-width:2px;"></span>';
}

function _parseSplitResult(text) {
  var pages = [];
  var blocks = text.split(/【第\s*(\d+)\s*頁】/);
  for (var i = 1; i < blocks.length; i += 2) {
    var num = parseInt(blocks[i]);
    var body = (blocks[i + 1] || '').trim();
    var title = '', content = '';
    var titleMatch = body.match(/標題[：:]\s*(.+)/);
    if (titleMatch) {
      title = titleMatch[1].trim();
      var afterTitle = body.substring(body.indexOf(titleMatch[0]) + titleMatch[0].length).trim();
      var contentMatch = afterTitle.match(/內容[：:]\s*([\s\S]*)/);
      content = contentMatch ? contentMatch[1].trim() : afterTitle.replace(/^封面\s*/, '').trim();
    } else {
      var lines = body.split('\n').filter(function(l) { return l.trim(); });
      title = (lines[0] || '').replace(/^封面\s*/, '').trim();
      content = lines.slice(1).join('\n').trim();
    }
    var type = 'narrative';
    if (num === 1) type = 'cover';
    pages.push({ page: num, type: type, title: title, content: content });
  }
  if (pages.length > 0) {
    pages[pages.length - 1].type = 'closing';
  }
  return pages;
}

function _renderPageCards() {
  var list = document.getElementById('carouselPageList');
  if (!list) return;
  var layoutOpts = (_carouselLayoutTypes.length ? _carouselLayoutTypes : [
    {id:'cover',name:'封面',icon:'🎨'},{id:'narrative',name:'敘述型',icon:'📝'},
    {id:'step_flow',name:'流程型',icon:'🔢'},{id:'bazi_compare',name:'對比型',icon:'⚖️'},
    {id:'closing',name:'收尾頁',icon:'🎯'}
  ]);

  list.innerHTML = _carouselPages.map(function(pg, idx) {
    var optionsHtml = layoutOpts.map(function(lt) {
      return '<option value="' + lt.id + '"' + (pg.type === lt.id ? ' selected' : '') + '>' + lt.icon + ' ' + lt.name + '</option>';
    }).join('');

    return '<div class="carousel-page-card" draggable="true" data-idx="' + idx + '">'
      + '<div class="carousel-page-card-header">'
      +   '<span class="carousel-drag-handle">⋮⋮</span>'
      +   '<span class="carousel-page-num">' + (idx + 1) + '</span>'
      +   '<select class="carousel-layout-select" data-idx="' + idx + '">' + optionsHtml + '</select>'
      +   '<div class="carousel-page-actions">'
      +     (idx > 0 ? '<button title="上移" data-action="up" data-idx="' + idx + '">↑</button>' : '')
      +     (idx < _carouselPages.length - 1 ? '<button title="下移" data-action="down" data-idx="' + idx + '">↓</button>' : '')
      +     '<button title="複製" data-action="dup" data-idx="' + idx + '">📋</button>'
      +     '<button class="delete-page" title="刪除" data-action="del" data-idx="' + idx + '">✕</button>'
      +   '</div>'
      + '</div>'
      + '<div class="carousel-page-card-body">'
      +   '<input class="carousel-editable-title" data-idx="' + idx + '" data-field="title" value="' + (pg.title || '').replace(/"/g, '&quot;') + '" placeholder="標題（≤ 8 字）">'
      +   '<textarea class="carousel-editable-content" data-idx="' + idx + '" data-field="content" placeholder="' + (pg.type === 'cover' ? '封面通常不需要內容' : '頁面內容') + '">' + (pg.content || '') + '</textarea>'
      + '</div></div>';
  }).join('');

  var countEl = document.getElementById('carouselPageCount');
  if (countEl) countEl.textContent = _carouselPages.length + ' 頁';

  _bindPageCardEvents();
}

function _bindPageCardEvents() {
  document.querySelectorAll('.carousel-layout-select').forEach(function(sel) {
    sel.addEventListener('change', function() {
      var idx = parseInt(this.dataset.idx);
      if (_carouselPages[idx]) _carouselPages[idx].type = this.value;
    });
  });
  document.querySelectorAll('.carousel-editable-title').forEach(function(inp) {
    inp.addEventListener('input', function() {
      var idx = parseInt(this.dataset.idx);
      if (_carouselPages[idx]) _carouselPages[idx].title = this.value;
    });
  });
  document.querySelectorAll('.carousel-editable-content').forEach(function(ta) {
    ta.addEventListener('input', function() {
      var idx = parseInt(this.dataset.idx);
      if (_carouselPages[idx]) _carouselPages[idx].content = this.value;
      this.style.height = 'auto';
      this.style.height = this.scrollHeight + 'px';
    });
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  });
  document.querySelectorAll('.carousel-page-actions button').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var idx = parseInt(this.dataset.idx);
      var action = this.dataset.action;
      if (action === 'up' && idx > 0) {
        var tmp = _carouselPages[idx];
        _carouselPages[idx] = _carouselPages[idx - 1];
        _carouselPages[idx - 1] = tmp;
      } else if (action === 'down' && idx < _carouselPages.length - 1) {
        var tmp2 = _carouselPages[idx];
        _carouselPages[idx] = _carouselPages[idx + 1];
        _carouselPages[idx + 1] = tmp2;
      } else if (action === 'dup') {
        _carouselPages.splice(idx + 1, 0, JSON.parse(JSON.stringify(_carouselPages[idx])));
      } else if (action === 'del' && _carouselPages.length > 1) {
        _carouselPages.splice(idx, 1);
      }
      _renumberPages();
      _renderPageCards();
    });
  });

  // drag & drop
  var cards = document.querySelectorAll('.carousel-page-card');
  var dragIdx = null;
  cards.forEach(function(card) {
    card.addEventListener('dragstart', function(e) {
      dragIdx = parseInt(this.dataset.idx);
      this.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', function() {
      this.classList.remove('dragging');
      dragIdx = null;
    });
    card.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    card.addEventListener('drop', function(e) {
      e.preventDefault();
      var dropIdx = parseInt(this.dataset.idx);
      if (dragIdx !== null && dragIdx !== dropIdx) {
        var item = _carouselPages.splice(dragIdx, 1)[0];
        _carouselPages.splice(dropIdx, 0, item);
        _renumberPages();
        _renderPageCards();
      }
    });
  });
}

function _renumberPages() {
  _carouselPages.forEach(function(pg, i) { pg.page = i + 1; });
}

// AI 拆頁按鈕
document.getElementById('generateCarouselBtn').addEventListener('click', async function() {
  var text = document.getElementById('carouselInput').value.trim();
  if (!text) { document.getElementById('carouselInput').focus(); return; }

  var btn = this;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span><span>AI 拆頁中...</span>';

  var splitResult = null;
  try {
    splitResult = await apiCall('/api/carousel-split', { text: text });
  } catch(e) {}

  if (!splitResult || !splitResult.split_result) {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">📱</span><span>AI 拆頁</span>';
    alert('拆頁失敗，請稍後重試');
    return;
  }

  _carouselSessionId = splitResult.session_id;
  _carouselPages = _parseSplitResult(splitResult.split_result);

  if (_carouselPages.length === 0) {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">📱</span><span>AI 拆頁</span>';
    alert('無法解析拆頁結果，請調整文案後重試');
    return;
  }

  // AI 版面分析
  btn.innerHTML = '<span class="btn-icon">⏳</span><span>版面分析中...</span>';
  try {
    var layoutResult = await apiCall('/api/carousel-layout', {
      session_id: _carouselSessionId,
      carousel_text: splitResult.split_result,
    });
    if (layoutResult && layoutResult.pages) {
      layoutResult.pages.forEach(function(lp) {
        var match = _carouselPages.find(function(cp) { return cp.page === lp.page; });
        if (match) {
          match.type = lp.type || match.type;
          if (lp.title) match.title = lp.title;
          if (lp.content) match.content = lp.content;
        }
      });
    }
  } catch(e) {}

  document.getElementById('carouselEditorArea').classList.remove('hidden');
  _renderPageCards();
  document.getElementById('carouselResults').innerHTML = '';
  document.getElementById('carouselResults').classList.add('hidden');

  btn.disabled = false;
  btn.innerHTML = '<span class="btn-icon">📱</span><span>AI 拆頁</span>';
});

// 新增頁面
document.getElementById('carouselAddPageBtn').addEventListener('click', function() {
  _carouselPages.push({
    page: _carouselPages.length + 1,
    type: 'narrative',
    title: '',
    content: '',
  });
  _renderPageCards();
  var list = document.getElementById('carouselPageList');
  if (list && list.lastElementChild) {
    list.lastElementChild.querySelector('.carousel-editable-title').focus();
  }
});

// 重新拆頁
document.getElementById('carouselResetBtn').addEventListener('click', function() {
  document.getElementById('carouselEditorArea').classList.add('hidden');
  _carouselPages = [];
  document.getElementById('carouselInput').focus();
});

// 渲染輪播圖
document.getElementById('carouselRenderBtn').addEventListener('click', async function() {
  if (_carouselPages.length === 0) return;

  var btn = this;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span><span>渲染中...</span>';

  var template = document.getElementById('carouselTemplateSelect').value || 'editorial_serif_wash';
  var palette = document.getElementById('carouselPaletteSelect').value || '';
  var topic = document.getElementById('carouselInput').value.substring(0, 30) || 'carousel';

  _renumberPages();

  var renderResult = null;
  try {
    renderResult = await apiCall('/api/carousel-render', {
      session_id: _carouselSessionId,
      pages: _carouselPages,
      topic: topic,
      template: template,
      palette: palette,
    });
  } catch(e) {}

  var resultsEl = document.getElementById('carouselResults');

  if (renderResult && renderResult.images && renderResult.images.length) {
    var imgHtml = '<div class="flow-step-card">'
      + '<div class="flow-step-header"><span class="flow-step-badge check">渲染完成（' + renderResult.count + ' 頁）</span></div>'
      + '<div class="carousel-preview">';
    renderResult.images.forEach(function(img) {
      imgHtml += '<div class="carousel-preview-page">'
        + '<img src="' + API_BASE + img.url + '" alt="' + img.filename + '">'
        + '<span class="carousel-page-label">' + img.filename + '</span>'
        + '</div>';
    });
    imgHtml += '</div>'
      + '<div class="copy-actions" style="margin-top:12px;">'
      + '<button class="btn btn-primary" onclick="downloadAllCarousel(\'' + _carouselSessionId + '\')">💾 下載全部</button>'
      + '<button class="btn btn-outline" onclick="saveCarouselToNotion(\'' + _carouselSessionId + '\')">📌 存入 Notion</button>'
      + '</div></div>';
    resultsEl.innerHTML = imgHtml;
    resultsEl.classList.remove('hidden');
  } else {
    resultsEl.innerHTML = '<div class="info-box"><p>⚠️ 渲染失敗：' + (renderResult ? renderResult.error || '' : '無回應') + '</p></div>';
    resultsEl.classList.remove('hidden');
  }

  btn.disabled = false;
  btn.innerHTML = '<span class="btn-icon">🖼️</span><span>渲染輪播圖</span>';
});

async function downloadAllCarousel(sessionId) {
  try {
    var result = await apiCall('/api/carousel-render', { session_id: sessionId });
    if (result && result.images) {
      result.images.forEach(function(img, i) {
        setTimeout(function() {
          var a = document.createElement('a');
          a.href = API_BASE + img.url;
          a.download = img.filename;
          a.click();
        }, i * 300);
      });
    }
  } catch(e) { alert('下載失敗'); }
}

async function saveCarouselToNotion(sessionId) {
  var contentParts = _carouselPages.map(function(pg) {
    return '【第 ' + pg.page + ' 頁】' + pg.type + '\n標題：' + pg.title + '\n內容：' + pg.content;
  });
  try {
    await apiCall('/api/save-content', {
      title: '輪播 ' + new Date().toLocaleDateString('zh-TW'),
      content: contentParts.join('\n\n'),
      pillar: currentPillar || '八字',
      status: '輪播待生圖',
      db: 'ig',
    });
    alert('✅ 已存入 Notion');
  } catch(e) { alert('儲存失敗'); }
}


// ── Diagnosis: Mock ──

document.getElementById('diagnoseBtn').addEventListener('click', async () => {
  const input = document.getElementById('diagnosisInput').value.trim();
  const resultsEl = document.getElementById('diagnosisResults');
  if (!input) { document.getElementById('diagnosisInput').focus(); return; }

  const btn = document.getElementById('diagnoseBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">\u23f3</span><span>\u8a3a\u65b7\u4e2d...</span>';
  resultsEl.innerHTML = '<div class="info-box"><p>\u23f3 AI \u6b63\u5728\u5206\u6790\u6587\u6848...</p></div>';
  resultsEl.classList.remove('hidden');

  var result = null;
  try { result = await apiCall('/api/diagnose', { text: input }); } catch(e) {}

  if (result && (result.score !== undefined || result.opening)) {
    var score = result.score || 0;
    var scoreColor = score >= 80 ? 'check-icon-pass' : score >= 50 ? 'check-icon-warn' : 'check-icon-fail';
    resultsEl.innerHTML = '<div class="flow-step-card">'
      + '<div class="flow-step-header"><span class="status-pass"><span class="status-dot"></span> \u6d41\u91cf\u8a3a\u65b7\u5831\u544a</span>'
      + '<span style="font-size:20px;font-weight:700;color:var(--accent);">' + score + '\u5206</span></div>'
      + '<div class="check-item"><span class="check-icon ' + scoreColor + '">\u2713</span><span><strong>\u958b\u982d</strong>\uff1a' + (result.opening || '') + '</span></div>'
      + '<div class="check-item"><span class="check-icon ' + scoreColor + '">\u2713</span><span><strong>\u4e2d\u6bb5</strong>\uff1a' + (result.middle || '') + '</span></div>'
      + '<div class="check-item"><span class="check-icon ' + scoreColor + '">\u2713</span><span><strong>\u7d50\u5c3e</strong>\uff1a' + (result.ending || '') + '</span></div>'
      + '<div class="check-item"><span class="check-icon ' + scoreColor + '">\u2713</span><span><strong>\u6f14\u7b97\u6cd5</strong>\uff1a' + (result.algorithm || '') + '</span></div>'
      + (result.improvements && result.improvements.length ? '<div style="margin-top:8px;"><div class="flow-check-title">\u6539\u5584\u5efa\u8b70</div>' + result.improvements.map(function(s) { return '<div class="check-item"><span class="check-icon check-icon-warn">!</span><span>' + s + '</span></div>'; }).join('') + '</div>' : '')
      + (result.rewrite_hint ? '<div style="margin-top:8px;font-size:13px;color:var(--accent);"><strong>\u6539\u5beb\u65b9\u5411\uff1a</strong>' + result.rewrite_hint + '</div>' : '')
      + '</div>';
  } else {
    resultsEl.innerHTML = '<div class="info-box"><p>\u26a0\ufe0f \u8a3a\u65b7\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u91cd\u8a66</p></div>';
  }
  btn.disabled = false;
  btn.innerHTML = '<span class="btn-icon">\ud83d\udcca</span><span>\u958b\u59cb\u8a3a\u65b7</span>';
});


// ── Weekly Plan ──
document.getElementById('aiWeekPlanBtn')?.addEventListener('click', async function() {
  var btn = this;
  var resultsEl = document.getElementById('weekPlanResults');
  btn.disabled = true;
  btn.innerHTML = '\u23f3 AI \u898f\u5283\u4e2d...';
  resultsEl.classList.remove('hidden');
  resultsEl.innerHTML = '<div class="info-box"><p>\u23f3 AI \u6b63\u5728\u898f\u5283\u672c\u9031\u5167\u5bb9...</p></div>';

  try {
    var result = await apiCall('/api/weekly-plan', { week_start: _dateStr(new Date()) });
    if (result && result.days) {
      var html = '<div class="flow-step-card"><div class="flow-step-header"><span class="flow-step-badge ai">AI \u9031\u898f\u5283</span></div><div class="week-plan-list">';
      result.days.forEach(function(d) {
        html += '<div class="week-plan-item">'
          + '<span class="week-plan-day">' + (d.day || '') + '</span>'
          + '<span class="week-plan-type">' + (d.type || '') + '</span>'
          + '<span class="week-plan-topic">' + (d.topic || '') + '</span>'
          + '<span class="week-plan-form">' + (d.form || '') + '</span>'
          + '</div>';
      });
      html += '</div></div>';
      resultsEl.innerHTML = html;
    } else {
      resultsEl.innerHTML = '<div class="info-box"><p>' + (result ? result.raw || '\u898f\u5283\u5931\u6557' : '\u7121\u56de\u61c9') + '</p></div>';
    }
  } catch(e) {
    resultsEl.innerHTML = '<div class="info-box"><p>\u26a0\ufe0f \u898f\u5283\u5931\u6557\uff1a' + e.message + '</p></div>';
  }
  btn.disabled = false;
  btn.innerHTML = '\ud83e\udd16 AI \u9031\u898f\u5283';
});

// ── Style Learning ──
document.getElementById('styleLearningBtn')?.addEventListener('click', async function() {
  var btn = this;
  var resultsEl = document.getElementById('styleLearningResults');
  btn.disabled = true;
  btn.innerHTML = '\u23f3 \u5206\u6790\u4e2d...';
  resultsEl.classList.remove('hidden');
  resultsEl.innerHTML = '<div class="info-box"><p>\u23f3 \u6b63\u5728\u5206\u6790\u5beb\u4f5c\u98a8\u683c...</p></div>';

  try {
    var result = await apiCall('/api/style-learning', { account: 'jhen_insightlab' });
    if (result && result.summary) {
      var html = '<div class="flow-step-card" style="margin-top:12px;">'
        + '<div class="flow-step-header"><span class="flow-step-badge check">\u6587\u98a8\u5206\u6790\u7d50\u679c</span></div>'
        + '<p style="margin:8px 0;">' + result.summary + '</p>';
      if (result.patterns && result.patterns.length) {
        html += '<div class="flow-check-title">\u5beb\u4f5c\u6a21\u5f0f</div><ul>';
        result.patterns.forEach(function(p) { html += '<li>' + p + '</li>'; });
        html += '</ul>';
      }
      if (result.suggestions && result.suggestions.length) {
        html += '<div class="flow-check-title">\u6539\u5584\u5efa\u8b70</div><ul>';
        result.suggestions.forEach(function(s) { html += '<li>' + s + '</li>'; });
        html += '</ul>';
      }
      html += '</div>';
      resultsEl.innerHTML = html;
    } else {
      resultsEl.innerHTML = '<div class="info-box"><p>' + (result ? result.raw || '\u5206\u6790\u5931\u6557' : '\u7121\u56de\u61c9') + '</p></div>';
    }
  } catch(e) {
    resultsEl.innerHTML = '<div class="info-box"><p>\u26a0\ufe0f ' + e.message + '</p></div>';
  }
  btn.disabled = false;
  btn.innerHTML = '\ud83d\udcca \u6587\u98a8\u5b78\u7fd2';
});


// ── Search: Mock ──

document.getElementById('searchBtn').addEventListener('click', async () => {
  const kw = document.getElementById('searchKeyword').value.trim();
  const resultsEl = document.getElementById('searchResults');
  if (!kw) {
    document.getElementById('searchKeyword').focus();
    return;
  }

  const btn = document.getElementById('searchBtn');
  btn.disabled = true;
  btn.textContent = '搜索中...';

  // Try real API
  let data = null;
  try {
    data = await apiCall('/api/search-threads', { keyword: kw });
  } catch (e) { console.log('Search API error:', e.message); }

  if (data && data.results) {
    const results = data.results;
    const hotCount = results.filter(r => r.likes >= 100).length;

    let html = `
      <div class="stats-bar" style="margin-top:20px;">
        <div class="stat-item">
          <span class="stat-number">${data.count}</span>
          <span class="stat-label">搜索結果</span>
        </div>
        <div class="stat-item">
          <span class="stat-number">${hotCount}</span>
          <span class="stat-label">高互動文</span>
        </div>
      </div>
    `;

    results.forEach((r, i) => {
      const text = (r.text || '').replace(/</g, '&lt;').substring(0, 150);
      const tags = [r.level, r.viral ? '📤出圈' : '', r.high_reply ? '💬高回覆' : ''].filter(Boolean).join(' ');
      html += `
        <div class="result-card${i === 0 ? ' open' : ''}">
          <div class="result-card-header" onclick="this.parentElement.classList.toggle('open')">
            <span class="result-card-num">${i + 1}</span>
            <span class="result-card-title">${tags} @${r.username || '?'} · ${r.likes || 0} 讚</span>
            <span class="result-card-toggle">▼</span>
          </div>
          <div class="result-card-body">
            <div class="result-section">
              <div class="result-section-title">貼文內容</div>
              <div class="result-content">${text}</div>
            </div>
            <div class="result-engagement">
              <span>❤️ ${r.likes || 0}</span><span>💬 ${r.comments || 0}</span><span>🔄 ${r.reposts || 0}</span>
            </div>
          </div>
        </div>
      `;
    });

    resultsEl.innerHTML = html;
  } else {
    // Mock fallback
    await sleep(1000);
    resultsEl.innerHTML = `
      <div class="info-box" style="margin-top:16px;">
        <p>API Server 未運行，無法搜索 Threads。</p>
        <p>請啟動：<code>python3 web/api_server.py</code></p>
      </div>
    `;
  }

  resultsEl.classList.remove('hidden');
  btn.disabled = false;
  btn.textContent = '搜索';
});

// Enter key for search
document.getElementById('searchKeyword').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('searchBtn').click();
});


// ── Matrix: Cell click → jump to copywriter ──

function renderMatrix() {
  var pillarDef = MATRIX_PILLARS[currentMatrixPillar];
  var columns = pillarDef.columns;
  var pillarLabel = pillarDef.label;
  var pillarData = MATRIX_DATA[currentMatrixPillar] || {};
  var data = pillarData[currentBucket] || [];

  // 更新表頭
  var headRow = document.getElementById('matrixHead');
  headRow.innerHTML = '<th class="matrix-corner">\u5f62\u5f0f</th>' + columns.map(function(col) { return '<th>' + col + '</th>'; }).join('');

  // 填入矩陣
  var tbody = document.getElementById('matrixBody');
  tbody.innerHTML = data.map(function(row) {
    return '<tr><td>' + row.form + '</td>' + row.cells.map(function(c, ci) {
      if (c === '\u2014') return '<td class="matrix-empty">\u2014</td>';
      return '<td class="matrix-cell-link" data-pillar="' + pillarLabel + '" data-sub="' + columns[ci] + '" data-form="' + row.form + '" data-idea="' + c.replace(/"/g, '&quot;') + '">' + c + '</td>';
    }).join('') + '</tr>';
  }).join('');

  // 點格子 → 文案頁
  tbody.querySelectorAll('.matrix-cell-link').forEach(function(cell) {
    cell.addEventListener('click', function() {
      switchPage('copywriter');
      document.getElementById('formatSelect').value = cell.dataset.form;
      document.getElementById('selectedPillar').textContent = cell.dataset.pillar + ' \u00b7 ' + cell.dataset.sub;
      document.getElementById('selectedFormatName').textContent = cell.dataset.form;
      document.getElementById('selectedFormat').classList.remove('hidden');
      document.getElementById('copywriterInput').value = cell.dataset.idea.replace(/[\u300c\u300d]/g, '');
    });
  });
}
