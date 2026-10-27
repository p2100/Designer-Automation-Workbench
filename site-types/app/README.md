# App-Automation 1.1.0

独立的 App 站生成与审核规则包。站点首版内容为英文，覆盖 PC 和手机，支持现有 Android 安装包来源、官方应用商店导流及下载型手游。规则说明使用中文，技术标识保持英文。

## Agent 怎样使用

将整个目录交给 Agent，要求先读 [AGENTS.md](AGENTS.md) 和 [core/start.md](core/start.md)，再按 [knowledge/index.json](knowledge/index.json) 读取对应页面规则。无需依赖本机绝对路径、Coupon/Games 技能或另一段聊天。

可以直接说：

> 按 App-Automation 生成一个英文 App 站。先读 AGENTS.md，准备真实应用数据与站点结构，再完成首页方向、扩展页面和独立审核。默认不添加广告位；detail 的主获取按钮先到 version，再选择真实渠道。规则、数据、任务清单和审核记录由你准备，不要求我填写 JSON。先说明缺失资料和未执行项，不编造通过。

已有站只修改用户授权范围，保留原源码与成果；本包存在不构成重建旧站的授权。它提供规则和记录格式，不附带站点生成引擎、浏览器、安装包托管或 MCP 服务。没有自动接入现有共享经验库。

## 页面与主路径

| 页面族 | 状态 | 入口 |
| --- | --- | --- |
| 首页 home | 必备 | [首页规则](pages/home.md) |
| 文章 article | 必备 | [文章规则](pages/article.md) |
| 分类结果 category | 必备 | [分类规则](pages/category.md) |
| 应用详情 detail | 必备 | [详情规则](pages/detail.md) |
| 下载承接 version | 必备 | [下载承接规则](pages/version.md) |
| 搜索 search | 可选 | [搜索规则](pages/search.md) |
| 信息 information | About、Contact、Privacy、Disclaimer、404 必备 | [信息页规则](pages/information.md) |

主路径：发现/分类/文章 → detail → version → 真实渠道。detail 允许补充标注平台的官方商店直达。version 表示下载承接，URL 可采用 version 或 download，不代表必须有历史版本；真实历史版本、分类总览、Terms 按实际需要选用。

## 规则层次与维护

业务结构、数据真实性和可读性统一，品牌、构图、列数和侧栏自由。默认不添加广告位；参考站的广告空白、伪下载和无来源认证不进入规则。

- [公共质量](core/quality.md)：跨页面布局、图文、状态和品牌底线。
- [数据与获取渠道](core/data-and-channels.md)：应用身份、来源、平台、文件与截图。
- [逐板块内容](core/module-data.md)和[模块数据合同](contracts/module-data.json)：每页板块的具体字段、图片角色、选择/排序依据与动作关系。
- [生成与审核流程](core/workflow.md)：制作、冻结、独立审核和集中修正。
- [审核方法](core/review.md)：按规则 ID 展开检查、共享证据、记录未执行项。
- [参考核对](docs/reference-audit-20261026.md)：六站真实入口、观察深度及缺陷。
- [模块参考矩阵](docs/module-reference-matrix-20261026.md)：Banner、推荐卡、列表、更新、文章等的实测差异。
- [已确认方案](docs/rule-design-draft.md)与[决策记录](docs/confirmed-decisions.md)：规则来源和边界。
- [术语](CONTEXT.md)：detail、version、获取渠道等概念。

Markdown 中带 `APP-…` 的条款是规范正文；[规则清单](contracts/requirements.json)保存适用范围与证据索引，不复制另一份完整规范。索引与规范正文必须同步更新。`hard` 为适用时必须满足，`target` 为制作起点；`when` 表示条件，不允许用它回避实际存在的功能。参考观察不是硬要求。

规则升级应修改所属条款、清单、索引版本与变更记录，再检查引用与覆盖。既有候选保留冻结版本，不静默替换规则。用户最新要求决定范围；例外须写明原话、页面/模块与理由，不能借参考或偏好捏造事实。

[manifest.json](manifest.json) 列出本版本公开文件及 SHA-256，复制/冻结时核对完整性。更新公开文件后同步清单；不自动把运行记录、密钥、用户数据加入分发。哈希一致只证明字节一致，不证明站点通过审核。

## 当前覆盖与验证边界

七个页面族均有正式规则和对应检查 ID；这表示本包规则覆盖，不代表所有未来站点已通过。参考研究并非六站每个页面在所有屏幕上的完整像素验收，详见研究记录。后续生成仍须实际浏览器与独立审核。

本包尚未生成或联测真实业务站点；安装包可达、下载、完整文件、安装与安全检查是不同层级，记录仅支持实际执行过的层级。
