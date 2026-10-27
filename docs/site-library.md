# 本地 Agent 改造后回传站点库

设计师可以直接说：“按 Designer-Automation 调整这个站，确认后更新回原站点库。”提供站点库预览地址即可。Agent 负责连接、站点身份、源码、内部配置和回传；设计师不选规则、不填 JSON。

## 首次连接

Agent 使用统一入口 `node bin/designer-automation.mjs library connect --url <站点预览URL>`。预览和 current 地址会自动识别真实 projectId；只给库首页时由 Agent 查询目录并明确目标，再传 `--project`。连接只使用站点库自身地址，不调用 Harness 工作台。

Agent 直接调用内网站点库的 connect 接口，程序自动建立准确站点和起始版本的连接，返回 connected 即可继续；不打开 Harness，不登录，不经过浏览器确认或配对。设计师无需填写账号、Token 或 JSON。连接信息由程序在本机私有 `.designer-data` 管理，不放进 ZIP、Git 或经验库。`library disconnect --id <任务ID>` 可断开当前连接。该接口供内网 Agent 命令调用，站点预览中的网页脚本不能创建源码写入连接。

## 取源码与正常改造

Agent 使用 `library pull --url <库地址> --project <ID>` 获取本站准确版本的可编辑源码，返回的新目录作为 `audit start --source` 输入。沿用原来的构建、页面职责、公共和专项规则完成审核、修改和复验。从该目录开启的任务会自动绑定站点库。

已经从 ZIP 或 Git 完成改造的任务，Agent 使用 `library bind --url <库地址> --project <ID> --id <任务ID>`。程序核对真实站型和修改前的源码指纹。起点不一致时，保留原工作区和改动，拉取库中源码后有范围地合并，不能换一个站名强行覆盖。只有预览网址、缺可编辑源码的历史条目不自动变成可维护项目。

## 确认与回传

连接并绑定后，设计师通过原 `audit feedback` 明确认可准确候选，程序在保留本地认可与经验记录后自动回传。Agent 也可以在完整检查、handoff 后按用户更新站点库的要求调用 `library push --id <任务ID>`，把候选提前送到库中复核。

上传冻结页面和受授权的源码差异，服务端不执行上传包的构建脚本。校验通过后，原站点新增一个“本地调整”版本，更新 currentBuild 和稳定预览，旧版本保留。上传不产生站点库的原生审核结论，不自动开放下载或上线；库中显示待审核。本地设计师确认、原生复核和发布按各自实际证据记录。

返回 `uploaded` 和真实 `previewUrl` 才能报告已更新。Agent 打开该预览核对内容。连接中断保留私有待传记录，`library push --id` 用同一请求重试，服务器回执防止重复新增版本。返回 pending 时，认可和经验照常保留，不宣称库中已更新；程序不会后台盲目覆盖站点。

站点已有其他更新、源码未构建、站型不符、受保护数据/运行资源/构建规则变化、候选过期或文件哈希不符时停止写回。Agent 保留本地改造、说明具体冲突并合并后复验。`library status --id` 查看连接和版本是否有分歧；身份与库版本不一致时不自动换绑。

站点库服务端和本地 Designer-Automation 都须升级到支持此协议的版本。经验库仍走原 designer_experience MCP，站点文件不进入经验库。
