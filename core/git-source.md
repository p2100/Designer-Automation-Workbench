# 在自己的 Agent 中接入 Pug Git 源码

用户要求把站点接 Git、创建源码仓库、推送 Pug 或回写站点库源码地址时，走本流程。无需安装、登录或打开 Harness；直接使用本包 `node bin/designer-automation.mjs git-source` 和中央站点库地址。首次只需用户提供准确站点或预览 URL，Agent 识别项目。支持 `/v2/site-preview/ID/…`、`/v2/current/ID/…`、`/v2/preview/ID/…`。

## 一次准备，持续调整

1. 调用 `git-source prepare --url PREVIEW_URL --id PLAN_ID`。自动连接同一中央站点库、取得准确版本/路由/冻结预览、准备本机隔离工程。没有仓库默认按中央库配置的组织和站点 slug 新建**私有仓库**。已有正式 Git 来源则直接克隆并保留其历史，不再转换旧 HTML 包。模板可用 `--template /absolute/site-template` 指定；否则自动缓存准确模板仓库与提交。只对首次接入准备一次，后续复用同一计划和源码。
2. 新建仓库使用本机已有 GitHub 登录及组织权限。程序默认调用 `gh`；Agent 若已有自己的 GitHub 工具，可先创建返回的准确私有仓库，再用 `--repository-ready true` 准备。此参数不跳过中央库的私有状态、真实远端和源码核对。只有 SSH 推送权限不代表拥有建仓 API 权限；缺失时如实说明，不复制维护者凭据，也不把认证失败当作“仓库不存在”。已有正式来源的日常调整只需正常 Git 访问，无需 gh。
3. 阅读 prepare 返回的计划 `AGENTS.md`、`input/` 与准确预览。`input/` 不可修改，`project/` 为可编辑工程。按原页面族拆成 `template/common`、`components`、`pages`，保留原数据、素材、样式、交互 hooks 和页面职责。禁止 HTML 改后缀、整页 include/unescaped HTML、iframe 原站和旧 offline.js 包装。Pug 首屏与客户端使用同一规范化数据。只读本次必要文件，不扫描其他工程或重复准备。
4. 保留准确 site-template 的 index.js、pug-site-core 范围及四项真实构建命令。写 `docs/site-git-source.json`（prepare 返回完整字段示例），映射全部原路由到实际 Pug 与产物，声明国家键、首页和数据。当前 core 3.0.36：`get_*_data(language)` 保留 language 形参；动态 `page_name` 带 `.json`；us 为构建国家键，英文 `html(lang='en')`；首页 `staticSites/us/index.html`，资源在 `staticSites/static/`，链接按深度处理。
5. 安装依赖使用本计划私有缓存：在 `project/` 运行 `npm install --cache ../npm-cache --no-audit --no-fund`，保留实际锁文件。运行 `git-source verify --id PLAN_ID`：实际执行 getData、compileFn、buildFn、buildStatic，核对全部路由。源码或产物改变后重新验证。实看桌面、手机、深层页面、图片/字体与代表交互；构建成功不冒充视觉认可或全站运行时验收。
6. 中途只改源码和更新预览，不自动提交。已登记正式 Pug 源码后，验证当前修改，再运行 `git-source capture --id PLAN_ID` 将本轮源码与真实产物回传中央库，直接返回新预览，不要求 Git 提交。新候选状态为未审核，保留旧版及其真实认可；不能把局部改稿自动写成整站认可。后续继续同一计划改稿，最后统一提交发布。另一位设计师准备时会取得中央库尚未提交的最新 Pug 改稿；若 Git 和改稿同时有新更新，先三方合并，不能覆盖。未接 Git 的普通站点调整、确认上传仍使用 `library` 与 `core/maintenance.md`。Git 登记本身不改变当前预览、人工审核和历史。`git-source status --url URL` 返回准确来源。

## 最后统一提交、推送、登记

7. 加载 `penny-git-traceability`（优先本机最新技能；未安装时读取随包 `.agents/skills/penny-git-traceability/SKILL.md` 完整快照，Penny MCP 使用设计师自己的授权连接），解析准确有效任务；未指定先查 assigned_to_me、related_to_me 和范围搜索，无准确任务则创建。已有用户授权不重复询问。缺少 Penny 能力时不伪造任务。只在实际 `project/` 初始化/操作 Git，先确认 `git rev-parse --show-toplevel`，不要误把父目录作为仓库。新仓默认 `htmlFun_dev`；已有来源保持真实分支和历史。排除编译产物、依赖、缓存、私有配置，暂存检查至少 `git diff --cached --check`。
8. 全部改完后创建一次授权提交，精确 trailer `Penny: TASK_ID`。核对完整提交 SHA 和提交信息，写入 Penny 开发记录。运行 `git-source publish --id PLAN_ID`：推送准确分支，核对远端 SHA，并向中央库登记。若已由 Agent 推送，用 `git-source register --id PLAN_ID`。程序不会替 Agent 创建未关联 Penny 的提交。
9. 中央库核对准确项目/版本、真实 Pug 结构、四项客户端构建回执、私有仓库、分支、远端 Git 对象中的完整源码、Penny trailer 和原历史后，登记源码快照、Git 地址、提交与 `git-connected` 状态。中央库不执行上传来的代码。连接令牌只保存在本机私有 `.designer-data`，限定本站和 Git 用途；不经 Harness，也不进入源码/分发包。断网后源码和待登记记录保留，同一 `publish/register` 可幂等重试；他人更新或冻结会拒绝旧起点，必须先合并。
10. 记录最终远端与登记回执到 Penny，分别报告 Pug 构建、浏览器实看、Git 推送、中央库回写和域名部署。Git 接入不部署域名、不修改 DNS、不扩大设计认可、不写共享经验。不得声称别的设计师电脑已更新或已通过，除非真实验证了该机器/版本。
