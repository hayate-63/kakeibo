# prototype-template-v10.xlsx を生成する（＋検証用に sheets.json を出力）
# 使い方: python3 build_template.py <出力先ディレクトリ>
import json
import sys
from datetime import datetime as DT

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
DTF = "yyyy/mm/dd hh:mm:ss"
GRAY = PatternFill("solid", fgColor="D9D9D9")
HEAD = PatternFill("solid", fgColor="DDEBF7")
BOLD = Font(bold=True)

wb = Workbook()
wb.remove(wb.active)
dump = {}  # sheet -> {"A1": value}


def put(ws, addr, value, fmt=None, bold=False, fill=None):
    c = ws[addr]
    c.value = value
    if fmt:
        c.number_format = fmt
    if bold:
        c.font = BOLD
    if fill:
        c.fill = fill
    v = value.strftime("%Y-%m-%dT%H:%M:%S") if isinstance(value, DT) else value
    dump.setdefault(ws.title, {})[addr] = {"d": v} if isinstance(value, DT) else v


def sheet(name):
    ws = wb.create_sheet(name)
    dump.setdefault(name, {})
    return ws


# ---------------- 設定（共通） ----------------
ws = sheet("設定")
put(ws, "A1", "設定（共通）", bold=True)
put(ws, "A2", "値はB列。ON/OFF は半角大文字で入力。")
for a, v in (("A3", "共通設定"), ("B3", "設定値"), ("C3", "備考")):
    put(ws, a, v, bold=True, fill=HEAD)
common = [
    ("ボタンシート名", "操作", "ボタンと除外期間入力セルのあるシート"),
    ("リセットログシート名", "リセットログ", ""),
    ("開いた時の通知", "ON", "ON/OFF。通知のみで記録はしない"),
    ("実行前確認", "ON", "ON/OFF。記録実行の確認ダイアログ"),
    ("記録停止フラグ", "OFF", "ON/OFF。ONの間は記録実行しない"),
    ("重複チェック", "ON", "ON/OFF。記録先に同じ自動弁タイムスタンプがあれば書かない"),
    ("記録後の保存方法", "自動保存", "自動保存／保存を促す（仮実装では常に自動保存）"),
]
for i, (k, v, n) in enumerate(common):
    r = 4 + i
    put(ws, f"A{r}", k)
    put(ws, f"B{r}", v)
    put(ws, f"C{r}", n)
ws.column_dimensions["A"].width = 24
ws.column_dimensions["B"].width = 16
ws.column_dimensions["C"].width = 56

# ---------------- 設定1〜3 ----------------
dests = {
    1: [("記録先1-1", "A2"), ("記録先1-2", "A2"), ("記録先1-3", "A2")],
    2: [("記録先2-1", "A2"), ("記録先2-2", "A2"), ("記録先2-3", "A2")],
    3: [("記録先3-1", "A2"), ("", ""), ("", "")],
}
excl = {1: ("B7", "B8"), 2: ("B12", "B13"), 3: ("B17", "B18")}
for s in (1, 2, 3):
    ws = sheet(f"設定{s}")
    put(ws, "A1", f"設定（系列{s}）", bold=True)
    put(ws, "A2", "値はB列。グレーの管理欄（行24〜27）は触らない欄（VBA／スクリプトが書き込む）。")
    for a, v in (("A3", "系列設定"), ("B3", "設定値"), ("C3", "備考")):
        put(ws, a, v, bold=True, fill=HEAD)
    d = dests[s]
    rows = [
        ("系列名", f"系列{s}", "空欄にすると未使用（処理対象外）"),
        ("系列の有効フラグ", "ON", "ON/OFF"),
        ("データ抽出シート名", f"抽出{s}", ""),
        ("データ開始行", 2, ""),
        ("自動弁タイムスタンプ列", "A", "列記号"),
        ("自動弁列", "B", "列記号（値は0/1）"),
        ("積算値タイムスタンプ列", "C", "列記号"),
        ("積算値列", "D", "列記号"),
        ("記録先1シート名", d[0][0], "仮実装：記録先サンプルに合わせて記入済み"),
        ("記録先1開始セル", d[0][1], "例 A2"),
        ("記録先2シート名", d[1][0], "無い系列は空欄"),
        ("記録先2開始セル", d[1][1], ""),
        ("記録先3シート名", d[2][0], "無い系列は空欄"),
        ("記録先3開始セル", d[2][1], ""),
        ("遡り日数", 7, "ポインタが無い時の基準＋安全上限"),
        ("照合許容差（秒）", 60, "目安。現場に合わせて変更"),
        ("除外開始セル（ボタンシート上）", excl[s][0], ""),
        ("除外終了セル（ボタンシート上）", excl[s][1], ""),
    ]
    for i, (k, v, n) in enumerate(rows):
        r = 4 + i
        put(ws, f"A{r}", k)
        if v != "":
            put(ws, f"B{r}", v)
        put(ws, f"C{r}", n)
    put(ws, "A23", "管理欄（触らない）", bold=True, fill=GRAY)
    put(ws, "B23", "触らない欄", bold=True, fill=GRAY)
    put(ws, "C23", "スクリプトが書き込む", bold=True, fill=GRAY)
    for r, k in ((24, "処理済みタイムスタンプ"), (25, "処理済み行番号"), (26, "最終実行日時"), (27, "最終記録件数")):
        put(ws, f"A{r}", k, fill=GRAY)
        ws[f"B{r}"].fill = GRAY
        ws[f"C{r}"].fill = GRAY
        if r in (24, 26):
            ws[f"B{r}"].number_format = DTF
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 22
    ws.column_dimensions["C"].width = 44

# ---------------- 操作（ボタンシート） ----------------
ws = sheet("操作")
put(ws, "A1", "自動弁→流量計積算値 記録（操作）", bold=True)
put(ws, "A2", "記録実行（全系列）：メニュー「記録ツール」→「記録実行（全系列）」 またはここに置いた図形ボタン")
put(ws, "A3", "（仮実装ではボタン図形はインポートされないため、メニューを使うか、設置手順メモに沿って図形を置く）")
for s, top in ((1, 6), (2, 11), (3, 16)):
    put(ws, f"A{top}", f"系列{s}", bold=True, fill=HEAD)
    put(ws, f"A{top+1}", "除外開始")
    put(ws, f"A{top+2}", "除外終了")
    ws[f"B{top+1}"].number_format = DTF
    ws[f"B{top+2}"].number_format = DTF
    put(ws, f"D{top}", f"→ プレビュー（系列{s}）／リセット（系列{s}）はメニュー、またはD〜F列に図形ボタン")
ws.column_dimensions["A"].width = 12
ws.column_dimensions["B"].width = 22

# ---------------- リセットログ ----------------
ws = sheet("リセットログ")
for a, v in zip("ABCDE", ["リセット実行日時", "系列名", "除外開始日時", "除外終了日時", "リセット後の処理済みタイムスタンプ"]):
    put(ws, f"{a}1", v, bold=True, fill=HEAD)
    ws.column_dimensions[a].width = 22 if a != "E" else 34

# ---------------- 抽出1〜3（ダミーデータ） ----------------
def d(s):
    return DT.strptime(s, "%Y/%m/%d %H:%M:%S")

extract = {
    1: {
        "valve": [
            ("2026/11/17 08:00:00", 0),
            ("2026/11/17 08:10:00", 1),  # E1 パターンa（完全一致）
            ("2026/11/17 08:20:00", 1),
            ("2026/11/17 08:30:00", 0),
            ("2026/11/17 09:00:00", 1),  # E2 パターンb（2回目）
            ("2026/11/17 09:10:00", 0),
            ("2026/11/17 13:00:00", 0),
            ("2026/11/17 13:05:00", 1),  # F1 パターンf（補修の開閉チェック）
            ("2026/11/17 13:06:00", 0),
            ("2026/11/17 13:07:00", 1),  # F2
            ("2026/11/17 13:08:00", 0),
            ("2026/11/17 13:09:00", 1),  # F3
            ("2026/11/17 13:10:00", 0),
            ("2026/11/17 16:00:00", 1),  # E3
            ("2026/11/17 16:30:00", 0),
            ("2026/11/18 09:00:00", 1),  # E4（流量計は10秒後）
            ("2026/11/18 09:30:00", 0),
        ],
        "flow": [
            ("2026/11/17 08:00:00", 1000),
            ("2026/11/17 08:10:00", 1010),
            ("2026/11/17 08:30:00", 1020),
            ("2026/11/17 09:00:00", 1030),
            ("2026/11/17 13:05:00", 1100),
            ("2026/11/17 13:07:00", 1101),
            ("2026/11/17 13:09:00", 1102),
            ("2026/11/17 16:00:00", 1200),
            ("2026/11/18 09:00:10", 1300),
        ],
    },
    2: {
        "valve": [
            ("2026/11/17 10:00:00", 0),
            ("2026/11/17 10:15:00", 1),  # G1 パターンd（30秒前と45秒後）
            ("2026/11/17 10:30:00", 0),
            ("2026/11/17 11:00:00", 1),  # G2 パターンe（120秒前と90秒後→60秒では範囲外）
            ("2026/11/17 11:30:00", 0),
            ("2026/11/17 12:00:00", 1),  # G3 同距離（40秒前と40秒後→直前優先）
            ("2026/11/17 12:30:00", 0),
        ],
        "flow": [
            ("2026/11/17 10:00:00", 1990),
            ("2026/11/17 10:14:30", 2000),
            ("2026/11/17 10:15:45", 2001),
            ("2026/11/17 10:58:00", 2010),
            ("2026/11/17 11:01:30", 2011),
            ("2026/11/17 11:59:20", 2020),
            ("2026/11/17 12:00:40", 2021),
        ],
    },
    3: {
        "valve": [
            ("2026/11/17 07:00:00", 1),   # 先頭行が1（直前なし→立ち上がりではない）
            ("2026/11/17 07:30:00", 1),   # 1→1
            ("2026/11/17 08:00:00", 0),   # 1→0
            ("2026/11/17 08:30:00", 0),   # 0→0
            ("2026/11/17 09:00:00", ""),  # 値が空白（異常）
            ("2026/11/17 09:30:00", 1),   # 直前が空白→立ち上がりではない
            ("2026/11/17 10:00:00", 0),
            ("", 1),                      # タイムスタンプ空白行→走査対象外
            ("2026/11/17 10:30:00", 0),   # 0→0（空白行は飛ばす）
            ("2026/11/18 08:00:00", 1),   # H1 パターンa（記録先1箇所）
            ("2026/11/18 08:30:00", 0),
            ("2026/11/18 10:00:00", 1),   # H2 照合できるが積算値が空白→記録しない
            ("2026/11/18 10:30:00", 0),
        ],
        "flow": [
            ("2026/11/17 07:00:00", 3000),
            ("2026/11/17 09:30:00", 3005),
            ("2026/11/18 08:00:00", 3010),
            ("2026/11/18 10:00:05", ""),
        ],
    },
}
for s in (1, 2, 3):
    ws = sheet(f"抽出{s}")
    for a, v in zip("ABCD", ["自動弁タイムスタンプ", "自動弁", "積算値タイムスタンプ", "積算値"]):
        put(ws, f"{a}1", v, bold=True, fill=HEAD)
    for i, (t, v) in enumerate(extract[s]["valve"]):
        r = 2 + i
        if t:
            put(ws, f"A{r}", d(t), DTF)
        if v != "":
            put(ws, f"B{r}", v)
    for i, (t, v) in enumerate(extract[s]["flow"]):
        r = 2 + i
        put(ws, f"C{r}", d(t), DTF)
        if v != "":
            put(ws, f"D{r}", v)
    for a in "AC":
        ws.column_dimensions[a].width = 22
    ws.column_dimensions["D"].width = 10

# ---------------- 記録先サンプル ----------------
for name in ["記録先1-1", "記録先1-2", "記録先1-3", "記録先2-1", "記録先2-2", "記録先2-3", "記録先3-1"]:
    ws = sheet(name)
    for a, v in zip("ABC", ["自動弁タイムスタンプ", "積算値タイムスタンプ", "積算値"]):
        put(ws, f"{a}1", v, bold=True, fill=HEAD)
        ws.column_dimensions[a].width = 22

# ---------------- テスト手順 ----------------
ws = sheet("テスト手順")
ws.column_dimensions["A"].width = 10
ws.column_dimensions["B"].width = 60
ws.column_dimensions["C"].width = 80
ws.column_dimensions["D"].width = 16
ws.column_dimensions["E"].width = 14
wrap = Alignment(wrap_text=True, vertical="top")
with open(sys.argv[2] if len(sys.argv) > 2 else "test_steps.json", encoding="utf-8") as f:
    steps = json.load(f)
r = 1
for row in steps:
    for j, v in enumerate(row):
        c = ws.cell(row=r, column=j + 1, value=v)
        c.alignment = wrap
        if row and isinstance(row[0], str) and (row[0].startswith("■") or row[0] == "No"):
            c.font = BOLD
            if row[0] == "No":
                c.fill = HEAD
    r += 1

wb.save(f"{OUT}/prototype-template-v10.xlsx")
with open(f"{OUT}/dev/sheets.json", "w", encoding="utf-8") as f:
    json.dump(dump, f, ensure_ascii=False, indent=1)
print("ok")
