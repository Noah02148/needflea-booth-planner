# OSS 云端场地库部署

网页仍由原 GitHub Pages 提供，`cloud/` 是单独部署的 Node.js HTTP 接口，不随静态网站运行。只发布前端代码不会自动开通云存储，也不会搬迁浏览器数据。

2026-11-17 部署状态：已创建上海私有 Bucket `needflea-booth-planner` 和 FC Web 函数 `needflea-cloud-library`，执行角色 `needflea-cloud-library-fc` 仅授权场地库目录。真实 OSS 保存、重新读取、活动恢复及幂等提交已验收；未登录的场地库请求返回 401。正式域名 `https://booth-api.pbrick.cn` 的 CNAME、证书及 FC 路由已完成，本地 `cloud-config.js` 已切换为此地址；前端通过主分支的 GitHub Pages 发布。云端保留一份标记为“云端连接验收”的小型实测示例，并已按用户的新建操作保存武汉场地及首个活动。真实项目的场地基础、完整活动、底图和 108 个标注均已逐项读回校验，页面载入正常；尚未搬迁浏览器整库。首次上传曾出现 503，重试未复现，原因尚未确认；接口补充了不含原始 SDK 消息的错误类型与处理阶段，供后续定位。

## 正式 API 域名接入进度

正式接口为 `https://booth-api.pbrick.cn`。2026-11-17 用户切换到域名管理账号后，已新增 `booth-api` 的 CNAME，指向下表 FC 入口，TTL 10 分钟、默认线路、启用状态；`dns29.hichina.com` 和 `dns30.hichina.com` 两台权威 DNS 均已读回验证。已有证书均无有效匹配，经用户同意 Let’s Encrypt 订户协议 v1.8 后，已完成 DNS-01 验证并取得免费证书。用户已在 FC 原账号 `1391519769809187` 完成私钥上传和域名创建。DNS 管理账号与 FC 部署账号不同，后续更新需注意账号归属。

证书覆盖 `booth-api.pbrick.cn`，签发者为 Let’s Encrypt YR1，有效期至 **2027-02-15 03:42:03 UTC**。已检查 SAN、有效期及私钥匹配；本机证书材料位于仓库外 `~/.config/needflea-cloud-tls/booth-api.pbrick.cn/`，目录权限 0700、私钥 0600。`fullchain.pem` 为证书链、`privkey.pem` 为私钥，禁止复制到仓库、前端配置或日志。当前为手工 DNS 验证，**尚未配置自动续期或自动部署**，到期前需重新验证、签发并更新 FC 证书。DNS 验证 TXT 已发布，未删除其他记录。

FC 已创建：`/* → needflea-cloud-library / LATEST` 路由、强制 HTTPS、手动证书名称 `needflea-booth-api-20261117`。为兼容表单要求，仓库外另生成 0600 权限的 `fc-privkey.pem`（同一 RSA 私钥的传统 PEM 格式），已通过完整性检查；私钥上传和最终创建由用户完成。真实域名验收通过：可信 TLS 且线上证书指纹与本机证书一致，健康检查 200、未登录场地库 401、HTTP 跳转 308、允许来源的 CORS 预检 204、其他来源 403。已通过正式域名读取武汉活动的全部 108 个标注，实际前端云端客户端也已验证恢复 OSS 项目。

已配置的接入参数：

| 项目 | 值 |
| --- | --- |
| DNS 主机记录 | `booth-api` |
| 记录类型 | CNAME |
| 记录值 | `1391519769809187.cn-shanghai.fc.aliyuncs.com` |
| FC 地域 / 函数 | `cn-shanghai` / `needflea-cloud-library` |
| 路径 / 版本 | `/*` / `LATEST` |
| HTTPS | 证书须覆盖 `booth-api.pbrick.cn`，启用强制 HTTPS |

仅为 API 子域增加记录，不更改主域 NS、网站 CNAME 或其他解析；未开通付费证书订阅。`cloud-config.js` 已在上述真实验收通过后切换为正式接口，缓存版本已更新。旧临时地址的浏览器会话不会自动迁移，刷新新版后需重新登录。参考：[FC 自定义域名配置](https://help.aliyun.com/zh/functioncompute/configure-custom-domain-names)。

## 使用方式

打开「场地与文件 → 选择场地」，团队部署默认进入云端。未配置接口的独立部署可点击「返回云端」，填写已部署的 HTTPS 接口地址与云端访问密码。当前版本是一个团队共用的私有场地库；知道该云端密码的使用者可读写其中全部场地，没有独立成员角色。登录有效期为八小时，密码不同于网页原有的访问口令。配置好 `cloud-config.js` 的公开 API 地址后，新设备默认进入云端场地库并隐藏地址设置，只需登录即可选择团队场地；本机场地入口收在「更多管理」，供历史数据迁移或离线布置；进入后可点击「返回云端」。团队部署刷新后默认回到云端，未配置云端接口的独立本地部署仍可直接使用本地库。刷新后有效会话自动恢复，过期时显示登录界面，不把云端失败冒充本地保存成功。若部署地址变更，旧地址会话不可复用，需重新登录。

云端模式下，场地和活动的保存均写到 OSS；保存成功后另一设备刷新云端列表、载入对应活动即可读取。切换本地 / 云端不会替换画布；明确载入其他活动时沿用未保存检查。顶部「保存」仍是下载项目 JSON，并不等于保存云端活动。

在**原来保存过数据的浏览器与本地网址**登录云端，点击「更多管理 → 上传本机场地库」。它将该网址下已保存的所有场地、基础及活动一起上传，保留本地记录；同名场地创建副本，完全相同的再次迁移跳过。尚未保存的画布不包含在整库迁移内，请先保存为本地活动或另存 JSON。浏览器不能跨网址读取 IndexedDB，所以不能从线上页面直接读出 localhost 的历史数据。

## 1. OSS 和 RAM 角色

需要 Bucket 名称、地域（如 `cn-shenzhen`）以及一个运行接口的 FC Web 函数。优先使用与 Bucket 同地域的 FC。需要在用户自己的阿里云账号中完成部署，不能仅凭 Bucket 名称获取访问权限。

Bucket 使用私有读写；推荐为本工具使用专用 Bucket，初始不启用版本控制。本实现依赖 `x-oss-forbid-overwrite` 原子创建下一版本；已启用或暂停版本控制的 Bucket 会被接口拒绝，因为 OSS 在这种情况下忽略禁止覆盖头。**不要为此关闭已有业务 Bucket 的版本控制**，应另用合适的专用 Bucket。依据：[PutObject 官方说明](https://help.aliyun.com/zh/oss/developer-reference/putobject)。

给 FC 配置可扮演的 RAM 执行角色，将 [ram-policy.example.json](ram-policy.example.json) 中的 `YOUR_BUCKET` 替换成实际名称后授予角色。若修改 `OSS_PREFIX`，同步修改策略中的目录限制。不需要列出其他 Bucket、删除对象或访问其他业务文件的权限；角色信任服务使用 `fc.aliyuncs.com`。默认只操作 `needflea/library/` 目录。

## 2. 配置云端访问密码

在本机仓库目录运行：

```bash
npm ci --prefix cloud --ignore-scripts
node scripts/configure-cloud-auth.mjs /仓库之外已有目录/cloud-auth.env
```

交互输入两次至少 12 字符的密码，不显示输入。文件仅本人可读写，已有文件不会覆盖。不要把此文件、密码或 OSS AccessKey 放入网站目录。将文件中的两项值填入 FC 环境变量，**去掉值外围的单引号**。访问密码由使用者保存，网页每次登录发送给 HTTPS 接口校验，不写入项目或 IndexedDB。

## 3. 创建 FC Web 函数

```bash
node scripts/package-cloud.mjs
```

脚本在系统临时目录生成 ZIP，根目录包含 `bootstrap`、三个服务模块、package 文件和官方 OSS SDK；不包含网站文件、样本或密钥配置。

在 FC 控制台创建支持 Node.js 20+ 的自定义运行时 Web 函数，上传 ZIP；启动命令使用 `sh bootstrap`，监听端口为 `9000`，超时建议 `180` 秒、内存建议 `512 MB`。上传文件的根目录应直接看到 `bootstrap`，不是外层 `cloud` 文件夹。配置执行角色、网络访问 OSS 的能力以及以下环境变量：

| 变量 | 值 |
| --- | --- |
| `OSS_BUCKET` | 你的私有 Bucket 名称 |
| `OSS_REGION` | 如 `cn-shenzhen`，也接受 `oss-cn-shenzhen` |
| `OSS_PREFIX` | `needflea/library/` |
| `CLOUD_PASSWORD_HASH` | 配置工具生成的 `scrypt$…` 值 |
| `CLOUD_SESSION_SECRET` | 配置工具生成的随机值 |
| `CLOUD_ALLOWED_ORIGINS` | `https://booth-planner.pbrick.cn,http://127.0.0.1:3002,http://localhost:3002,http://localhost:3000` |

本地若使用其他端口，追加完整来源地址。FC 的临时 OSS 凭证通过其运行时请求头或环境提供，不配置前端 AccessKey。不要将 FC 凭证头信任机制用于未经 FC 网关保护的公网 Node 端口。依据：[FC 上下文](https://help.aliyun.com/zh/functioncompute/context-and-log-format)、[FC 环境变量](https://help.aliyun.com/zh/functioncompute/environment-variables)。

启用 HTTPS HTTP 触发入口，映射域名根路径，允许 `GET` / `POST` / `OPTIONS`，让浏览器请求能到达本接口。云端库登录由本接口处理；不把阿里云请求签名密钥放入网页。可使用 FC HTTPS 地址验证，或映射自己的 API 子域名；不修改原网站域名及 CNAME。接口路径为 `/health`、`/session`、`/library`、`/project/…` 和 `/commit`。

配置完成后，访问 `/health` 确认服务响应；这**只证明接口进程在运行**。再在网页登录、保存一个临时场地，在另一浏览器载入，才能验收真实 OSS 读写。未经登录的 `/library` 必须返回 401。

## 4. 连接网页与迁移

将 `cloud-config.js` 中的 `window.NEEDFLEA_CLOUD_API_URL` 设置成真实 HTTPS 接口根地址后发布前端。它是公开地址，不是凭证。也可以先在网页「云端连接设置」输入地址验证，不需要改代码。

依次在原本地网址与线上网址使用同一接口和云端密码登录。在原本地网址执行整库上传；线上刷新云端场地库，选择活动载入。只有登录、上传完成后，历史本地记录才会出现在云端。

## 保存与失败处理

- 每次保存先写入带 SHA-256 校验的私有项目文件，再原子创建下一份索引。CAD、地面材质和照片独立压缩去重；本次失败不会覆盖原索引。历史索引及引用资源保留，存储使用量会随修改增加，不能按文件年龄直接清理仍被引用的对象。
- 两台设备从同一版本保存时只有一份成功，另一份提示冲突。先导出未保存画布备份，再刷新云端、载入最新活动后处理差异，不自动覆盖。
- 网络中断导致结果不明时，使用「确认上次保存」，重用原操作 ID，不生成第二份提交。「刷新云端」可以查看已经保存的结果；刷新不会替换当前画布。
- 应用每次上传限制为压缩后 24 MB、原始 JSON 100 MB；还须符合所选 FC 入口上限。大量照片或整库超限时，应先减小照片或分别导出活动再分批创建。当前整库按钮一次提交全部本地记录。
- 当前不支持云端删除、成员权限或实时协同。退出登录只清除本机令牌；如需使所有已有令牌失效，轮换 `CLOUD_SESSION_SECRET`。不对外记录密码、OSS 凭证、签名 URL 或原始 SDK 错误。

## 验证

```bash
# 静态页面已运行时
NEEDFLEA_URL=http://127.0.0.1:3002 node scripts/check-cloud-library.mjs
```

测试使用真实 OSS 适配代码和原子模拟存储，不连接阿里云、不产生费用。覆盖鉴权、CORS、并发保存、幂等重试、重启恢复、资源去重、本地迁移、双浏览器共享及手机布局。真实 Bucket / FC 尚未配置时，不把这些测试描述为真实云端验收。
