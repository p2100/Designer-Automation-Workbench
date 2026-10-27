# 六站参考核对 · 2026-10-26

本文件记录研究事实，不是已启用的生成规则。页面内容、广告与布局会变化；提取时应区分浏览器当前呈现与网页工具抓取的内容。没有执行 APK 下载、安装或安全扫描，也没有核验参考站展示的全部应用数据。

## 核对方式与范围

- 六站均核对原站内容及真实导航，PC 重点实看首页、详情与下载承接结构；具体深度见各站记录。
- 主线程额外用 Chrome 的 393×852 临时视口查看 APK3C、APDownload、App4-AI、Appstoreez、AppsInApps 首页，App-loader 详情，以及 AppsInApps 的详情/下载页、App4-AI 的分类/文章。视口已恢复。
- 子调查的 PC 观察、AX/DOM 与网页抓取用于补足页面关系；并非每个页面都完成 PC/手机像素审核。
- 未保存可离线复核的完整截图集，本文件的 URL、观察和深度说明不等同于完整视觉验收证据。

## APK3C

| 页面 | 真实样本 |
| --- | --- |
| 首页 | https://apk3c.com/ |
| 分类 | https://apk3c.com/category/food-and-drink.html |
| 文章 | https://apk3c.com/post/com.frontier.selfserve.html |
| detail | https://apk3c.com/detail/com.alibaba.intl.android.apps.poseidon.html |
| version | https://apk3c.com/version/com.alibaba.intl.android.apps.poseidon.html |
| 信息页 | https://apk3c.com/about.html |

PC 内容与 DOM：品牌页头、介绍与精选、多个应用集合、分类/文章入口；分类为应用列表。详情是左主栏、右热门应用栏，主栏依次呈现身份、属性、截图、正文、获取与相似应用。Alibaba 详情另有实际 PC 像素观察；1280px 样本中主栏约845px、侧栏约340px，间距约32px，这些是样本观察值，不是统一尺寸。

手机首页看到精选由桌面四卡转为两列，后续应用条目用横向信息卡；部分图片仍处于加载状态，不能据该首屏认定素材完整。

version 是同一应用的下载选项页，含商店与外部安装包入口，没有历史版本列表。样本外部包源路径为 XAPK，版本字段写 Latest，无法证明展示了具体发行版本。

## APDownload

| 页面 | 真实样本 |
| --- | --- |
| 首页 | https://apdownload.com/app |
| 分类 | https://apdownload.com/app/category/sports.html |
| 文章 | https://apdownload.com/app/article/com.shipt.shopper.html |
| detail | https://apdownload.com/app/detail/com.acn.uc.html |
| version | https://apdownload.com/app/version/com.acn.uc.html |
| 信息页 | https://apdownload.com/app/about.html |

分类内容样本含分类身份和应用墙；文章含正文、同一应用详情卡及相关文章；详情包含身份、属性、截图、介绍、获取、相似应用，PC 有侧推荐栏。样本结构来自原站内容和 DOM，不能将所有数字当像素实测。

主线程当前手机首页为 Discover the Best Apps & Games 标题、推荐 App 卡组及分类入口；与部分网页工具抓取的日期/App Store Preview 结构存在差异，以当次浏览器为准。

version 是下载承接页。Uconnect 样本的 Google Play/App Store 实际为空锚点；APK 标注与 XAPK 目标不一致。这些都是需要排除的参考缺陷。

## AppsInApps

| 页面 | 真实样本 |
| --- | --- |
| 首页 | https://appsinapps.com/ |
| 分类总览 | https://appsinapps.com/categories.html |
| 分类结果 | https://appsinapps.com/category/communication.html |
| 文章 | https://appsinapps.com/post/com.mistplay.mistplay.html |
| detail | https://appsinapps.com/detail/com_google_android_gm.html |
| 下载承接 | https://appsinapps.com/download/com_google_android_gm.html |
| 信息页 | https://appsinapps.com/about.html |

当前浏览器首页为精选大卡/轮播和小卡组合，后续为周选、趋势、用途集合、文章和分类。PC 首页/详情已实看；分类、文章主要核对原站内容与链接。

当前 Gmail 详情为身份、属性、截图、三个渠道按钮、介绍/用途/功能、比较和推荐；PC 右推荐栏，手机改为单主栏、属性两列、截图横滑、渠道按钮纵排。手机主线程实看了截图区与渠道区。安全宣传、广告及巨大留白不代表应保留。

下载按钮进入 `/download/` 页面。主线程实看确认该页包含同一 Gmail 身份、属性、渠道选择和相关推荐；它与其他站 `/version/` 的业务职责相同。没有看到历史版本列表。

网页工具对 Gmail detail 抓取到旧版内容，与当前浏览器不同；不得混写成同一版本事实。Games 推荐的 Play Now 入口并不证明浏览器可玩；推荐标题与条目分类也存在不匹配样本。

## App-loader

| 页面 | 真实样本 |
| --- | --- |
| 首页 | https://app-loader.com/ |
| 分类 | https://app-loader.com/category/communication.html |
| 文章 | https://app-loader.com/post/com.snapchat.android.html |
| detail | https://app-loader.com/detail/com.yahoo.apps.yahooapp.html |
| version | https://app-loader.com/version/com.yahoo.apps.yahooapp.html |
| 信息页 | https://app-loader.com/about.html |

PC 首页为文案 Hero 加应用图块、后续集合/排行/文章/分类；详情为左主内容和右推荐，含身份、截图、获取、信息与正文。PC 首页/详情已实看；分类、文章、version 主要核对原站内容与链接。

主线程手机详情见单列身份、横滑截图；首屏有大广告空白，长主标题被省略。这些是需另行判断的参考表现，不能默认升级为要求。

version 是下载中转，未见历史版本。样本中商店链接为空锚点，下载/重试存在指回自身的入口；“下载已开始”和安全宣称没有本次执行依据。

## App4-AI

| 页面 | 真实样本 |
| --- | --- |
| 首页 | https://app4-ai.com/ |
| 分类 | https://app4-ai.com/app/category/finance |
| 文章 | https://app4-ai.com/app/article/com.waymo.carapp.html |
| detail | https://app4-ai.com/app/detail/com.google.android.apps.nbu.paisa.user.html |
| version | https://app4-ai.com/app/version/com.google.android.apps.nbu.paisa.user.html |
| 信息页 | https://app4-ai.com/app/intro/about.html |

PC 首页/详情/version/分类/文章有实际像素观察。首页为精选轮播、图标集合、多个推荐/排行、文章、分类；详情与文章采用正文加侧推荐区，version 保留同一应用和渠道选择。

主线程手机首页为轮播和三列图标集合；分类变为单列横向信息卡；文章保留长标题与正文阅读关系。分类/文章首屏的大广告空白和页面横向滚动现象不能作为目标布局。

Google Pay 样本 App Store 按钮灰显且目标为空锚点/undefined；不能要求每个 App 都有三个可用渠道。文章热度与安全断言未经本次证实。

## Appstoreez

| 页面 | 真实样本 |
| --- | --- |
| 首页 | https://www.appstoreez.com/ |
| detail | https://www.appstoreez.com/detail/com.disney.disneyplus.html |
| version | https://www.appstoreez.com/version/com.disney.disneyplus.html |
| 信息页 | https://www.appstoreez.com/about.html |

使用带 www 的入口可被网页工具读取。PC 首页/详情/version 已实看：两张并列精选卡、普通图标网格分组；详情/version 使用主内容与右推荐区。手机首页的两张精选卡转为上下排列，普通应用为两列。

已检查的首页与详情入口中未找到独立文章、分类或搜索入口；这表示本次未发现，不等于证明全站不存在。version 是渠道选择页，不是历史版本列表。安全与自动下载文案未取得独立依据。

## 可以提炼的共同关系

- 发现入口指向具体应用详情，文章可关联同一应用；获取动作保持应用身份一致。
- detail 负责了解应用，version/download 负责确认可用获取渠道；具体路径名不是页面职责的证明。
- 身份/属性、截图、介绍/功能、获取、相关内容是常见信息组；站点的顺序、栏宽、列数、主题数量并不一致。
- PC 侧栏是常见方案，手机通常改为主内容单列，侧推荐隐藏或重组；没有一套可直接当所有站硬模板的共同像素布局。
- 官方商店和 Android 文件源是不同获取渠道；引用应用平台数据时必须保留对应关系。

## 不能直接升级为规则的参考表现

空链接、指向自身的伪下载、无来源评分/评论/排名、安全认证、错误 APK/XAPK 文案、占满首屏的空广告区、分类不匹配的推荐、长期加载图、被裁断的主标题和整页横向溢出。

因此，规则中的硬要求来自用户确认与明确质量底线；参考的具体尺寸/形态保留为观察与可选制作方法。不能把六站全部模块取并集后强制塞进每个新站。
