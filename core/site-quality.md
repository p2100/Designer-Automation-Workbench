# 维护统一质量入口

设计师接入以 docs/designer-quickstart.md 为准，使用 workbench 与现有 designer_experience MCP。Agent 从站点源码/页面确认 siteType，准备内部配置、规则和证据，不让设计师选择规则或填写 JSON。

公共方法读取 knowledge/shared/layout-and-space.md、content-and-actions.md、review-and-learning.md，覆盖布局、有效留白、四层累计间距、光学对齐、文字/按钮/宿主容量、媒体比例、PC/手机重组、加载/重绘、状态和真实证据。不统一颜色、列数、卡片形状或各站型的业务尺寸。

Coupon 继续原 context 和页面合同；App 读取完整 site-types/app 的身份、媒体、detail→version→真实渠道及页面条款；Games 读取 site-types/games 的能力分流、页面条款和 core/owner-standards-20261027.md。下载型手游按实际 App 获取路径处理，不因标题是游戏而套在线运行规则。

冻结 contexts 保存公共和专项 obligations。逐页/宽度的规则检查与布局、视觉、交互共用同次访问和截图；observe 中说明条件是否成立、实际观察及证据范围。条件不成立说明实体/范围依据，不以 not-run 冒充通过。条款未查、缺实际模块或范围未对账时保留 gaps，不能 handoff 为已验证。

Games 通过 page.ownerSelectors 绑定 inspect-games 探针，自动检查确定的容器/边距/字号；Image 生图、背景质感、所有触控反馈、真实 loading 和运行仍须实际观察。缺工具如实 not-run。原 Coupon 生成快照和 bin/da.mjs 门禁保留原合同；本文件用于维护统一入口。

专项快照中的独立工具说明描述其原包；本工作流统一使用 workbench，不启动第二套工作区、Git 或个人经验发布机制。
