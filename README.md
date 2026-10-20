# 老兵说

分组核心网控制开发部的老兵展示与交流申请网站。新员工浏览老兵的履历、成长路径和奖项，提交交流申请；部门助理安排时间地点，并发邮件通知双方。

## 一键部署

服务器上只需要 **Python 3.8+**，不需要联网，也不需要 pip（ldap3 已随项目放在 `vendor/`）。

**Linux**

```bash
sudo ./deploy.sh
```

用 root 运行会注册 systemd 服务并开机自启；非 root 则在后台启动。

**Windows**

右键 `deploy.cmd` →“以管理员身份运行”。会注册开机自启的计划任务，并在防火墙放通端口。

完成后浏览器访问 `http://服务器IP:8095`。**第一个登录的人自动成为助理**，所以部署好后请助理本人先登录。

其他命令：

| 操作 | Linux | Windows |
|---|---|---|
| 重启 | `sudo ./deploy.sh restart` | `deploy.cmd restart` |
| 状态 | `sudo ./deploy.sh status` | `deploy.cmd status` |
| 卸载（保留数据） | `sudo ./deploy.sh uninstall` | `deploy.cmd uninstall` |

指定 Python：Linux 用 `PYTHON=/path/to/python3 sudo -E ./deploy.sh`，Windows 先 `set PYTHON=C:\路径\python.exe`。
AI 训战平台发布包自带的 `runtime/python` 也可以直接用。

## 配置

首次部署会自动从 `.env.example` 生成 `.env`。默认值就能用：

- `PORT`：端口，默认 8095
- `LDAP_*`：与 AI 训战平台 ldap3-gateway 的配置项和默认值完全一致，如有改动照抄平台 `.env` 即可
- `LDAP_MOCK`：本地试跑用，`true` 时任意密码都能登录。正式环境保持 `false`

改完配置后执行“重启”。

## 示例数据

```bash
python3 server.py seed-demo
```

导入 8 位示例老兵（仅当还没有老兵时）。正式使用前可在助理入口删掉。

## 使用

- **浏览**：不用登录。
- **申请交流**：用域账号工号和密码登录，申请人姓名、部门从 LDAP 读取。
- **助理入口**：只有助理登录后可见。
  - 交流申请：填写时间地点、修改状态（待安排 / 已安排 / 已完成 / 已取消），“复制邮件”生成通知邮件正文，粘贴到 Outlook 发给双方。
  - 老兵信息：新增、编辑、删除。照片、类别、标签、职务、成长路径、获得奖项、可聊话题、每月可约次数等。
  - 类别与标签：改名会同步到所有老兵；删除标签会从老兵身上去掉；还有老兵的类别不能删。
  - 助理：按工号添加或移除，至少保留一位。
- **每月可约次数**：每个自然月最多收到这么多条有效申请（不含已取消），约满后显示“本月已约满”。

## 备份

全部数据都在 `data/`（数据库 `laobing.db`、照片 `photos/`、会话密钥 `secret.key`）。定期复制这个目录即可；恢复时停服务、覆盖、再启动。

## 结构

```
server.py        后端：Python 标准库 HTTP 服务 + SQLite，同时提供前端页面
ldap_auth.py     LDAP 登录，逻辑与 AI-Training-Platform/services/ldap3-gateway 一致
web/             前端（index.html / app.js / style.css / login.html），无需构建
vendor/          ldap3 2.9.1（LGPL-3.0）和 pyasn1 0.6.4（BSD），纯 Python
deploy.sh/.cmd   一键部署脚本
demo.json        示例老兵
docs/prototype.html  早期纯前端原型
```
