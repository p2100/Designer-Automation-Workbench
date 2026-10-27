---
name: designer-automation
description: Audit, repair and recheck Coupon, App and Games sites through the unified workbench, shared visual methods and separate business rules; retain confirmed designer feedback through the existing central experience MCP.
---

以本文件向上三级的 Designer-Automation 为包根，读取 AGENTS.md 和 README.md。复制时携带整个包，不能只复制本 skill。

用户要求审核/调整站点时，按 docs/designer-quickstart.md、core/site-quality.md、core/maintenance.md 使用 bin/workbench.mjs，由 Agent 检查实际源码与浏览器、判断站型并加载公共/专项规则：checkout一次，配置实际页面和源码范围，start审核，Agent实看问题后通过repair修复；读取同轮截图填写observe；确认实际覆盖后handoff给设计师查看。设计师反馈通过feedback保存，只有准确候选复验并获设计师明确确认后，才通过原 designer_experience MCP 自动共享适用经验；离线队列和补传照常，不让设计师手动发布。普通修复不用另做新站设计、重复克隆或每轮全站复验。生成任务继续使用下文原流程。所有命令的JSON由Agent准备，设计师只需自然语言要求和实际复核。

## 原 Coupon 生成分支

下列生成流程只用于原 Coupon 合同；App/Games 维护遵循上面的统一入口，不能套 Coupon 业务尺寸。

后续任务默认执行 core/quality.md「后续任务默认执行的设计标准」；用户无需重述历史对卡片、间距、层级、数字与分类、PC／手机构图的要求。作者先主动落实，审核按同一标准检查；具体本站设计保持自由，历史冻结版本按原契约。

确定真实任务的页面族、模式与角色；用包根 bin/da.mjs context 选择知识。首页、详情和店铺各有适用范围，候选知识不自动启用。源码编辑使用真实项目路径，知识资源相对包根。

按 core/workflow.md 制作、自检、独立整轮审核与返工；审核者先看实际页面，后读作者计划，使用候选冻结规则。能力从 systems 适配，缺失如实 not-run。配置/哈希校验不等于视觉通过，历史通过不继承。

新增页面标准时用 templates/page-rule.md 和 knowledge/index.json，保留 observation/required/target/exception 及适用边界。
