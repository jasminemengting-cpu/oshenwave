#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Threads 留言抽獎程式
====================
1. 用瀏覽器開啟 Threads 貼文，自動往下捲動，抓取所有留言
2. 存成 CSV（可用 Excel 開啟核對）
3. 依規則篩選資格，公平隨機抽出得獎者

安裝：
    pip install playwright
    playwright install chromium

用法範例：
    # 第一次先登入（登入狀態會保存，之後不用再登）
    python threads_lottery.py --login

    # 抓留言並抽 3 位，每人限中一次、排除貼文作者、須標註 2 位朋友
    python threads_lottery.py "https://www.threads.com/@帳號/post/XXXXXX" -n 3 --min-tags 2

    # 已經抓過留言，直接用 CSV 重抽
    python threads_lottery.py --from-csv comments.csv -n 3
"""

import argparse
import asyncio
import csv
import json
import re
import secrets
import random
import sys
from datetime import datetime
from pathlib import Path

PROFILE_DIR = Path(__file__).with_name(".threads_profile")


# ----------------------------------------------------------------------
# 從 Threads 回傳的 JSON 中找出貼文/留言
# ----------------------------------------------------------------------
def iter_posts(obj):
    """遞迴尋找看起來像貼文的物件（有 pk、user.username、caption）。"""
    stack = [obj]
    while stack:
        o = stack.pop()
        if isinstance(o, dict):
            user = o.get("user")
            if "pk" in o and isinstance(user, dict) and "username" in user and "caption" in o:
                yield o
            stack.extend(o.values())
        elif isinstance(o, list):
            stack.extend(o)


def parse_post(o):
    cap = o.get("caption")
    text = cap.get("text", "") if isinstance(cap, dict) else ""
    info = o.get("text_post_app_info") or {}
    reply_to = (info.get("reply_to_author") or {}).get("username", "")
    ts = o.get("taken_at")
    username = o["user"]["username"]
    code = o.get("code") or ""
    return {
        "id": str(o.get("pk")),
        "code": code,
        "username": username,
        "text": text.replace("\r", " ").strip(),
        "reply_to": reply_to,
        "time": datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S") if ts else "",
        "url": f"https://www.threads.com/@{username}/post/{code}" if code else "",
    }


def loads_loose(text):
    """Threads 的回應有時有前綴或多行 JSON，盡量都解析出來。"""
    text = text.strip()
    if text.startswith("for (;;);"):
        text = text[len("for (;;);"):]
    try:
        yield json.loads(text)
        return
    except Exception:
        pass
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("{") or line.startswith("["):
            try:
                yield json.loads(line)
            except Exception:
                pass


# ----------------------------------------------------------------------
# 抓取
# ----------------------------------------------------------------------
async def scrape(url, max_scrolls=300, idle_rounds=6, headless=False):
    from playwright.async_api import async_playwright

    m = re.search(r"/post/([A-Za-z0-9_-]+)", url)
    if not m:
        sys.exit("網址格式不對，應該像 https://www.threads.com/@帳號/post/XXXXXX")
    main_code = m.group(1)

    found = {}
    pending = []

    def ingest(data):
        for o in iter_posts(data):
            try:
                p = parse_post(o)
            except Exception:
                continue
            found.setdefault(p["id"], p)

    async def on_response(resp):
        if "graphql" not in resp.url and "/api/" not in resp.url:
            return
        try:
            body = await resp.text()
        except Exception:
            return
        for d in loads_loose(body):
            ingest(d)

    async with async_playwright() as pw:
        ctx = await pw.chromium.launch_persistent_context(
            str(PROFILE_DIR), headless=headless, locale="zh-TW",
            viewport={"width": 1100, "height": 900},
        )
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        page.on("response", lambda r: pending.append(asyncio.ensure_future(on_response(r))))

        print(f"開啟貼文：{url}")
        await page.goto(url, wait_until="domcontentloaded")
        await page.wait_for_timeout(4000)

        async def read_embedded():
            scripts = await page.eval_on_selector_all(
                'script[type="application/json"]', "els => els.map(e => e.textContent)"
            )
            for s in scripts:
                for d in loads_loose(s or ""):
                    ingest(d)

        await read_embedded()

        last, idle = -1, 0
        for i in range(max_scrolls):
            await page.mouse.wheel(0, 4000)
            await page.wait_for_timeout(1500)
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
                pending.clear()
            if i % 5 == 0:
                await read_embedded()
            n = len(found)
            print(f"\r捲動 {i + 1} 次，目前抓到 {n} 則", end="", flush=True)
            if n == last:
                idle += 1
                if idle >= idle_rounds:
                    break
            else:
                idle, last = 0, n
        print()
        await read_embedded()
        await ctx.close()

    posts = list(found.values())
    main = next((p for p in posts if p["code"] == main_code), None)
    author = main["username"] if main else ""
    replies = [p for p in posts if p["code"] != main_code]
    # 有回覆對象資訊時，只保留真的回覆（排除頁面上推薦的其他貼文）
    if any(p["reply_to"] for p in replies):
        replies = [p for p in replies if p["reply_to"]]
    replies.sort(key=lambda p: p["time"])
    return author, replies


def login():
    async def run():
        from playwright.async_api import async_playwright
        async with async_playwright() as pw:
            ctx = await pw.chromium.launch_persistent_context(str(PROFILE_DIR), headless=False, locale="zh-TW")
            page = ctx.pages[0] if ctx.pages else await ctx.new_page()
            await page.goto("https://www.threads.com/login")
            print("請在跳出的瀏覽器視窗登入 Threads，登入完成後回到這裡按 Enter。")
            await asyncio.get_event_loop().run_in_executor(None, input)
            await ctx.close()
            print("登入狀態已保存。")
    asyncio.run(run())


# ----------------------------------------------------------------------
# CSV
# ----------------------------------------------------------------------
FIELDS = ["username", "text", "time", "reply_to", "url", "id", "code"]


def save_csv(rows, path):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def load_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


# ----------------------------------------------------------------------
# 抽獎
# ----------------------------------------------------------------------
def filter_eligible(rows, args, author):
    exclude = {u.lower().lstrip("@") for u in (args.exclude or [])}
    if author and not args.include_author:
        exclude.add(author.lower())
    keywords = args.keyword or []
    deadline = args.before

    out, reasons = [], {}
    def reject(r, why):
        reasons[why] = reasons.get(why, 0) + 1

    for r in rows:
        u = r["username"].lower()
        text = r.get("text", "")
        if u in exclude:
            reject(r, "排除名單/作者"); continue
        if deadline and r.get("time") and r["time"] > deadline:
            reject(r, "超過截止時間"); continue
        if keywords:
            hit = [k for k in keywords if k.lower() in text.lower()]
            if (args.all_keywords and len(hit) < len(keywords)) or not hit:
                reject(r, "未含關鍵字"); continue
        if args.min_tags:
            tags = {t.lower() for t in re.findall(r"@([A-Za-z0-9_.]+)", text)} - {u}
            if len(tags) < args.min_tags:
                reject(r, f"標註少於 {args.min_tags} 人"); continue
        out.append(r)

    if not args.allow_multi:
        seen, uniq = set(), []
        for r in out:
            if r["username"].lower() not in seen:
                seen.add(r["username"].lower())
                uniq.append(r)
        out = uniq
    return out, reasons


def draw(pool, n, seed):
    rng = random.Random(seed)
    if n > len(pool):
        print(f"⚠ 合格人數只有 {len(pool)}，少於要抽的 {n} 位，全部中獎。")
        n = len(pool)
    return rng.sample(pool, n)


def main():
    ap = argparse.ArgumentParser(description="Threads 留言抽獎")
    ap.add_argument("url", nargs="?", help="Threads 貼文網址")
    ap.add_argument("--login", action="store_true", help="開啟瀏覽器登入 Threads（只需做一次）")
    ap.add_argument("--from-csv", help="直接讀取已抓好的留言 CSV，不重新抓")
    ap.add_argument("-o", "--output", default="comments.csv", help="留言存檔路徑（預設 comments.csv）")
    ap.add_argument("-n", "--winners", type=int, default=1, help="抽出幾位（預設 1）")
    ap.add_argument("--backup", type=int, default=0, help="另外抽幾位備取")
    ap.add_argument("-k", "--keyword", action="append", help="留言須包含的關鍵字，可重複指定")
    ap.add_argument("--all-keywords", action="store_true", help="須包含全部關鍵字（預設任一即可）")
    ap.add_argument("--min-tags", type=int, default=0, help="留言至少要標註幾位朋友 (@xxx)")
    ap.add_argument("--before", help='截止時間，例如 "2026-11-20 23:59:59"')
    ap.add_argument("--exclude", nargs="*", help="排除的帳號")
    ap.add_argument("--author", help="貼文作者帳號（用 CSV 抽獎時用來排除作者）")
    ap.add_argument("--include-author", action="store_true", help="不排除貼文作者")
    ap.add_argument("--allow-multi", action="store_true", help="允許同一人多則留言增加機率（預設每人一次）")
    ap.add_argument("--seed", help="亂數種子；公布種子可讓他人重現抽獎結果")
    ap.add_argument("--max-scrolls", type=int, default=300)
    ap.add_argument("--headless", action="store_true", help="不顯示瀏覽器視窗")
    args = ap.parse_args()

    if args.login:
        login()
        return

    if args.from_csv:
        rows = load_csv(args.from_csv)
        author = (args.author or "").lstrip("@")
        print(f"從 {args.from_csv} 讀入 {len(rows)} 則留言")
    elif args.url:
        author, rows = asyncio.run(scrape(args.url, args.max_scrolls, headless=args.headless))
        save_csv(rows, args.output)
        print(f"貼文作者：@{author or '(未知)'}，共抓到 {len(rows)} 則留言，已存到 {args.output}")
        if not rows:
            print("沒有抓到留言。可能需要先登入：python threads_lottery.py --login")
            return
    else:
        ap.print_help()
        return

    pool, reasons = filter_eligible(rows, args, author)
    print(f"\n合格參加者：{len(pool)} 位")
    for why, c in reasons.items():
        print(f"  - 不合格（{why}）：{c} 則")
    if not pool:
        print("沒有合格的參加者。")
        return

    seed = args.seed or secrets.token_hex(8)
    picked = draw(pool, args.winners + args.backup, seed)
    winners, backups = picked[:args.winners], picked[args.winners:]

    print(f"\n🎲 抽獎時間：{datetime.now():%Y-%m-%d %H:%M:%S}　亂數種子：{seed}")
    print("=" * 50)
    print("🎉 得獎者")
    for i, r in enumerate(winners, 1):
        print(f"  {i}. @{r['username']}　「{r['text'][:40]}」")
    if backups:
        print("📋 備取")
        for i, r in enumerate(backups, 1):
            print(f"  {i}. @{r['username']}　「{r['text'][:40]}」")
    print("=" * 50)

    result = Path("winners.csv")
    save_csv(winners + backups, result)
    print(f"得獎名單已存到 {result}")


if __name__ == "__main__":
    main()
