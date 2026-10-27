"""Выгрузка активных задач из Todoist в todoist.json для загрузки в приложение.

Запуск: python tools/todoist_export.py
Спросит токен Todoist (Настройки → Интеграции → Для разработчиков → API-токен).
Токен никуда не сохраняется. Повторы Todoist переводятся в наши, что не понято —
задача грузится без повтора, а исходная строка повтора пишется в заметку.
"""
import json
import re
import urllib.request
from getpass import getpass
from pathlib import Path

API = "https://api.todoist.com/api/v1/"
OUT = Path(__file__).resolve().parent.parent / "todoist.json"
COLORS = ["#8fb3ff", "#c3a6ff", "#8fd6a0", "#f2c26b", "#f2808a", "#7fd8e8", "#ffab7a", "#e6a3d6"]

# дни недели: английские и русские начала слов → 1=пн … 7=вс
WEEKDAYS = {
    "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6, "sun": 7,
    "пн": 1, "вт": 2, "ср": 3, "чт": 4, "пт": 5, "сб": 6, "вс": 7,
    "понед": 1, "вторн": 2, "сред": 3, "четв": 4, "пятн": 5, "суббот": 6, "воскр": 7,
}
UNITS = [  # (начала слов, наша единица)
    (("day", "daily", "дн", "день", "ежеднев"), "day"),
    (("week", "недел", "еженедел"), "week"),
    (("month", "месяц", "ежемесяч", "числ"), "month"),
    (("year", "annual", "год", "лет", "ежегод"), "year"),
]


def get_all(path, token):
    items, cursor = [], None
    while True:
        url = API + path + "?limit=200" + (f"&cursor={cursor}" if cursor else "")
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
        items += data["results"]
        cursor = data.get("next_cursor")
        if not cursor:
            return items


def parse_repeat(s):
    """Строку повтора Todoist ('every! 3 days', 'каждый пн, чт') → поля повтора или None."""
    s = s.lower().strip()
    if not re.search(r"\bevery|кажд|ежедн|еженед|ежемес|ежегод|daily|weekly|monthly|yearly|по будням|через", s):
        return None
    rep = {"repeat_every": 1, "repeat_from": "done" if "!" in s else "due", "repeat_weekdays": None}
    words = re.findall(r"[a-zа-яё]+", s)
    if "weekday" in s or "будн" in s:
        return {**rep, "repeat_unit": "week", "repeat_weekdays": [1, 2, 3, 4, 5]}
    if "weekend" in s or "выходн" in s:
        return {**rep, "repeat_unit": "week", "repeat_weekdays": [6, 7]}
    days = sorted({n for w in words for k, n in WEEKDAYS.items() if w.startswith(k)})
    num = re.search(r"\d+", s)
    if days and not any(w.startswith(("month", "месяц", "числ")) for w in words):
        every = int(num.group()) if num and re.search(r"\d+\s*(week|недел)", s) else 1
        return {**rep, "repeat_unit": "week", "repeat_every": every, "repeat_weekdays": days}
    if re.search(r"\d+(st|nd|rd|th)\b|\d+\s*-?\s*(е|го|ое)\b", s):  # every 15th / каждое 15-е
        return {**rep, "repeat_unit": "month"}
    if re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|январ|феврал|март|апрел|ма[яй]\b|июн|июл|август|сентябр|октябр|ноябр|декабр", s):
        return {**rep, "repeat_unit": "year"}  # every jan 5 / каждое 5 января
    if "other" in words or "через" in words:  # every other day / через день
        num = re.match(r"(\d+)", "2")
    for prefixes, unit in UNITS:
        if any(w.startswith(prefixes) for w in words):
            # «every 15th» / «каждое 15 число» — раз в месяц, число не количество
            every = int(num.group()) if num and unit != "month" or (num and re.search(r"\d+\s*(month|месяц)", s)) else 1
            return {**rep, "repeat_unit": unit, "repeat_every": max(1, every)}
    return None


def main():
    token = getpass("API-токен Todoist (символы не видны при вводе): ").strip()
    projects = get_all("projects", token)
    tasks = get_all("tasks", token)
    names = {p["id"]: p["name"] for p in projects}
    titles = {t["id"]: t["content"] for t in tasks}

    sections = [{"name": p["name"], "color": COLORS[i % len(COLORS)]}
                for i, p in enumerate(p for p in projects if not p.get("inbox_project"))]
    out, unparsed = [], []
    for t in sorted(tasks, key=lambda t: (t.get("child_order", 0))):
        project = next((p for p in projects if p["id"] == t["project_id"]), {})
        notes = [t["description"]] if t.get("description") else []
        if t.get("parent_id") in titles:
            notes.append(f"Подзадача «{titles[t['parent_id']]}»")
        row = {"title": t["content"], "section": None if project.get("inbox_project") else names.get(t["project_id"]),
               "due_date": None, "start_time": None, "repeat_unit": None}
        due = t.get("due")
        if due:
            date = due.get("datetime") or due.get("date") or ""
            row["due_date"] = date[:10] or None
            if len(date) >= 16:
                row["start_time"] = date[11:16]
            if due.get("is_recurring"):
                rep = parse_repeat(due.get("string", ""))
                if rep:
                    row.update(rep)
                else:
                    notes.append(f"Повтор в Todoist: {due.get('string')}")
                    unparsed.append(f"{t['content']} — «{due.get('string')}»")
        row["notes"] = "\n".join(notes) or None
        out.append(row)

    OUT.write_text(json.dumps({"source": "todoist", "sections": sections, "tasks": out}, ensure_ascii=False, indent=1),
                   encoding="utf-8")
    print(f"Готово: {len(out)} задач, {len(sections)} разделов → {OUT}")
    if unparsed:
        print("\nЭти повторы не поняла — задачи загрузятся без повтора, строка повтора будет в заметке:")
        print("\n".join("  • " + u for u in unparsed))


if __name__ == "__main__":
    main()
