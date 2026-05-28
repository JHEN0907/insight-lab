FROM python:3.11-slim

# 安裝 Playwright 系統依賴 + 中文字體
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libatspi2.0-0 libxshmfence1 \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install chromium

COPY . .

# Threads 登入 session（讓爬蟲能抓 8-10 篇而非 3-5 篇）
RUN if [ -d ".threads-session/Default" ]; then \
    mkdir -p /root/.threads-session/Default && \
    cp -r .threads-session/Default/* /root/.threads-session/Default/; \
    fi

ENV PORT=8080
EXPOSE 8080

CMD ["python", "api_server.py"]
