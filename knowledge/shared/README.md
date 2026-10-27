# 公共规则目录与经验边界

本目录是 Coupon、App、Games 维护流程共用的正式判断方法。`rules.json` 是规则 ID、状态、页面范围和来源的唯一索引；下表只是导航，具体内容、条件和例外以链接的条款为准。公共方法不统一三类站的业务流程、尺寸、列数或视觉样式。

| 规则 | 原条款 |
| --- | --- |
| SHARED-LAYOUT-001 | [用途、层级与整页构图](layout-and-space.md#shared-layout-001--用途层级与整页构图) |
| SHARED-SPACE-001 | [有用途的留白](layout-and-space.md#shared-space-001--有用途的留白) |
| SHARED-GAP-001 | [四层间距与累计距离](layout-and-space.md#shared-gap-001--四层间距与累计距离) |
| SHARED-ALIGN-001 | [内容轴与光学平衡](layout-and-space.md#shared-align-001--内容轴与光学平衡) |
| SHARED-CAPACITY-001 | [容量与宿主宽度](layout-and-space.md#shared-capacity-001--容量与宿主宽度) |
| SHARED-RESPONSIVE-001 | [两端组织与断点邻域](layout-and-space.md#shared-responsive-001--两端组织与断点邻域) |
| SHARED-BRAND-001 | [一致性与原创边界](layout-and-space.md#shared-brand-001--一致性与原创边界) |
| SHARED-TYPE-001 | [可读性与信息层级](content-and-actions.md#shared-type-001--可读性与信息层级) |
| SHARED-MEDIA-001 | [媒体角色与稳定空间](content-and-actions.md#shared-media-001--媒体角色与稳定空间) |
| SHARED-ACTION-001 | [操作归属与完整状态](content-and-actions.md#shared-action-001--操作归属与完整状态) |
| SHARED-STABILITY-001 | [首次绘制、加载与重绘](content-and-actions.md#shared-stability-001--首次绘制加载与重绘) |
| SHARED-STATES-001 | [整组排查与异常恢复](content-and-actions.md#shared-states-001--整组排查与异常恢复) |
| SHARED-TRUTH-001 | [事实、范围与来源](content-and-actions.md#shared-truth-001--事实范围与来源) |
| SHARED-EVIDENCE-001 | [可定位的真实证据](review-and-learning.md#shared-evidence-001--可定位的真实证据) |
| SHARED-RECHECK-001 | [修复后检查与验收边界](review-and-learning.md#shared-recheck-001--修复后检查与验收边界) |
| SHARED-LEARN-001 | [按设计师确认沉淀与共享](review-and-learning.md#shared-learn-001--按设计师确认沉淀与共享) |

## 四层内容，分别维护

1. **正式公共规则**：本目录中的现行规则。三类站共用方法，先看适用条件；变更条款按仓库规则版本化，不用经验记录静默替换。
2. **站型和页面专项**：Coupon 沿用原冻结合同，App 和 Games 分别使用 `site-types/app`、`site-types/games`。专项要求只在对应场景生效；下载型手游按真实能力分流。
3. **反馈与案例**：共享经验服务保存的候选记录及其原始证据，是待判断材料。案例数量不等于可用经验数量；没有复验或准确候选确认时不得视为通过。
4. **可复用经验**：在服务中带作用域和证据的结论。先在来源站点的页面、组件和触发条件内使用；只有满足现有独立站点复验条件，才有可能推广。它不能覆盖正式规则，也不是站点交付或设计师验收的替代品。

经验整理的目标是帮助后续同类型站点，而不是要求同站多人协作。来自 ZIP 的已确认且复验过的可迁移经验可以作为同站型参考；是否适用由Agent依据页面、组件、条件和例外判断，不把它当正式规则。本地来源不计作可核验的独立站点，旧版中央服务需升级才能接收这种参考。

## 整理和纠错

- 先盘点正式规则、案例、结论及来源；普通查询缺少站点参数时不能推断整个库没有站点专属记录。离线队列是每台机器自己的，中央快照也不包括尚未上传的本机反馈。
- 为保留历史，合并相同经验时追加真实案例证据；遇到冲突或撤回先检查记录与历史，不通过改名或删除证据绕过。不要从标题、重复 key、单次认可或截图猜测通用结论。
- 修改已有正式规则时更新所属原条款及索引、版本和兼容验证；本目录导航只指向原条款，不维护另一套摘要作为新规则。已有冻结任务和历史包不热更新。
- Agent 按 `core/site-quality.md` 自动加载公共条款与匹配的专项；设计师无需选择规则。复用和学习的具体流程见 `core/experience.md`。
