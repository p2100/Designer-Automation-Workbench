# 更新站点状态和正式域名

开发人员已把站点部署上线，或用户要求更新站点库中的开发/上线/下线状态时，使用本包 `site-status`。直接从本地 Agent 回传中央预览库，不需要 Harness、重新上传文件、审核任务或 Git 提交。

1. 从用户给出的准确预览 URL 识别项目，先运行 `node bin/designer-automation.mjs site-status show --url PREVIEW_URL`。支持 site-preview/current/preview 地址；只有中央库地址时指定 `--project PROJECT_ID`。核对返回站名、当前版本、Git 来源、状态和正式地址，不凭正式域名猜站点。
2. 用户已明确说明开发人员上线并要求登记时，直接执行 `site-status update --url PREVIEW_URL --status online --domain example.com --actor ACTUAL_PERSON --note ACTUAL_REPORT`。正式地址为 HTTPS 域名，无协议时自动补齐 HTTPS。Agent 从真实对话准备操作者、上线说明和参数，不要求用户填写 JSON，也不重复确认已授权的状态更新。缺少真实域名或不能识别准确目标时才询问缺失信息。
3. 状态支持 `development`（开发中）、`online`（已上线）、`offline`（已下线），也可使用对应中文。修改正式域名时重发当前状态及新域名。已上线必须填写正式域名；其他状态省略域名时保留原地址。开发人员明确提供实际部署的完整 Git SHA 时可加 `--commit SHA`，未知时不填，不能把站点库最新源码提交自动当成已部署提交。Git 源码地址仍由 git-source 流程维护，不能通过状态接口改写。
4. 程序保存私有请求后立即回传，检查返回 `status: updated`、真实状态与地址；中央预览库显示同一记录和“正式站点”链接，原预览、源码、审核、可下载权限和历史产物保留。开发中/已下线单独显示。已上线沿用中央库已上线锁定规则；下线或改回开发中不自动解除既有冻结。此流程不接管源码修改或解除负责人冻结。
5. 断网或结果未确认时保存本机请求，按返回的 `requestId` 使用 `site-status retry --url PREVIEW_URL --request status-ID` 重试；不要换 ID 重复创建历史。站点已被他人更新时先重新 show，核对新状态后再按真实意图更新，不覆盖旧起点。重试返回 `superseded: true` 时说明原请求曾同步、当前又有后续更新，不把旧请求结果说成当前状态。

该操作是开发人员/用户的上线事实登记，返回 `verification: developer-reported`；没有执行部署、DNS 或线上浏览器验收，也不将状态变更转成设计认可或共享经验。Agent 如需宣称线上可用，必须另有实际访问和运行时证据；HTTP 200 不能代替完整验收。没有明确上线事实时不能因为 Git 推送成功自动标记已上线。

## 调用电脑 IP 与来源

连接、源码上传、Git接入和状态请求成功后，中央库自动记录本次实际 socket IP、电脑名、工作台版本、首次/最近使用时间和最近操作。新版包自动附电脑名/版本；旧版仍记录实际 IP。使用 `site-status clients --url PREVIEW_URL` 查询准确本站的记录，现有站点授权自动复用，无需填写 IP。状态更新的 report.client 和原始历史保留当次来源；重试不会改写原操作电脑。调用记录存于中央私有目录，不在公开站点列表或下载包内显示。

IP 来源是服务端实际连接地址，忽略客户端填写的 IP、X-Forwarded-For 和 Forwarded；经过 NAT 或代理时可能只能看到出口地址。电脑名和版本为客户端自报，不能当作身份认证。只有实际连接中央库的使用会被记录，不探测离线或仅本地生成的电脑。若调用记录存储暂不可用，返回 clientTracking=unavailable，已经完成的站点操作仍如实返回成功；Agent说明记录状态，不重复执行已完成的业务写入。
