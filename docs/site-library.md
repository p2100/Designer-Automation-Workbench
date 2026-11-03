# 本地站点上传中央库

设计师确认上传，代表人工审核已经完成。首次只询问：**“是否上传当前版本到中央站点库，并标记为人工审核通过？”** 用户对该版本确认后直接上传，库中标记“人工审核通过”并开放下载；不再运行页面、视觉、规则审核，不补 coverage 或 handoff。已有明确等价的确认不重复询问，同版本上传重试复用确认。

## Agent 连接与准备

使用 `node bin/designer-automation.mjs library connect --url <库中预览URL>`；库首页地址需附准确 `--project`。直接连接内网中央站点库，不用 Harness、登录或浏览器配对，连接凭据仅保存在本机私有目录。更新目标必须是库中准确站点。新站使用下面的 prepare-new/push，直接连接中央库，不依赖 Harness 或 dsh_web 登录。

需要获取源码时可使用 `library pull --url <库地址> --project <ID>`。设计师已经制作好的本地成品不需要为上传创建审核任务：

```sh
node bin/designer-automation.mjs library prepare --url <库地址> --project <ID> --id <上传ID> --source <可编辑源码目录> --artifacts <已生成页面目录> --site-type <coupon或app或games>
```

Agent 按真实项目选择目录和站型；成品目录须直接包含本站实际首页及资源，不能选择另一站或整包父目录。prepare 仅把现有文件冻结为上传版本，不安装依赖、不执行构建脚本、不启动浏览器或审核。源码必须保留库中受保护的数据、运行资源、依赖和构建配置；更新以已连接版本为基线，服务端发现其他修改会停止覆盖。私有 `--data` 目录放在源码与成品之外。

0.13.2 在冻结及新上传前，只读检查实际 HTML 和已引用 CSS 的本地目标是否齐全、放入中央版本前缀后是否仍指向本站。根目录 `/assets/`、`/en/` 等会逃离版本目录的引用必须从源码修复，不能在服务根添加跨站别名，也不能直接修改冻结成品。该文件完整性检查不启动页面审核、不增加设计师确认；已成功的准确版本只重放历史回执。动态脚本、实际加载、交互与配色仍须由本轮有授权的真实预览验证，不能把静态检查当作视觉通过。

当本轮有设计师修改要求，Agent准备一份内部反馈文件并执行 `library feedback --id <上传ID> --file <反馈文件>`；不要求设计师填表。字段为 `candidate`（prepare返回的准确哈希）、`actor`、`text`（设计师实际原话）、`items`（数组，每项含 `quote` 原话连续片段、`summary`、可选 `pages` 页面族数组和 `component`）。不要将“上传”确认或源码变化编造成修改原话。程序先在私有目录可靠保存站点、基线、候选及原话，再把已定位页面的逐项未分类事实排入经验服务队列；`queued` 不代表已共享或复验。页面未知时本地保存并返回 `pending-location`，定位后补录；入队中断时下次本机MCP启动会从完整记录恢复并补传。均不阻塞上传、预览或另加整站审核。

已有工作台候选可使用 `library bind --url <库地址> --project <ID> --id <任务ID>` 后直接 `library push --id <任务ID>`。无论它的自动检查、coverage、handoff 状态如何，上传只请求本次人工确认，不要求补做审核。

## 一次确认并上传

prepare 或未确认的 push 返回 `confirmation-required`、准确 `candidate` 和询问文案。Agent 把当前成品及目标站点对应清楚后向设计师询问；已存在对该版本的明确“上传并标记审核通过”授权时直接记录，不再问一次。不能将普通“已看到”、连接成功、默认选项或本流程说明充当某个站点的确认。

确认文件由 Agent 内部准备，设计师只需自然语言答复：

```json
{
  "decision": "approve",
  "candidate": "prepare或push返回的当前候选哈希",
  "actor": "实际确认人",
  "text": "实际确认上传的原话",
  "at": "真实确认时间，ISO格式"
}
```

`library push --id <ID> --file <实际确认文件>` 保存确认后直接上传。没有自动检查也可上传；仅核对文件完整性、可移植本地引用、站点身份、源码起点、受保护路径和版本冲突。确认不伪造工作台自动检查结果或原生审核报告，不产生虚构修复经验。普通 workbench approve 不替代首次上传授权；已记录上传确认后后台回传可以复用它。

服务端支持 `human-upload-approval-v1` 才会发送新协议；旧服务需要升级，已记录的确认保留。返回 `uploaded`、`reviewStatus: approved`、`downloadable: true` 和真实预览地址后，才能报告上传并审核通过。中央保留确认人、原话、时间、准确候选及源码/成品/ZIP指纹，目录显示“人工审核通过”，不再挂“待审核”。入库不自动部署到外部网站。

Agent 须打开实际中央版本链接，核对本轮代表页面与已确认预览一致、样式及运行入口可加载。该交付一致性核对不要求设计师重新审核或再次确认。若实际入口损坏，或用户继续否定当前稿，保留历史回执和确认，将本轮交付重新打开；不能继续把本地截图、文件指纹相同或首次回传耗时称为最终验收。

## 重试与版本变化

网络中断保留确认和原上传请求，执行 `library push --id <ID>` 用相同请求重试，不重复询问或新增版本。已成功的同版本重试返回原回执。源码或冻结成品变化时，先准备新的上传版本，再确认新版本；不得把旧确认挪给另一版本或站点。

中央出现并发更新时保留双方源码，拉取最新版本并合并；如果内容变化，针对实际合并后的版本确认上传，不要求因此补跑全站审核。旧客户端留下的待审核版本和历史记录不会被本次升级自动追认。`library status --id <ID>` 查看连接及当前版本差异，`library disconnect --id <ID>` 断开连接。

经验库仍使用原 designer_experience MCP；站点文件、图片和连接凭据不进入经验库。

## 新站直传（0.13.4）

原条目已被删除时，不恢复它，也不将旧确认默默转给新目标。用户已明确要求“推送一个新的”时，Agent 为当前成品选择新的项目 ID 和新的上传 ID，保留旧任务及确认记录。先从中央库 `/v2/designer-workbench/latest.zip` 获取当前版本；以 manifest 检查包完整性。

```sh
node bin/designer-automation.mjs library prepare-new --url http://192.168.12.9:4187 --project NEW_PROJECT_ID --slug SITE_SLUG --name SITE_NAME --id NEW_UPLOAD_ID --source SOURCE --artifacts BUILT_SITE --site-type games
node bin/designer-automation.mjs library push --id NEW_UPLOAD_ID --file ACTUAL_HUMAN_CONFIRMATION_JSON
```

prepare-new 仅冻结现有文件，要求真实首页（默认 index.html；可用 --home en/index.html）。源码、成品和新目标身份一起形成候选指纹；确认只用于准确候选和目标，已有对该新目标和准确版本的等价授权可复用，不重复询问。没有准确授权时仍须取得一次真实上传确认。文件完整性和版本目录内的相对引用必须通过；不启动页面审核、经验写入或业务验收。

服务端原子创建独立条目，保存源码和成品，标记人工审核通过并提供预览与 ZIP 下载。ZIP 内 source/ 为原源码，site/ 为可预览成品。不会执行上传源码里的脚本；后续继续在设计师本地构建，使用 library prepare/push 更新同一条目，或 library pull 取回源码。服务端 Harness 快速改造按钮不会冒充已支持的构建方式。

网络中断后以同一上传 ID 执行 library push，复用持久化请求、确认和中央回执，防止重复新建。已有项目 ID 一律拒绝覆盖；已成功后被删除的条目也不会由重试恢复。目标或内容改变时建立新准确候选，不覆盖未完成的请求。上传结果须真实返回 uploaded、approved、downloadable 和中央预览地址；Agent 打开该版本核对样式及入口的交付一致性后再报告。

## 正式 Git 源码（0.14.0）

要求建仓或推送源码时使用 [Pug Git 流程](../core/git-source.md)。正式接入后不再使用旧 `library pull` 设计包；用 `git-source prepare` 取得最新正式源码及未提交改稿，`verify/capture` 更新中央预览，最后统一提交并 `publish`。获取中央库连接与更新下载仍无需 Harness。
