# 独立维护工作流

Node >=22.19，Git和宿主可用的Chromium。首次`npm ci`；通过`SITE_BROWSER_EXECUTABLE`指定真实浏览器路径，不包含浏览器二进制。下列命令从独立工程根运行，JSON由Agent准备。旧生成仍从bin/da.mjs进入；其规则/合同由compatibility/generation-baseline.json固定，原Harness目录未被回写。

## 日常调用

```
node bin/workbench.mjs checkout --id project-a --repo <Git地址> --ref <分支>
node bin/workbench.mjs start --id project-a --repo <同一地址> --ref <同一分支> --config .designer-data/project-a.json
node bin/workbench.mjs status --id project-a
node bin/workbench.mjs repair --id project-a --file .designer-data/edits.json
node bin/workbench.mjs observe --id project-a --file .designer-data/observations.json
node bin/workbench.mjs coverage --id project-a --file .designer-data/coverage.json
node bin/workbench.mjs handoff --id project-a
node bin/workbench.mjs feedback --id project-a --file .designer-data/feedback.json
node bin/workbench.mjs learn --id project-a --file .designer-data/lesson.json
```

本地源码使用相同命令但将 `--repo` 换成 `--source /本机源码目录`，不传 `--ref`。例如 `checkout --id project-a --source /实际源码目录`，之后 `start --id project-a --source /同一目录 --config .designer-data/project-a.json`。Agent 负责确认源码、命令和配置；设计师不用手填 JSON。已有 Git 的本地工作树也可选择 `--source`，此时导入当前文件而不是只取已提交版本。

checkout可先拉取或隔离复制供Agent检查源码，start复用同一工作区，不再重复导入。Git 省略ref使用仓库默认分支。本地源码原件、未提交修改和旧候选保留；排除依赖目录、Git 元数据、环境密钥，遇到软链接、源目录在导入期间变化或与工作区互相嵌套时拒绝并明确报告。修复与构建都在独立副本中，不自动写回原目录。配置参考templates/maintenance-task.json；构建工程设置artifactRoot为实际输出目录，commands.install/build为argv数组。未绑定的额外HTML路由必须补入pages或给出excludedRoutesReason；不是自动跳过。

edits包含candidate与edits数组，每项为file、expectedHash（当前源码UTF-8字节SHA256）、find、replace。程序要求唯一匹配；新建/删除文件或复杂重构由宿主授权源码工具处理，随后cycle核对完整影响范围，不对冻结输出直接打补丁。

observations包含candidate、observations数组；每项为id、status、actor、observations对象。observations逐个填写对应check.criteria，实际阅读status给出的PNG。自动扫描不填写审美结论。

coverage包含actor、notes、gaps。notes记录真实组件与条款对账；缺少状态/能力时填gaps，不可声明完成。feedback包含candidate、actor、text、decision（revise/approve）及可选checkIds；approve时由Agent附lessons（或先learn准备同一候选的草稿）；actor是记录的实际设计师身份，不由程序认证，Agent不得冒充。未给checkIds时全部检查失效。

lesson包含actor、summary、cause、prevention、classification（general/site-preference/hard-failure）。lesson还需component、pages或checkIds，以及learning（key、when、exceptions、transferable）。程序从实际选中检查推导作用域，不默认关联整个任务；未复测、未认可或缺少明确条件的案例不进入有效经验；设计师确认后自动处理，无可复用内容可记录learningDecision skip。共享服务保存的是证据声明，不可能仅凭这些字段认证审美或人的真实行为。

每次start/cycle/repair返回lastAudit.executed/reused/visits。无变化且证据有效时无需重新浏览。preview命令复用一个本地进程与地址，并随任务切换到最新候选；stop-preview只停止该任务自己的服务。

默认命令返回摘要、待处理检查和对应证据，不重复输出整轮原始测量。需要原始记录时status --detail full。访问过外部网络的页面检查不能只凭本地文件指纹复用；无外部依赖的证据默认最多复用30分钟，超过后重新采集，避免时效状态长期失真。

## 统一MCP与自动交付

中央MCP为http://172.18.188.6:4381/mcp。设计师npm run connect后使用本地stdio入口，它自动连接中央MCP，提供experience_search、experience_capture、experience_manage和本地experience_status。workbench也通过stdio MCP调用，不再读写独立HTTP经验接口或本地JSON共享库。未确认反馈是草稿，绑定准确候选、真实确认及具体受影响复验项的经验在来源站点内生效；同类归并、冲突处理、撤回及跨站推广遵循[经验规则](../core/experience.md)。

本地入口持久保留待传项，断网后台自动重试，成功确认后清理。关闭Agent后后台进程继续，关机后下次MCP启动恢复；旧outbox自动接管。queued表示尚未共享，明确错误保留原记录供Agent处理。无需sync命令。已读经验的查询缓存按中央服务地址隔离，断网返回离线标记。配置方法与完整行为见[快速连接](designer-quickstart.md)。

服务端仍为MongoDB独立库，备份恢复见[运维说明](experience-operations.md)。/health与维护者快照接口用于运维，旧HTTP经验接口仅保留兼容，不是设计师工作流入口。管理员快照认证不变，自动共享不需要维护者令牌。数据库不可用时health返回503，启动失败不回退到JSON。

本版本固定当前任务的规则与经验；新发布的active经验在后续任务选择。修改正式规则时更新对应源、索引和版本，执行npm run manifest；维护者需确认并更新兼容基线，才可有意升级原规则合同。外部原Harness的生成升级另行进行，不由经验发布触发。

## 验证边界

新增测试覆盖Git隔离、陈旧候选/越界修改、浏览器发现及修复布局错误、同次访问支持多项检查、增量复用与共享样式扩验、稳定预览切换、设计师反馈、HTTP/MCP及离线队列。测试中的视觉观察/人工认可为明确标注的合成协议夹具，不能作为真实站点验收或用户认可。默认npm test中的浏览器用例在缺浏览器路径时skip；正式验证必须明确确认没有跳过。

本轮仅验证经验服务、MongoDB并发/持久化及备份恢复。合成案例全部放在隔离测试集合，未执行站点或浏览器测试，也不代表站点验收。
