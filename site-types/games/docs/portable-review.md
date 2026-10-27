# 在设计师电脑检查与修复

使用整个 Designer-Automation 时由统一入口自动加载 Games；单独使用本包则读 AGENTS.md。设计师描述目标和链接/源码，Agent 准备任务、选择器、预算、工具与证据，不要求设计师填 JSON。

按 core/owner-standards-20261027.md 的全部适用项，先确认真实源码、构建方式、候选与浏览器能力，保存修前 PC/393/320 和正常样本。在独立副本修源，重建，复查所有受影响页面/重复组件和正常样本。布局在初始 HTML/CSS 成立，不用浏览器补丁。反馈原话、截图、修复与复查通过统一包反馈功能持久保存。

bin/inspect-games.mjs 导出 inspectGames。Agent 将函数用于真实浏览器 evaluate，传入 page=home|detail|play（其他页也可检查全局项）、scopeSelector 和从该候选确认的 selectors。phone 默认 <=767px；若实际手机布局使用其他宽度，明确传 mobile，不把默认值当用户指定断点。

选择器字段：

- homeCanvas：首页真实游戏内容画布，测左右20–40px；gameIcons：实际游戏图标框；categories：实际分类模块。如未发现分类，记录实际 inventory/源扫描证据，不能仅省略 selector 就声称分类已检查。
- contentContainer：detail/play实际主体容器，在充足PC空间测1200px；identity、topRecommendations：详情主体身份与顶部推荐；howToPlay：实际操作正文容器，检查单列，不能误指整个双栏页面。
- bottomInformation：游戏页底部信息；fullscreen、backToDetail：实际对应按钮，包括图标/菜单中的入口，缺省或不匹配不证明已移除，仍须清点真实交互。
- prose：需要检查自然换行的文字轨道；moduleDescriptions：模块标题区副文案。探针产生“需布局复核”的候选，不把合法段落或局部横向卡片误判成统一拉宽要求。

返回的 measured 只代表这些测量已执行；notRun 仍列出背景连续性、生图来源、hover/tap、真实loading和运行等人工/交互项。探针不会改页面。全部手机点击位置从 clickableTargets 起步再核对实际页面与 iframe/Canvas，逐个操作，不能只看CSS存在active规则。

新增/重做 loading插画和游戏/操作图标调用宿主 Image 工具。生成文件保存到本站可编辑源码，保持本地引用和生成回执；规则包不携带某台机器路径、账号或隐藏服务。没有 Image 能力时如实记录素材项not-run，继续已授权可做的排版修复，不伪造素材/进度/验收。PC不加全屏按钮，不加单独返回detail按钮；正常浏览器/退出/恢复仍可用。

Sky Swarm按实际站点/实体/候选定位，检查整模块、相邻布局与断点。该次反馈没有给出新的精确截图，不能创造一个固定模板作为“原图要求”；先修文字能确定的缺陷，无法核对的细节保留待参考项。
