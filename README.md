当前统一维护入口支持 Coupon / App / Games。设计师接入与中央经验流程见 [设计师接入说明](docs/designer-quickstart.md)，Agent 执行先读 [统一质量入口](core/site-quality.md)。公共方法共用、专项隔离，新增 Games 标准与只读检测器随仓库交付；原 Coupon 生成快照保持。

三类站点新建、授权重做和参考重建使用 `node bin/designer-automation.mjs generate` 统一入口，由 Agent 识别类型、创建工作区、加载规则和适用经验，再调用实际 Image、编码和浏览器工具完成站点。详见[站点生成默认流程](core/generation-default.md)、[视觉创作方法](core/creative-generation.md)与[设计师创作学习方法](core/creative-learning.md)。设计师明确的实际创作反馈先保存在本机，再自动排队同步为中央团队创作参考；Agent 实际查看满意稿件后，提炼布局、留白、配色、组件等文字观察，绑定稿件指纹；后续按站型和页面读取并判断适用条件。团队经验库不存稿件图片。参考不是强制规则；断网或旧服务时保留并重试。

# Designer-Automation

面向设计师与 Agent 的站点审核、修复和共享经验工程，维护组织为 [p2100](https://github.com/p2100)。

**新站源码 → 全站规则与视觉验收。**

**设计师调整 → 快速修改 → 立即预览 → 局部复验与设计师确认 → 后台沉淀中央经验。**

**本地成品上传 → 首次询问是否上传并标记人工审核通过 → 确认后直接入库、可下载。上传不启动页面检查，也不要求补齐审核任务。** 见[上传流程](docs/site-library.md)。

项目版本 **0.12.2**；Games 专项规则包为 **3.2.11**，原 Coupon 生成规则快照固定为 **2026-10-26.1**。中央经验服务版本独立，以实际健康检查为准；原话检索工具需要服务端升级。正式仓库：[p2100/Designer-Automation-Workbench](https://github.com/p2100/Designer-Automation-Workbench)。

正式交付入口已迁入 p2100 组织。GitHub 阻止旧仓库直接转移，且 `p2100/Designer-Automation` 同名地址被占用但不可访问，因此采用 `Designer-Automation-Workbench` 仓库名，保留原项目名称与完整 Git 历史。旧个人仓库仅保留历史入口；后续更新以本组织仓库为准。

## 设计师开始使用

需要 Node.js **22.19+**、Git，以及能访问共享服务所在的内网。实际审核还需要宿主 Agent 可用的浏览器；项目不附带浏览器二进制。

```sh
git clone https://github.com/p2100/Designer-Automation-Workbench.git Designer-Automation
cd Designer-Automation
npm ci
npm run connect
```

重启 Agent 的 `designer_experience` MCP 连接。Codex 的项目配置需在受信任项目中加载；其他 Agent 执行 `npm run connect -- --client generic`，使用生成的 `.designer-data/mcp.json` 配置本地命令／stdio MCP。

随后直接告诉 Agent：

> 先读取 AGENTS.md、core/maintenance.md 和 core/experience.md。拉取我提供的站点 Git 仓库，按规范审核、集中调整并给我查看；我提出问题就继续调整。我确认当前版本没问题后，筛选已验证、可复用的经验，在准确范围内共享。一次性内容或原因未明的反馈不要强行变成规则。

站点配置、修复记录、检查证据和经验字段由 Agent 准备，不要求设计师手填 JSON。只提供预览 URL 时可以审核；自动修复前仍须取得对应源码。新连接可先列工具和查询经验，连接成功不等于任何站点通过验收。

### 已有克隆更新

已有克隆先将远端切到组织仓库，再更新：

```sh
git remote set-url origin https://github.com/p2100/Designer-Automation-Workbench.git
git pull --ff-only
npm ci
npm run connect
```

再重启 MCP 连接。日常反馈与经验同步不需要 Git 提交、手动 sync 或维护者发布。

## 直接交给设计师 Agent 的指令

设计师把下面这一段发给自己的 Agent 即可，首次接入由 Agent 执行安装和配置：

> 请将 https://github.com/p2100/Designer-Automation-Workbench.git 克隆到 Designer-Automation 目录，按 README 和 docs/designer-quickstart.md 安装 Node 22.19+ 所需依赖，运行 npm run connect，为当前 Agent 配置 designer_experience MCP。先列出四个经验工具并做只读连接检查；需要重启连接时明确告诉我。接入完成后等待我提供站点 Git 地址或本地源码。收到站点后先读 AGENTS.md、core/maintenance.md 和 core/experience.md，沿用同一工作区审核、调整、增量复验，并给我预览。我提出问题就继续调整；我明确确认当前候选没问题后，自动筛选、归并并共享已验证的可复用经验。不要替我编造认可，不要把临时文案或原因不明的问题强行变成规则，不让我手动 sync 或发布经验。

维护规则已统一交付 **Coupon、App、Games**：公共方法共用，专项快照按实际站型加载。原 Coupon 生成仍走其冻结入口；MCP 共享经验继续原有准确候选确认与离线补传流程。

## 三个模块的边界

| 模块 | 入口 | 职责 |
| --- | --- | --- |
| 原生成流程 | `bin/da.mjs` | 选择、冻结与执行原生成规则，保留既有生成、独立审核和交付门禁 |
| 站点维护 | `bin/workbench.mjs` | Git 拉取或本地源码隔离导入、审核、修复、增量复验、稳定预览和设计师反馈 |
| 共享经验 | `bin/experience-mcp.mjs` → 中央 MCP | 经验查询、可靠保存、证据归并、冲突处理、纠错和撤回 |

维护流程读取同一套适用规则，不替换原生成入口，也不回写原 Harness 工程。设计师认可由 Agent 如实记录；程序不能代替人审美判断或证明人确实看过页面。

## 审核与调整怎样提高效率

- Git 仓库或本地源码导入一次，后续沿用同一隔离工作区与任务；本地原件不自动回写。
- 同一页面、宽度和状态的检查合并访问，避免为每个检查重复打开浏览器。
- 新站验收保留完整规则、视觉与交互门禁；设计师后续用 adjust，构建后立即返回预览，recheck 只复验指定组件及真实调用位置。
- Agent 声明 pages、component、reason；页面专用 CSS 可按引用自动定位。未知范围由 Agent 定位，不默认扩大全站。全局字体/布局的实际影响另行说明并回归。
- 调整只处理相关检查，静态局部证据不因30分钟过去而失效；无关页面外部资源与旧记录不拖住本轮。全站验收的完整门禁保持。
- 预览复用稳定地址，切换到最新候选；设计师继续反馈时不另起整轮任务。
- 认可和经验先本地可靠保存，后台通过同一中央 MCP 补传；待传如实报告，网络等待不阻塞设计师。

候选版本、证据和认可必须对应。未检查、证据过期或版本不一致，不能填写通过。命令与配置说明见[独立维护工作流](docs/standalone-workbench.md)。

## 共享经验怎样保持清晰

案例保留事实，可复用结论单独维护。经验是辅助方法，不能覆盖版本化业务与设计硬要求。

1. **先筛选。** 只提炼问题、原因和预防方法都明确的已验证结论；一次性文案、偶发数据或未知根因可记录具体 skip 理由。
2. **先检索。** 同类原则复用稳定 key 和规范表述；重复案例补充证据，不堆叠多条同义规则。语义比较由执行任务的 Agent 完成，服务端不声称理解任意相似表达。
3. **限定范围。** 明确实际受影响的检查、页面、组件、触发条件和例外，不把一页经验挂到整个任务。
4. **谨慎复用。** 已确认、复验的可迁移结论可作为同站型、同页面的参考，Agent 按组件和条件判断；相同原则经至少两个可核验的独立站点验证后才自动激活通用经验。ZIP 本地来源不计入独立站点数量，单站风格偏好不推广。
5. **能够纠错。** 矛盾结论保留待处理；撤回或替换带版本校验和历史。旧错不能靠换名重新生效，失效的来源证据不能继续支撑通用结论。

完整约定和字段示例见[经验维护规则](core/experience.md)。

## MCP、持久化与断网补传

```text
设计师 Agent / workbench
          ↓ 本地 stdio MCP
    缓存、待传记录、后台监督
          ↓ 中央 MCP
       MongoDB 共享存储
```

中央服务为 **http://172.18.188.6:4381/mcp**。普通内网调用免 Token；数据库凭据和备份管理凭据留在服务器，不分发给设计师。设计师统一使用 connect 生成的本地入口，它提供四个工具：

| 工具 | 用途 |
| --- | --- |
| `experience_search` | 查询适用结论，按站点、页面、组件和主题筛选 |
| `experience_capture` | 保存反馈或已确认的经验，归并有效证据 |
| `experience_manage` | 查看证据与历史、纠正或撤回结论及创作参考 |
| `experience_status` | 查看本机待传、拒绝和异常记录 |

确认与完整待传内容一起原子保存，之后才发送。断网时保留，恢复后自动补传；补传子进程异常退出由监督进程重启，坏记录隔离后其他记录继续。整机关闭后，下次 MCP 启动恢复。`queued` 表示尚未共享，只有当前适用结论有效时才报告 `shared=true`。

在线经验持久化于独立 MongoDB 库；本机 JSON 用于任务记录、缓存和可靠交付。已开始的审核任务固定经验快照，不因新经验或补传自动重跑审核。服务每 **6 小时**备份，保留 **30 天**；v2 备份包含案例、结论、撤回状态和历史，恢复先写入新集合再校验。

可直接转发给设计师的完整文档见[设计师接入说明](docs/designer-quickstart.md)，部署、备份和恢复见[运维说明](docs/experience-operations.md)。截图与修改前后证据的附件存储不在本项目实现范围。

## 规则覆盖与维护

`knowledge/index.json` 是实际适用范围与完成度的机器入口。当前所有 17 个页面族都有业务框架，共同质量底线持续适用；页面专项状态如下：

| 页面 | 专项细则状态 |
| --- | --- |
| `offer-detail` | active |
| `home`、`store-detail` | partial |
| 其他 14 个页面族 | pending |

这是规则覆盖状态，不是站点验收成绩；pending 不表示没有业务约束。

- `knowledge/imported`：上游规则的只读快照，不直接手工改写。
- `core`、`knowledge/pages`、`workflows`、`systems`：执行方法、页面入口、流程和工具适配。
- `compatibility/generation-baseline.json`：原生成规则与程序的兼容基线。
- `.designer-data`、`.codex/config.toml`：本机私有任务、连接和队列，排除于 Git 和分发 manifest。

正式规则升级须明确版本、修改所属源与索引，并审核更新快照、manifest 和兼容基线。不要运行原 Harness 的导出脚本覆盖本独立工程的新运行模块，也不要把共享经验静默升级成正式硬规则。

## 验证与当前边界

```sh
node bin/da.mjs check
npm run test:experience
```

包内容变更后由维护者运行 `npm run manifest` 更新完整性清单。完整性检查不能代替浏览器审核或设计师认可。

0.4.0 已通过 24 项经验服务验证，覆盖真实 MongoDB 并发归并、纠错撤回、确认后中断恢复、补传进程重启、坏记录隔离和备份恢复。MongoDB 集成用例需管理员的私有测试配置，未配置时会明确 skip；测试使用隔离数据，不向正式库写测试经验。

当前尚未进行真实业务站点联测，不能据此宣称任意站点或全部 Agent 已通过生成与验收。

本地 Agent 改造完成后回传原站点库，见[站点库连接与回传](docs/site-library.md)。Agent 直接连接内网站点库并核对准确站点，无需 Harness、登录或浏览器配对，后续确认的准确候选自动回传为待审核新版本，保留旧版本和原有发布门禁。
