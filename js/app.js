/**
 * Insight Lab — 內容創作工作台
 * 前端邏輯：頁面導航 + 各功能頁面
 */

const API_BASE = window.location.protocol === 'file:'
  ? 'http://localhost:5050'
  : window.location.origin;

async function apiCall(endpoint, body) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
      return null; // server not running, use mock
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

  // Try real API first
  let result = null;
  try {
    result = await apiCall('/api/analyze-viral', { text: input, images: [] });
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
    // Convert mock format
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
      })),
    };
  }

  // Complete loading
  loadingBar.style.width = '100%';
  await sleep(300);
  loadingState.classList.add('hidden');

  // Normalize field names (API uses snake_case)
  const analyses = (result.analyses || []).map(a => ({
    author: a.author || '分析結果',
    hookType: a.hook_type || a.hookType || '—',
    hookFormula: a.hook_formula || a.hookFormula || '—',
    similarHooks: a.similar_hooks || a.similarHooks || [],
    whyViral: a.why_viral || a.whyViral || '—',
    likes: a.likes || '—', comments: a.comments || '—',
    reposts: a.reposts || '—', shares: a.shares || '—',
    templates: a.templates || [],
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
  resultsArea.innerHTML = analyses.map((a, i) => `
    <div class="result-card${i === 0 ? ' open' : ''}">
      <div class="result-card-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="result-card-num">${i + 1}</span>
        <span class="result-card-title">${a.author}</span>
        <span class="result-card-toggle">▼</span>
      </div>
      <div class="result-card-body">
        ${a.url ? `<div class="result-section">
          <div class="result-section-title">原文文章連結</div>
          <div class="result-content"><a href="${a.url}" target="_blank">${a.url}</a></div>
        </div>` : ''}

        <div class="result-section">
          <div class="result-section-title">HOOK 開頭公式拆解</div>
          <div class="result-content">
            <ol>
              <li><strong>這是什麼樣的開頭：</strong>${a.hookType}</li>
              <li><strong>開頭公式拆解：</strong>${a.hookFormula}</li>
              <li><strong>舉幾個類似的句子：</strong>
                <ul>${a.similarHooks.map(h => `<li>${h}</li>`).join('')}</ul>
              </li>
              <li><strong>一句話解釋為什麼會紅：</strong>${a.whyViral}</li>
            </ol>
          </div>
        </div>

        <div class="result-section">
          <div class="result-section-title">互動數據</div>
          <div class="result-engagement">
            <span>❤️ ${a.likes || '未提供'}</span>
            <span>💬 ${a.comments || '未提供'}</span>
            <span>🔄 ${a.reposts || '未提供'}</span>
            <span>📤 ${a.shares || '未提供'}</span>
          </div>
        </div>

        <div class="result-section">
          <div class="result-section-title">可直接套用格式</div>
          <div class="result-content">
            <ol>${a.templates.map(t => `<li>${t}</li>`).join('')}</ol>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

function generateMockAnalysis(input) {
  // Parse rough post count from input
  const lines = input.split('\n').filter(l => l.trim());
  const postCount = Math.max(1, Math.floor(lines.length / 3));

  return {
    totalPosts: postCount,
    analyses: [{
      author: '示範帖文分析',
      url: '',
      hookType: '情境代入型 + 痛點呼喚型',
      hookFormula: '描述讀者日常場景的痛點 + 帶出專業身份的衝突感',
      similarHooks: [
        '你是不是總覺得，另一半怎麼都不懂你在氣什麼？',
        '每次吵完架，你是不是那個先道歉的人？',
        '為什麼你的感情總是走到同一個死胡同？',
      ],
      whyViral: '用日常感情場景讓 25-38 歲女性瞬間對號入座，產生「這不就是我嗎」的強烈共鳴',
      likes: '—',
      comments: '—',
      reposts: '—',
      shares: '—',
      templates: [
        '[用你的領域開頭：描述一個具體的感情/人際場景]',
        '[點出痛點：「不是不愛，是...」的翻轉句]',
        '[帶入專業概念（八字/十神/牌卡），自然不生硬]',
        '[具體可執行的建議 1]',
        '[具體可執行的建議 2]',
        '[具體可執行的建議 3]',
        '[餘韻結尾：引發反思的一句話]',
      ],
    }],
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

const MATRIX_DATA = {
  sunflower: [
    { form: '⭐ 極短金句', star: true, cells: [
      '「夫妻宮不好不代表感情差——那只是你的慣性起點」',
      '「塔羅不是算命，是照鏡子」',
      '「改運最快的方法，是改掉你的自動反應」'
    ]},
    { form: '⭐ 比喻降維', star: true, cells: [
      '「八字就像使用說明書——為什麼不看自己的？」',
      '「塔羅就像照鏡子——看到了才知道調什麼」',
      '「覺察就像 GPS 重新定位——你不是迷路，是忘記開導航」'
    ]},
    { form: '⭐ 提問互動', star: true, cells: [
      '「你聽過最離譜的八字說法？我先來」',
      '「你抽到哪張牌後整個人愣住？」',
      '「學了覺察後最震撼的發現？我先來」'
    ]},
    { form: '⭐ 時事蹭流', star: true, cells: [
      '「看完 [熱門劇] 我發現男主根本是七殺配印」',
      '「[節氣] 抽一張牌問自己一個問題」',
      '「[熱門事件] 背後的慣性模式」'
    ]},
    { form: '十神×場景', cells: ['「食神的人最受不了參加不喜歡的應酬」', '—', '—'] },
    { form: '⭐ 勸告型', star: true, cells: ['「勸你不要測試命盤帶印星的人」', '—', '—'] },
    { form: '⭐ 正面對號入座', star: true, cells: [
      '「越來越有錢的女命——你中了幾個」',
      '—',
      '「天生覺察力很強的人，通常有這 5 個特徵」'
    ]},
    { form: '破解迷思', cells: [
      '「夫妻宮坐比劫就注定離婚？才不是」',
      '「塔羅重複問同個問題真的會不準嗎？」',
      '「改運不是燒香拜拜——是改掉重複的選擇」'
    ]},
    { form: '反向教學', cells: [
      '「想感情一直爛？就做這 3 件事」',
      '「想讓塔羅越算越不準？這 5 個錯誤繼續犯」',
      '「想一直困在原地？重複你一直做的事就好」'
    ]},
    { form: '⭐ 盤點型', star: true, cells: [
      '「盤點那些八字老師不會告訴你的事」',
      '「盤點塔羅新手最常犯的 5 個錯」',
      '「盤點那些學了覺察後才懂的事」'
    ]},
    { form: '⭐ 種草/推薦型', star: true, cells: [
      '「拜託不要去算八字，算了就回不去了」',
      '「拜託不要學塔羅，學了就停不下來」',
      '「拜託不要開始覺察，開始了就無法假裝沒看到」'
    ]},
  ],
  succulent: [
    { form: '⭐ 恐懼+攻略', star: true, cells: [
      '「[恐懼的八字組合]——如何化解」',
      '「牌陣出現這 3 張要注意——化解方法在這」',
      '「你以為的改運方法，可能在加速消耗」'
    ]},
    { form: '⭐ 排名/頂級', star: true, cells: ['「八字中最 OP 的日柱組合」', '—', '—'] },
    { form: '⭐ N步驟教學', star: true, cells: [
      '「3 步驟看懂你的命盤感情區」',
      '「塔羅自學 5 步驟入門」',
      '「正念覺察入門 3 步驟」'
    ]},
    { form: '⭐ 清單型', star: true, cells: [
      '「我最常用的 5 個八字快速判斷法」',
      '「新手必學的 10 張大牌含義」',
      '「6 個覺察小練習」'
    ]},
    { form: '⭐ 對比拆解', star: true, cells: [
      '「正官 vs 七殺——差在哪？」',
      '「正位 vs 逆位到底差多少？」',
      '「冥想 vs 覺察——不一樣的」'
    ]},
    { form: '連續N天', cells: ['「Day 1/7：十神日常觀察」', '—', '「Day 1/7：覺察日記」'] },
    { form: '⭐ 痛點解方型', star: true, cells: [
      '「命盤裡最讓人崩潰的組合——3 步解法」',
      '「抽到塔牌別慌——這樣理解就對了」',
      '「覺察後更痛苦？因為你少了這一步」'
    ]},
  ],
  pine: [
    { form: '⭐ 自嘲翻轉', star: true, cells: [
      '「八字老師教你挽回感情——答案出乎意料」',
      '—',
      '「正念老師焦慮的時候怎麼辦？」'
    ]},
    { form: '看劇說八字', cells: ['「[角色] 那個決定，就是七殺的典型」', '—', '—'] },
    { form: '⭐ 深度觀點', star: true, cells: [
      '「我花了 3 個月研究食神，發現...」',
      '「為什麼我不做大眾占卜了」',
      '「改運的本質是什麼？我的觀察」'
    ]},
    { form: '⭐ 故事翻轉', star: true, cells: [
      '「那天看完客戶的命盤，我沉默了」',
      '「塔羅翻出死神牌那一刻」',
      '「覺察讓我失去了一段友情」'
    ]},
    { form: '⭐ 真實分享', star: true, cells: [
      '「剛剛看完一個命盤，整個人愣住」',
      '「今天幫人解牌，她哭了」',
      '「學覺察三個月，我第一次對自己誠實」'
    ]},
    { form: '⭐ 成果展示', star: true, cells: [
      '「學八字 3 個月，幫了 20 個人看懂自己」',
      '「這副牌跟了我 2 年，解了 300+ 個問題」',
      '「覺察練習 100 天後的 5 個改變」'
    ]},
    { form: '⭐ 曬收藏/互動', star: true, cells: [
      '「大家第一次算命是幾歲？我先說」',
      '「你的命定塔羅牌是哪張？留言讓我看」',
      '「學覺察的契機是什麼？好奇大家的故事」'
    ]},
  ],
};

// Bucket tab click
document.querySelectorAll('.bucket-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.bucket-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderMatrix(tab.dataset.bucket);
  });
});

// Initial render
renderMatrix('sunflower');


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

function renderWeek() {
  const grid = document.getElementById('weekGrid');
  const label = document.getElementById('weekLabel');
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);

  const endSun = new Date(monday);
  endSun.setDate(monday.getDate() + 6);
  label.textContent = `${monday.getMonth()+1}/${monday.getDate()} — ${endSun.getMonth()+1}/${endSun.getDate()}`;

  grid.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const isToday = d.toDateString() === now.toDateString();
    const dow = d.getDay();
    const hint = SCHEDULE_HINTS[dow] || {};
    grid.innerHTML += `
      <div class="day-card${isToday ? ' today' : ''}">
        <div class="day-card-header">
          <span class="day-name">週${DAYS[dow]}</span>
          <span class="day-date">${d.getDate()}</span>
        </div>
        ${hint.label ? `<span class="day-bucket ${hint.cls}">${hint.bucket} ${hint.label}</span>` : ''}
        <div class="day-content" style="margin-top:8px;font-size:11px;color:var(--text-muted);">尚未排文</div>
      </div>
    `;
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

function renderTrending(filter) {
  const list = document.getElementById('trendingList');
  const filtered = filter === 'all' ? TRENDING_DATA
    : filter === 'uploaded' ? []
    : TRENDING_DATA.filter(t => t.cat === filter);

  if (!filtered.length) {
    list.innerHTML = '<div class="info-box"><p>這個分類還沒有資料</p></div>';
    return;
  }
  list.innerHTML = filtered.map(t => `
    <div class="trending-card">
      <div class="trending-header">
        <span class="trending-level">${t.level}</span>
        <span class="trending-likes">❤️ ${t.likes.toLocaleString()}</span>
        <span class="trending-engagement">💬 ${t.comments || 0} 🔄 ${t.reposts || 0}</span>
      </div>
      <p class="trending-text">${t.text}</p>
      <div class="trending-meta">
        <span>${t.domain}</span>
        <span>${t.form}</span>
      </div>
      <div class="trending-analysis">
        <div class="trending-analysis-row">
          <span class="trending-analysis-label">Hook 分析</span>
          <span>${t.hook}</span>
        </div>
        <div class="trending-analysis-row">
          <span class="trending-analysis-label">為什麼爆</span>
          <span>${t.why}</span>
        </div>
        <div class="trending-analysis-row">
          <span class="trending-analysis-label">套到八字</span>
          <span>${t.apply}</span>
        </div>
      </div>
      <div class="trending-actions">
        <button class="btn btn-outline btn-sm" onclick="switchPage('copywriter');document.getElementById('copywriterInput').value='${t.apply.replace(/'/g, "\\'")}'"">→ 套用這個形式</button>
      </div>
    </div>
  `).join('');
}

document.querySelectorAll('[data-filter]').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderTrending(tab.dataset.filter);
  });
});

renderTrending('all');


document.getElementById('weekPrev').addEventListener('click', () => { weekOffset--; renderWeek(); });


// ── Inspiration: Save + List ──

let inspirations = JSON.parse(localStorage.getItem('inspirations') || '[]');

document.querySelectorAll('.insp-tag').forEach(tag => {
  tag.addEventListener('click', () => {
    document.querySelectorAll('.insp-tag').forEach(t => t.classList.remove('active'));
    tag.classList.add('active');
  });
});

document.getElementById('saveInspirationBtn').addEventListener('click', () => {
  const text = document.getElementById('inspirationInput').value.trim();
  if (!text) return;
  const tag = document.querySelector('.insp-tag.active')?.dataset.tag || '未分類';
  const item = { text, tag, date: new Date().toLocaleDateString('zh-TW'), id: Date.now() };
  inspirations.unshift(item);
  localStorage.setItem('inspirations', JSON.stringify(inspirations));
  document.getElementById('inspirationInput').value = '';
  renderInspirations();
});

function renderInspirations() {
  const list = document.getElementById('inspirationList');
  if (!inspirations.length) {
    list.innerHTML = '<div class="info-box"><p>儲存的靈感會顯示在這裡</p></div>';
    return;
  }
  list.innerHTML = inspirations.map(item => `
    <div class="insp-item">
      <div>
        <span class="insp-item-tag">${item.tag}</span>
        <span class="insp-item-meta">${item.date}</span>
        <div class="insp-item-text">${item.text.substring(0, 100)}</div>
        <div class="insp-item-actions">
          <button class="btn btn-outline btn-sm" onclick="useInspiration('${item.text.replace(/'/g, "\\'")}')">→ 生成文案</button>
        </div>
      </div>
    </div>
  `).join('');
}

function useInspiration(text) {
  switchPage('copywriter');
  document.getElementById('copywriterInput').value = text;
}

renderInspirations();
document.getElementById('weekNext').addEventListener('click', () => { weekOffset++; renderWeek(); });
renderWeek();


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

document.getElementById('generateCopyBtn').addEventListener('click', async () => {
  const pillar = document.querySelector('#pillarPills .pill.active')?.dataset.value || '八字';
  const format = document.getElementById('formatSelect').value;
  const topic = document.getElementById('copywriterInput').value.trim();
  const resultsEl = document.getElementById('copywriterResults');

  const btn = document.getElementById('generateCopyBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span><span>生成中...</span>';

  // Try real API
  let copy = '', techniques = [], hookType = '';
  let apiResult = null;
  try {
    apiResult = await apiCall('/api/generate-copy', { pillar, format, topic });
  } catch (e) { console.log('API error:', e.message); }

  if (apiResult && apiResult.copy) {
    copy = apiResult.copy;
    techniques = apiResult.techniques_used || [];
    hookType = apiResult.hook_type || '';
  } else {
    // Fallback mock
    await sleep(1500);
    const pillarCopies = MOCK_COPIES[pillar] || MOCK_COPIES['八字'];
    copy = pillarCopies[format] || pillarCopies['default'] || MOCK_COPIES['八字']['default'];
    techniques = ['震撼亮點前移', '極致壓縮句型', '餘韻設計'];
  }

  resultsEl.innerHTML = `
    <div class="result-card open">
      <div class="result-card-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="result-card-num">1</span>
        <span class="result-card-title">${pillar} · ${format}${topic ? ' · ' + topic : ''}</span>
        <span class="result-card-toggle">▼</span>
      </div>
      <div class="result-card-body">
        <div class="result-section">
          <div class="result-section-title">生成文案</div>
          <div class="result-content copy-output">${copy.replace(/\n/g, '<br>')}</div>
        </div>
        <div class="result-section">
          <div class="result-section-title">套用技巧</div>
          <div class="result-content">
            <ul>${techniques.map(t => `<li>${t}</li>`).join('')}</ul>
          </div>
        </div>
        <div class="copy-actions">
          <button class="btn btn-primary btn-copy" onclick="navigator.clipboard.writeText(this.closest('.result-card').querySelector('.copy-output').innerText);this.innerHTML='✅ 已複製';setTimeout(()=>this.innerHTML='📋 複製文案',1500)">📋 複製文案</button>
        </div>
      </div>
    </div>
  `;
  resultsEl.classList.remove('hidden');
  btn.disabled = false;
  btn.innerHTML = '<span class="btn-icon">✨</span><span>生成文案</span>';
});


// ── Diagnosis: Mock ──

document.getElementById('diagnoseBtn').addEventListener('click', async () => {
  const input = document.getElementById('diagnosisInput').value.trim();
  const resultsEl = document.getElementById('diagnosisResults');
  if (!input) {
    document.getElementById('diagnosisInput').focus();
    return;
  }

  const btn = document.getElementById('diagnoseBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span><span>診斷中...</span>';
  await sleep(2000 + Math.random() * 1000);

  resultsEl.innerHTML = `
    <div class="result-card open">
      <div class="result-card-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="result-card-num">1</span>
        <span class="result-card-title">流量診斷報告</span>
        <span class="result-card-toggle">▼</span>
      </div>
      <div class="result-card-body">
        <div class="result-section">
          <div class="result-section-title">表現分析</div>
          <div class="result-content">
            <p><strong>開頭評分：</strong>Hook 有痛點呼喚，但可以更具體化。建議把最亮的金句移到第一行。</p>
            <p><strong>中段結構：</strong>資訊密度適中，但缺少情境帶入感。可以加入日常場景描述。</p>
            <p><strong>結尾設計：</strong>CTA 過於制式（「歡迎留言」），建議改為餘韻金句引發反思。</p>
          </div>
        </div>
        <div class="result-section">
          <div class="result-section-title">改善建議</div>
          <div class="result-content">
            <ol>
              <li>震撼亮點前移 — 掃描全文最有力的句子，直接搬到開頭</li>
              <li>里長伯報好康 — 把知識包裝成「攻略/情報」，讓讀者覺得不看會虧</li>
              <li>消滅 AI 感 — emoji 最多 1 個，刪除多餘括號</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  `;
  resultsEl.classList.remove('hidden');
  btn.disabled = false;
  btn.innerHTML = '<span class="btn-icon">📊</span><span>開始診斷</span>';
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

function renderMatrix(bucket) {
  const tbody = document.getElementById('matrixBody');
  const data = MATRIX_DATA[bucket] || [];
  const PILLARS = ['八字', '塔羅占卜', '覺察修行'];
  tbody.innerHTML = data.map(row => {
    const formName = row.form.replace(/^⭐\s*/, '');
    return `<tr>
      <td>${row.form}</td>
      ${row.cells.map((c, ci) => {
        if (c === '—') return `<td class="matrix-empty">—</td>`;
        return `<td class="matrix-cell-link" data-pillar="${PILLARS[ci]}" data-form="${formName}" data-idea="${c}">${c}</td>`;
      }).join('')}
    </tr>`;
  }).join('');

  // Add click handlers — matrix cell → copywriter
  tbody.querySelectorAll('.matrix-cell-link').forEach(cell => {
    cell.addEventListener('click', () => {
      const pillar = cell.dataset.pillar;
      const form = cell.dataset.form;
      const idea = cell.dataset.idea;
      // Switch to copywriter page
      switchPage('copywriter');
      // Set hidden pillar
      document.querySelectorAll('#pillarPills .pill').forEach(p => {
        p.classList.toggle('active', p.dataset.value === pillar);
      });
      // Set hidden format
      document.getElementById('formatSelect').value = form;
      // Show selected format badge
      document.getElementById('selectedPillar').textContent = pillar;
      document.getElementById('selectedFormatName').textContent = form;
      document.getElementById('selectedFormat').classList.remove('hidden');
      document.getElementById('matrixCta').classList.add('hidden');
      // Set topic
      document.getElementById('copywriterInput').value = idea.replace(/[「」]/g, '');
    });
  });
}
