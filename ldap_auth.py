"""LDAP 登录校验。

逻辑与 AI-Training-Platform/services/ldap3-gateway/ldap3_gateway.py 保持一致：
用 ``China\\工号`` 绑定 AD，再按 sAMAccountName 查出姓名和部门。
配置项（LDAP_*）的名字和默认值也完全相同，可以直接复用那边的 .env。
"""

from __future__ import annotations

import os
import re
import ssl
from dataclasses import dataclass
from typing import Any, Mapping


class LdapGatewayError(Exception):
    """不向前端暴露 LDAP 细节的错误基类。"""


class LdapAuthenticationError(LdapGatewayError):
    """工号或密码错误。"""


class LdapProfileError(LdapGatewayError):
    """认证通过但用户资料不完整。"""


@dataclass(frozen=True)
class LdapConfig:
    server: str = "china.huawei.com"
    port: int = 389
    use_ssl: bool = False
    start_tls: bool = False
    base_dn: str = "dc=china,dc=huawei,dc=com"
    bind_prefix: str = "China\\"
    account_attribute: str = "sAMAccountName"
    title_attribute: str = "title"
    department_attribute: str = "department"
    name_attribute: str = "displayName"
    ca_cert_file: str | None = None
    timeout_seconds: int = 5
    # 仅用于本地试跑：任意非空密码都能登录，不连接 LDAP。正式环境必须为 false。
    mock: bool = False
    mock_department: str = "分组核心网控制开发部"
    mock_name_prefix: str = "测试用户 "

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "LdapConfig":
        values = os.environ if env is None else env
        server = values.get("LDAP_SERVER", "china.huawei.com").strip()
        base_dn = values.get("LDAP_BASE_DN", "dc=china,dc=huawei,dc=com").strip()
        if not server:
            raise ValueError("LDAP_SERVER is required")
        if not base_dn:
            raise ValueError("LDAP_BASE_DN is required")
        use_ssl = _boolean(values.get("LDAP_USE_SSL"), False)
        start_tls = _boolean(values.get("LDAP_START_TLS"), False)
        if use_ssl and start_tls:
            raise ValueError("LDAP_USE_SSL and LDAP_START_TLS cannot both be enabled")
        return cls(
            server=server,
            port=_positive_int(values, "LDAP_PORT", 389, 1, 65535),
            use_ssl=use_ssl,
            start_tls=start_tls,
            base_dn=base_dn,
            bind_prefix=values.get("LDAP_BIND_PREFIX", "China\\"),
            account_attribute=_attribute_name(values.get("LDAP_ACCOUNT_ATTRIBUTE", "sAMAccountName")),
            title_attribute=_attribute_name(values.get("LDAP_TITLE_ATTRIBUTE", "title")),
            department_attribute=_attribute_name(values.get("LDAP_DEPARTMENT_ATTRIBUTE", "department")),
            name_attribute=_attribute_name(values.get("LDAP_NAME_ATTRIBUTE", "displayName")),
            ca_cert_file=values.get("LDAP_CA_CERT_FILE", "").strip() or None,
            timeout_seconds=_positive_int(values, "LDAP_TIMEOUT_SECONDS", 5, 1, 60),
            mock=_boolean(values.get("LDAP_MOCK"), False),
            mock_department=values.get("LDAP_MOCK_DEPARTMENT", "").strip() or "分组核心网控制开发部",
            mock_name_prefix=values.get("LDAP_MOCK_NAME_PREFIX", "").strip() or "测试用户 ",
        )


@dataclass(frozen=True)
class LdapUser:
    employee_no: str
    name: str
    department: str = ""


def _positive_int(values: Mapping[str, str], name: str, default: int, minimum: int, maximum: int) -> int:
    raw = values.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def _boolean(raw: str | None, default: bool) -> bool:
    if raw is None or not raw.strip():
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise ValueError("boolean environment values must be true or false")


def _attribute_name(value: str) -> str:
    candidate = value.strip()
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,63}", candidate):
        raise ValueError("LDAP attribute names must contain only ASCII letters, digits, underscores or hyphens")
    return candidate


def _load_ldap3() -> Any:
    try:
        import ldap3  # type: ignore[import-not-found]
    except ImportError as exc:
        raise LdapGatewayError("ldap3 is not installed") from exc
    return ldap3


def escape_filter_value(value: str) -> str:
    """按 RFC 4515 转义 LDAP 过滤值。"""
    escaped: list[str] = []
    for byte in value.encode("utf-8"):
        if byte in {0x00, 0x28, 0x29, 0x2A, 0x5C} or byte >= 0x80:
            escaped.append(f"\\{byte:02x}")
        else:
            escaped.append(chr(byte))
    return "".join(escaped)


def safe_user_id(user_id: str) -> str:
    value = user_id.strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", value):
        raise LdapAuthenticationError("工号格式不正确")
    return value


def _entry_value(entry: Any, attribute: str) -> str:
    if isinstance(entry, Mapping):
        value = entry.get(attribute)
    else:
        try:
            value = getattr(entry, attribute)
        except AttributeError:
            return ""
    if hasattr(value, "value"):
        value = value.value
    if isinstance(value, (list, tuple)):
        value = value[0] if value else ""
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    return str(value).strip() if value is not None else ""


def _safe_identity_value(value: str, label: str, required: bool = False) -> str:
    candidate = value.strip()
    if not candidate and required:
        raise LdapProfileError(f"LDAP 用户资料缺少{label}")
    if len(candidate) > 256 or any(ord(char) < 0x20 or ord(char) == 0x7F for char in candidate):
        raise LdapProfileError(f"LDAP 用户资料中的{label}格式不正确")
    return candidate


def parse_user_entry(user_id: str, entry: Any, config: LdapConfig) -> LdapUser:
    """title 形如 “工号,姓名,部门” 时优先从中取姓名和部门，否则用 displayName / department。"""
    title = _entry_value(entry, config.title_attribute)
    name = ""
    department = ""
    if title and "," in title:
        parts = title.split(",", 2)
        if len(parts) >= 3:
            name = parts[1].strip()
            department = parts[2].strip()
    if not name:
        name = _entry_value(entry, config.name_attribute)
    if not department:
        department = _entry_value(entry, config.department_attribute)
    name = _safe_identity_value(name, "姓名", required=True)
    department = _safe_identity_value(department, "部门")
    return LdapUser(employee_no=safe_user_id(user_id), name=name, department=department)


def _is_bind_error(error: BaseException, ldap_module: Any) -> bool:
    exception_root = getattr(getattr(ldap_module, "core", None), "exceptions", None)
    bind_error = getattr(exception_root, "LDAPBindError", None)
    return bool(bind_error and isinstance(error, bind_error)) or error.__class__.__name__ == "LDAPBindError"


def authenticate(config: LdapConfig, user_id: str, password: str, ldap_module: Any | None = None) -> LdapUser:
    """绑定 AD 并返回工号、姓名、部门。"""
    uid = safe_user_id(user_id)
    if not isinstance(password, str) or not password:
        raise LdapAuthenticationError("工号或密码错误")
    if config.mock:
        return LdapUser(employee_no=uid, name=f"{config.mock_name_prefix}{uid}", department=config.mock_department)
    ldap3 = ldap_module or _load_ldap3()
    connection: Any | None = None
    try:
        tls = None
        if config.use_ssl or config.start_tls:
            tls = ldap3.Tls(validate=ssl.CERT_REQUIRED, ca_certs_file=config.ca_cert_file)
        server = ldap3.Server(
            config.server,
            port=config.port,
            use_ssl=config.use_ssl,
            tls=tls,
            get_info=getattr(ldap3, "NONE", None),
            connect_timeout=config.timeout_seconds,
        )
        connection = ldap3.Connection(
            server,
            auto_bind=not config.start_tls,
            user=f"{config.bind_prefix}{uid}",
            password=password,
            receive_timeout=config.timeout_seconds,
            raise_exceptions=True,
        )
        if config.start_tls:
            if connection.start_tls() is False:
                raise LdapGatewayError("LDAP TLS negotiation failed")
            if connection.bind() is False:
                raise LdapAuthenticationError("工号或密码错误")
        connection.search(
            search_base=config.base_dn,
            search_filter=f"({config.account_attribute}={escape_filter_value(uid)})",
            search_scope=getattr(ldap3, "SUBTREE", None),
            attributes=[config.title_attribute, config.department_attribute, config.name_attribute],
        )
        entries = list(getattr(connection, "entries", []) or [])
        if len(entries) != 1:
            raise LdapProfileError("LDAP 用户资料不存在或不唯一")
        return parse_user_entry(uid, entries[0], config)
    except LdapGatewayError:
        raise
    except Exception as error:
        if _is_bind_error(error, ldap3):
            raise LdapAuthenticationError("工号或密码错误") from error
        raise LdapGatewayError("LDAP 服务暂时不可用") from error
    finally:
        if connection is not None:
            try:
                connection.unbind()
            except Exception:
                pass
