# 把经验落实到当前产物

新建 Coupon、App、Games 统一生成和优化任务执行本合同。旧冻结任务保留原合同；设计师确认成品后直接上传的流程不增加审核步骤。程序核对实现和证据的绑定，不替代设计判断、真实人类认可或独立审核。

## 从调整形成经验

保存设计师原话、准确候选、页面和组件。修复后检查实际调用位置、设备和状态；设计师认可准确候选后，按 core/experience.md 提炼原因、方法、条件和例外，或记录具体 skip 原因。上传与经验后台投递独立，pending 不等于共享成功。测试反馈和确认明确标注 TEST，不能写入正式库冒充真实验收。

## 下次生成和优化采用

generate start、audit open/start 返回 experiencePlan，冻结经验 ID、修订、正文指纹、站型和页面。适用的有效修复经验全部保留；主观参考按当前请求文字相关性和时间选取少量，报告未选数量。排序不表示理解了设计，品牌偏好不提升为公共规则。

Agent 阅读计划并作出采用、不适用或冲突的具体判断。生成先按经验实际设计和实现源码，再 generate review；审核继承生成时的计划，不在交接时换成新检索结果。优化先修改并立即预览，再复验真实受影响范围。

内部命令由 Agent 使用，设计师不填写 JSON：

```text
designer-automation audit experience-plan --id TASK --data DATA
designer-automation audit experience-apply --id TASK --file DECISIONS --data DATA
designer-automation audit experience-verify --id TASK --data DATA
```

DECISIONS 包含准确 candidate 和 decisions。每项给 referenceId、revision、contentHash、decision 和具体 reason；采用项另给 component、实际页面 ID 列表 pages、源码相对路径 implementationPaths、实际检查 ID 列表 checkIds。检查应能发现对应问题，而不只证明页面能打开。状态变化引起位移可用 interaction 的 expected.type=stable 比较操作前后几何；容差来自当前任务，不推广固定尺寸。

采用覆盖当前范围内该家族的全部声明调用页。文件在授权源码中，检查属于准确调用页。experience-verify 核对当前候选、源码、冻结产物、实际检查通过状态、候选证据目录和文件指纹。结果为 verified、pending、stale 或 conflict；命令返回 JSON 不表示验证通过。

未说明经验、未解冲突、失败或缺失检查、陈旧候选、篡改证据不能完成工作台 author handoff。源码改变后重新构建并复查受影响项；应用决定改变会撤销尚未确认的交接。已获设计师认可的候选记录冻结，不因此要求重复确认。批准前只读核对证据，不重跑浏览器。

局部调整从 fullExperiencePlan 派生，保留未启用页面与经验数量；局部 verified 不称全站通过。开始的任务固定快照；撤回、纠正与新经验用于下个任务，不静默重写历史认可。

## 完整回放与效果

三类站点分别覆盖全新生成和后续优化：旧问题先在浏览器检出，实际调整形成准确范围经验；服务重启后，全新任务读取经验，执行 Agent 编写真实源码，记录采用，再检查相同内容、状态与设备。保留失败基线、改后测量、当前候选截图和经验链。

自动回归适配器与真实 Agent 回放分别报告。读取成功、绑定完整、特定问题复查通过、审美认可和真实改稿两小时达标是不同结论。看同类缺陷、返工轮数和实际耗时，不用经验数量代替效果。
