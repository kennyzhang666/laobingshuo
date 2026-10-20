#!/usr/bin/env python3
"""老兵说 后端。

单进程，Python 标准库 + ldap3，数据存在 SQLite（data/laobing.db），照片存在 data/photos/。
启动：python server.py            （读取同目录 .env）
示例数据：python server.py seed-demo
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import traceback
from contextlib import closing
from datetime import datetime
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
# 自带的 ldap3 / pyasn1（纯 Python），内网无需 pip 安装
sys.path.insert(0, str(ROOT / "vendor"))


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


load_env(ROOT / ".env")

import ldap_auth  # noqa: E402  (需要先加载 .env)

DATA = Path(os.environ.get("DATA_DIR") or "data")
if not DATA.is_absolute():
    DATA = ROOT / DATA
PHOTOS = DATA / "photos"
DB_PATH = DATA / "laobing.db"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8090"))
SESSION_SECONDS = int(os.environ.get("SESSION_DAYS", "7")) * 86400
COOKIE = "lbs_session"
LDAP = ldap_auth.LdapConfig.from_env()

MODES = {"coffee": "喝咖啡", "lunch": "吃午饭", "walk": "散步", "online": "线上"}
WHEN = ["本周", "下周", "两周内", "都可以"]
PART = ["上午", "中午", "下午", "不限"]
STATUS = {"pending": "待安排", "arranged": "已安排", "done": "已完成", "cancelled": "已取消"}
DEFAULT_SETTINGS = {
    "categories": ["专家", "主管", "骨干"],
    "tags": ["5GC 架构", "3GPP 标准", "信令协议", "性能调优", "高可靠", "现网问题定位", "重大保障",
             "自动化测试", "质量体系", "云原生", "微服务", "版本管理", "需求分解", "团队管理", "职业规划", "新人成长"],
}
PHOTO_RE = re.compile(r"^[a-f0-9]{24}\.(jpg|png)$")
EMP_RE = re.compile(r"^[a-z0-9._-]{1,64}$")
write_lock = threading.Lock()


# ---------------------------------------------------------------- storage

def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def query(sql: str, args=(), one=False):
    with closing(connect()) as c:
        rows = c.execute(sql, args).fetchall()
    return (rows[0] if rows else None) if one else rows


def execute(sql: str, args=()) -> int:
    with write_lock, closing(connect()) as c, c:
        return c.execute(sql, args).lastrowid


def init_db() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    PHOTOS.mkdir(exist_ok=True)
    with closing(connect()) as c, c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS veterans(
            id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, updated_at TEXT);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS users(
            employee_no TEXT PRIMARY KEY, name TEXT, department TEXT, last_login TEXT);
        CREATE TABLE IF NOT EXISTS assistants(
            employee_no TEXT PRIMARY KEY, added_by TEXT, added_at TEXT);
        CREATE TABLE IF NOT EXISTS applications(
            id INTEGER PRIMARY KEY AUTOINCREMENT, veteran_id INTEGER, veteran_name TEXT,
            applicant_no TEXT, applicant_name TEXT, applicant_dept TEXT,
            mode TEXT, when_text TEXT, part TEXT, topics TEXT, note TEXT,
            status TEXT NOT NULL DEFAULT 'pending', arrange TEXT NOT NULL DEFAULT '',
            created_at TEXT, updated_at TEXT);
        """)
        for key, value in DEFAULT_SETTINGS.items():
            c.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (key, json.dumps(value, ensure_ascii=False)))


def secret_key() -> bytes:
    path = DATA / "secret.key"
    if not path.exists():
        path.write_text(secrets.token_hex(32), encoding="ascii")
    return path.read_text(encoding="ascii").strip().encode()


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def get_setting(key: str) -> list:
    row = query("SELECT value FROM settings WHERE key=?", (key,), one=True)
    return json.loads(row["value"]) if row else list(DEFAULT_SETTINGS.get(key, []))


def set_setting(key: str, value) -> None:
    execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (key, json.dumps(value, ensure_ascii=False)))


def load_veterans() -> list[dict]:
    rows = query("SELECT id, data FROM veterans")
    month = datetime.now().strftime("%Y-%m")
    used = {r["veteran_id"]: r["n"] for r in query(
        "SELECT veteran_id, COUNT(*) n FROM applications WHERE status!='cancelled' AND created_at LIKE ? GROUP BY veteran_id",
        (month + "%",))}
    done = {r["veteran_id"]: r["n"] for r in query(
        "SELECT veteran_id, COUNT(*) n FROM applications WHERE status='done' GROUP BY veteran_id")}
    result = []
    for r in rows:
        v = json.loads(r["data"])
        v["id"] = r["id"]
        v["remaining"] = max(0, v.get("quota", 0) - used.get(r["id"], 0))
        v["metTotal"] = v.get("met", 0) + done.get(r["id"], 0)
        result.append(v)
    result.sort(key=lambda v: (v.get("sort", 100), v["id"]))
    return result


def load_veteran(vid: int) -> dict:
    for v in load_veterans():
        if v["id"] == vid:
            return v
    raise ApiError(404, "老兵不存在")


# ---------------------------------------------------------------- validation

class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def text(value, limit: int) -> str:
    return str(value if value is not None else "").strip()[:limit]


def text_list(value, count=30, limit=40) -> list[str]:
    items = value if isinstance(value, list) else []
    out: list[str] = []
    for item in items:
        t = text(item, limit)
        if t and t not in out:
            out.append(t)
    return out[:count]


def as_int(value, default: int, lo: int, hi: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def clean_veteran(d: dict) -> dict:
    year = datetime.now().year
    name = text(d.get("name"), 20)
    if not name:
        raise ApiError(400, "请填写姓名")
    since = as_int(d.get("since"), 0, 0, 9999)
    if not 1980 <= since <= year:
        raise ApiError(400, "入职年份不正确")
    career = []
    for c in d.get("career") or []:
        if not isinstance(c, dict):
            continue
        y, pos = as_int(c.get("y"), 0, 0, 9999), text(c.get("pos"), 20)
        if 1980 <= y <= year + 1 and pos:
            career.append({"y": y, "pos": pos, "note": text(c.get("note"), 40)})
    career.sort(key=lambda c: c["y"])
    if not career:
        raise ApiError(400, "至少填写一个成长节点（年份和岗位）")
    awards = []
    for a in d.get("awards") or []:
        if not isinstance(a, dict):
            continue
        y, award = as_int(a.get("y"), 0, 0, 9999), text(a.get("name"), 60)
        if 1980 <= y <= year + 1 and award:
            awards.append({"y": y, "name": award})
    awards.sort(key=lambda a: -a["y"])
    photo = text(d.get("photo"), 64)
    return {
        "name": name,
        "employeeNo": text(d.get("employeeNo"), 64).lower(),
        "category": text(d.get("category"), 20),
        "title": text(d.get("title"), 60),
        "since": since,
        "hue": as_int(d.get("hue"), 190, 0, 359),
        "quota": as_int(d.get("quota"), 2, 0, 99),
        "met": as_int(d.get("met"), 0, 0, 99999),
        "sort": as_int(d.get("sort"), 100, 0, 9999),
        "photo": photo if PHOTO_RE.match(photo) else "",
        "quote": text(d.get("quote"), 120),
        "tags": text_list(d.get("tags")),
        "topics": text_list(d.get("topics"), 20, 40),
        "career": career[:20],
        "awards": awards[:30],
    }


# ---------------------------------------------------------------- session

def make_session(user: dict) -> str:
    payload = dict(user, exp=int(datetime.now().timestamp()) + SESSION_SECONDS)
    body = base64.urlsafe_b64encode(json.dumps(payload, ensure_ascii=False).encode()).decode().rstrip("=")
    sig = hmac.new(secret_key(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def read_session(token: str) -> dict | None:
    try:
        body, sig = token.split(".", 1)
        if not hmac.compare_digest(sig, hmac.new(secret_key(), body.encode(), hashlib.sha256).hexdigest()):
            return None
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if data.get("exp", 0) < datetime.now().timestamp():
            return None
        return {"employeeNo": data["employeeNo"], "name": data["name"], "department": data.get("department", "")}
    except (ValueError, KeyError, TypeError):
        return None


def is_assistant(employee_no: str) -> bool:
    return query("SELECT 1 FROM assistants WHERE employee_no=?", (employee_no,), one=True) is not None


def safe_return(value: str) -> str:
    if not value.startswith("/") or value.startswith("//") or "\r" in value or "\n" in value:
        return "/"
    return value


# ---------------------------------------------------------------- API handlers
# 每个 handler 签名：fn(req, match, user) -> 可 JSON 序列化的对象

def api_state(req, m, user):
    me = None
    if user:
        me = dict(user, isAssistant=is_assistant(user["employeeNo"]))
    return {"me": me, "veterans": load_veterans(), "categories": get_setting("categories"),
            "tags": get_setting("tags"), "modes": MODES, "when": WHEN, "part": PART}


def api_apply(req, m, user):
    d = req.json()
    v = load_veteran(as_int(d.get("veteranId"), 0, 0, 10**9))
    mode, when, part = d.get("mode"), d.get("when"), d.get("part") or "不限"
    if mode not in MODES or when not in WHEN or part not in PART:
        raise ApiError(400, "请选择交流方式和希望时间")
    if v["remaining"] <= 0:
        raise ApiError(409, "这位老兵本月已约满")
    if query("SELECT 1 FROM applications WHERE veteran_id=? AND applicant_no=? AND status='pending'",
             (v["id"], user["employeeNo"]), one=True):
        raise ApiError(409, "你已经有一条待安排的申请")
    t = now()
    new_id = execute(
        "INSERT INTO applications(veteran_id,veteran_name,applicant_no,applicant_name,applicant_dept,mode,when_text,part,topics,note,created_at,updated_at)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        (v["id"], v["name"], user["employeeNo"], user["name"], user["department"], mode, when, part,
         json.dumps(text_list(d.get("topics"), 20, 40), ensure_ascii=False), text(d.get("note"), 500), t, t))
    return {"id": new_id}


def app_row(r) -> dict:
    return {"id": r["id"], "veteranId": r["veteran_id"], "veteranName": r["veteran_name"],
            "applicantNo": r["applicant_no"], "applicantName": r["applicant_name"], "applicantDept": r["applicant_dept"],
            "mode": r["mode"], "when": r["when_text"], "part": r["part"], "topics": json.loads(r["topics"] or "[]"),
            "note": r["note"], "status": r["status"], "arrange": r["arrange"],
            "createdAt": r["created_at"], "updatedAt": r["updated_at"]}


def api_my_apps(req, m, user):
    rows = query("SELECT * FROM applications WHERE applicant_no=? ORDER BY id DESC", (user["employeeNo"],))
    return [app_row(r) for r in rows]


def api_my_cancel(req, m, user):
    r = query("SELECT * FROM applications WHERE id=? AND applicant_no=?", (int(m[1]), user["employeeNo"]), one=True)
    if not r:
        raise ApiError(404, "申请不存在")
    if r["status"] != "pending":
        raise ApiError(409, "已安排的申请请直接联系部门")
    execute("UPDATE applications SET status='cancelled', updated_at=? WHERE id=?", (now(), r["id"]))
    return {"ok": True}


def api_admin_apps(req, m, user):
    return [app_row(r) for r in query("SELECT * FROM applications ORDER BY id DESC LIMIT 1000")]


def api_admin_app_update(req, m, user):
    d = req.json()
    status = d.get("status")
    if status not in STATUS:
        raise ApiError(400, "状态不正确")
    if not query("SELECT 1 FROM applications WHERE id=?", (int(m[1]),), one=True):
        raise ApiError(404, "申请不存在")
    execute("UPDATE applications SET status=?, arrange=?, updated_at=? WHERE id=?",
            (status, text(d.get("arrange"), 200), now(), int(m[1])))
    return {"ok": True}


def api_vet_create(req, m, user):
    v = clean_veteran(req.json())
    return {"id": execute("INSERT INTO veterans(data,updated_at) VALUES(?,?)", (json.dumps(v, ensure_ascii=False), now()))}


def api_vet_update(req, m, user):
    vid = int(m[1])
    old = query("SELECT data FROM veterans WHERE id=?", (vid,), one=True)
    if not old:
        raise ApiError(404, "老兵不存在")
    v = clean_veteran(req.json())
    execute("UPDATE veterans SET data=?, updated_at=? WHERE id=?", (json.dumps(v, ensure_ascii=False), now(), vid))
    old_photo = json.loads(old["data"]).get("photo")
    if old_photo and old_photo != v["photo"]:
        (PHOTOS / old_photo).unlink(missing_ok=True)
    return {"id": vid}


def api_vet_delete(req, m, user):
    vid = int(m[1])
    old = query("SELECT data FROM veterans WHERE id=?", (vid,), one=True)
    if not old:
        raise ApiError(404, "老兵不存在")
    execute("DELETE FROM veterans WHERE id=?", (vid,))
    photo = json.loads(old["data"]).get("photo")
    if photo:
        (PHOTOS / photo).unlink(missing_ok=True)
    return {"ok": True}


def api_photo(req, m, user):
    data = str(req.json().get("data", ""))
    match = re.match(r"^data:image/(jpeg|png);base64,(.+)$", data, re.S)
    if not match:
        raise ApiError(400, "只支持 JPG 或 PNG")
    raw = base64.b64decode(match[2])
    if len(raw) > 5 * 1024 * 1024:
        raise ApiError(400, "照片太大")
    ext = "png" if raw.startswith(b"\x89PNG") else "jpg"
    if ext == "jpg" and not raw.startswith(b"\xff\xd8"):
        raise ApiError(400, "图片格式不正确")
    name = f"{secrets.token_hex(12)}.{ext}"
    (PHOTOS / name).write_bytes(raw)
    return {"photo": name}


def apply_renames(field: str, items) -> list[str]:
    """items: [{old, new}]。old 为空表示新增；new 为空表示删除。返回新的列表。"""
    if not isinstance(items, list):
        raise ApiError(400, "数据格式不正确")
    pairs = [(text(i.get("old"), 40), text(i.get("new"), 40)) for i in items if isinstance(i, dict)]
    new_list: list[str] = []
    for _, new in pairs:
        if new and new not in new_list:
            new_list.append(new)
    renames = {old: new for old, new in pairs if old and new and old != new}
    removed = {old for old, new in pairs if old and not new}
    rows = query("SELECT id, data FROM veterans")
    if field == "categories":
        for r in rows:
            v = json.loads(r["data"])
            if v.get("category") in removed:
                raise ApiError(409, f"类别「{v['category']}」下还有老兵（{v['name']}），请先修改他们的类别")
    for r in rows:
        v = json.loads(r["data"])
        changed = False
        if field == "categories" and v.get("category") in renames:
            v["category"] = renames[v["category"]]
            changed = True
        if field == "tags":
            tags = [renames.get(t, t) for t in v.get("tags", []) if t not in removed]
            tags = list(dict.fromkeys(tags))
            if tags != v.get("tags", []):
                v["tags"] = tags
                changed = True
        if changed:
            execute("UPDATE veterans SET data=?, updated_at=? WHERE id=?", (json.dumps(v, ensure_ascii=False), now(), r["id"]))
    return new_list


def api_settings(req, m, user):
    d = req.json()
    for field in ("categories", "tags"):
        if field in d:
            set_setting(field, apply_renames(field, d[field]))
    return {"categories": get_setting("categories"), "tags": get_setting("tags")}


def api_assistants(req, m, user):
    rows = query("SELECT a.employee_no, a.added_at, u.name, u.department FROM assistants a"
                 " LEFT JOIN users u ON u.employee_no=a.employee_no ORDER BY a.added_at")
    return [{"employeeNo": r["employee_no"], "name": r["name"] or "", "department": r["department"] or "",
             "addedAt": r["added_at"]} for r in rows]


def api_assistant_add(req, m, user):
    no = text(req.json().get("employeeNo"), 64).lower()
    if not EMP_RE.match(no):
        raise ApiError(400, "工号格式不正确")
    execute("INSERT OR IGNORE INTO assistants(employee_no,added_by,added_at) VALUES(?,?,?)", (no, user["employeeNo"], now()))
    return {"ok": True}


def api_assistant_remove(req, m, user):
    no = m[1].lower()
    if query("SELECT COUNT(*) n FROM assistants", one=True)["n"] <= 1:
        raise ApiError(409, "至少保留一位助理")
    execute("DELETE FROM assistants WHERE employee_no=?", (no,))
    return {"ok": True}


# (method, path regex, handler, 权限: public / user / assistant)
ROUTES = [
    ("GET", r"/api/state", api_state, "public"),
    ("POST", r"/api/applications", api_apply, "user"),
    ("GET", r"/api/my/applications", api_my_apps, "user"),
    ("POST", r"/api/my/applications/(\d+)/cancel", api_my_cancel, "user"),
    ("GET", r"/api/admin/applications", api_admin_apps, "assistant"),
    ("PUT", r"/api/admin/applications/(\d+)", api_admin_app_update, "assistant"),
    ("POST", r"/api/admin/veterans", api_vet_create, "assistant"),
    ("PUT", r"/api/admin/veterans/(\d+)", api_vet_update, "assistant"),
    ("DELETE", r"/api/admin/veterans/(\d+)", api_vet_delete, "assistant"),
    ("POST", r"/api/admin/photo", api_photo, "assistant"),
    ("PUT", r"/api/admin/settings", api_settings, "assistant"),
    ("GET", r"/api/admin/assistants", api_assistants, "assistant"),
    ("POST", r"/api/admin/assistants", api_assistant_add, "assistant"),
    ("DELETE", r"/api/admin/assistants/([A-Za-z0-9._-]+)", api_assistant_remove, "assistant"),
]

STATIC_TYPES = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
                ".svg": "image/svg+xml", ".ico": "image/x-icon"}


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "laobingshuo"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write(f"{now()} {self.address_string()} {fmt % args}\n")

    # ---- helpers
    def body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length > 12 * 1024 * 1024:
            raise ApiError(413, "请求太大")
        return self.rfile.read(length) if length else b""

    def json(self) -> dict:
        try:
            data = json.loads(self.body() or b"{}")
        except ValueError:
            raise ApiError(400, "请求格式不正确")
        if not isinstance(data, dict):
            raise ApiError(400, "请求格式不正确")
        return data

    def send(self, status: int, body: bytes, ctype: str, headers=(), cache="no-store"):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, obj, status=200, headers=()):
        self.send(status, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8", headers)

    def redirect(self, location: str, headers=()):
        self.send(302, b"", "text/plain", [("Location", location), *headers])

    def current_user(self) -> dict | None:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        token = cookie.get(COOKIE)
        return read_session(token.value) if token else None

    def session_cookie(self, value: str, max_age: int) -> tuple[str, str]:
        return ("Set-Cookie", f"{COOKIE}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}")

    # ---- verbs
    def do_GET(self):
        self.dispatch("GET")

    def do_HEAD(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def dispatch(self, method: str):
        url = urlparse(self.path)
        path = url.path
        try:
            if path.startswith("/api/"):
                return self.api(method, path)
            if path == "/login":
                return self.login_post() if method == "POST" else self.login_page(parse_qs(url.query).get("returnTo", ["/"])[0])
            if path == "/logout":
                return self.redirect("/", [self.session_cookie("", 0)])
            if method == "GET" and path.startswith("/photos/"):
                name = path[len("/photos/"):]
                if PHOTO_RE.match(name) and (PHOTOS / name).exists():
                    return self.send(200, (PHOTOS / name).read_bytes(), STATIC_TYPES["." + name.rsplit(".", 1)[1]],
                                     cache="public, max-age=31536000, immutable")
                return self.send(404, b"not found", "text/plain")
            if method == "GET":
                return self.static(path)
            self.send(405, b"method not allowed", "text/plain")
        except ApiError as e:
            self.send_json({"message": e.message}, e.status)
        except Exception:
            traceback.print_exc()
            self.send_json({"message": "服务器出错了"}, 500)

    def api(self, method: str, path: str):
        for verb, pattern, fn, level in ROUTES:
            if verb != method:
                continue
            m = re.fullmatch(pattern, path)
            if not m:
                continue
            user = self.current_user()
            if level != "public" and not user:
                raise ApiError(401, "请先登录")
            if level == "assistant" and not is_assistant(user["employeeNo"]):
                raise ApiError(403, "只有助理可以操作")
            return self.send_json(fn(self, m, user))
        raise ApiError(404, "接口不存在")

    def static(self, path: str):
        if path == "/":
            path = "/index.html"
        target = (WEB / path.lstrip("/")).resolve()
        if WEB not in target.parents or not target.is_file() or target.suffix not in STATIC_TYPES or target.name == "login.html":
            return self.send(404, b"not found", "text/plain")
        self.send(200, target.read_bytes(), STATIC_TYPES[target.suffix], cache="no-cache")

    def login_page(self, return_to: str, error: str = "", status: int = 200):
        page = (WEB / "login.html").read_text(encoding="utf-8")
        page = (page.replace("{{RETURN_TO}}", html.escape(safe_return(return_to), quote=True))
                    .replace("{{ERROR}}", html.escape(error))
                    .replace("{{ERROR_STATE}}", "visible" if error else "hidden"))
        self.send(status, page.encode(), "text/html; charset=utf-8")

    def login_post(self):
        fields = {k: v[-1] for k, v in parse_qs(self.body().decode("utf-8", "replace"), keep_blank_values=True).items()}
        return_to = safe_return(fields.get("returnTo", "/"))
        try:
            u = ldap_auth.authenticate(LDAP, fields.get("userId", ""), fields.get("password", ""))
        except ldap_auth.LdapAuthenticationError:
            return self.login_page(return_to, "工号或密码错误", 401)
        except ldap_auth.LdapProfileError:
            return self.login_page(return_to, "统一认证失败，请检查工号和密码或联系管理员", 401)
        except ldap_auth.LdapGatewayError:
            return self.login_page(return_to, "统一认证服务暂时不可用", 503)
        user = {"employeeNo": u.employee_no.lower(), "name": u.name, "department": u.department}
        with write_lock, closing(connect()) as c, c:
            c.execute("INSERT OR REPLACE INTO users(employee_no,name,department,last_login) VALUES(?,?,?,?)",
                      (user["employeeNo"], user["name"], user["department"], now()))
            # 第一个登录的人自动成为助理
            if c.execute("SELECT COUNT(*) FROM assistants").fetchone()[0] == 0:
                c.execute("INSERT INTO assistants(employee_no,added_by,added_at) VALUES(?,?,?)",
                          (user["employeeNo"], "system", now()))
        self.log_message("login %s", user["employeeNo"])
        self.redirect(return_to, [self.session_cookie(make_session(user), SESSION_SECONDS)])


# ---------------------------------------------------------------- entry

def seed_demo() -> None:
    if query("SELECT COUNT(*) n FROM veterans", one=True)["n"]:
        print("已有老兵数据，跳过。")
        return
    demo = json.loads((ROOT / "demo.json").read_text(encoding="utf-8"))
    for v in demo:
        execute("INSERT INTO veterans(data,updated_at) VALUES(?,?)", (json.dumps(clean_veteran(v), ensure_ascii=False), now()))
    print(f"已导入 {len(demo)} 位示例老兵。")


def main() -> None:
    init_db()
    secret_key()
    if "seed-demo" in sys.argv[1:]:
        return seed_demo()
    if "--log" in sys.argv[1:]:
        # 作为 Windows 计划任务在后台运行时没有控制台，输出写到 data/server.log
        log = open(DATA / "server.log", "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stderr = log
    if LDAP.mock:
        print("警告：LDAP_MOCK=true，任意密码都能登录，只能用于本地试跑！")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    print(f"老兵说 已启动：http://{HOST}:{PORT}  数据目录：{DATA}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
