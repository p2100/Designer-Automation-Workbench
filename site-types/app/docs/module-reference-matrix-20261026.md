# 逐板块参考核对与1.0缺口

本轮用户指出：当前生成首页各板块质量不足，缺少Banner图片与App推荐卡信息的逐项分析。1.0的页面最低清单不能代替模块数据合同。这里补录实际观察；规范字段见 contracts/module-data.json，样式与配色不照搬。

## 图片与首屏的实际差别

| 参考 | 首屏图片角色 | 主体/卡片所见信息 |
| --- | --- | --- |
| [AppsInApps](https://appsinapps.com/) | 4张独立Banner artwork，各908×675，另有App icon；不是产品截图 | Banner有名称、评分、下载量、分类、View App；4张次推荐有icon/名称/评分/下载量/分类/View，没有正文摘要 |
| [Appstoreez](https://www.appstoreez.com/) | 双精选使用渐变底+App icon，未用独立Banner图 | 精选有名称/分类/评分/FREE/GET；普通应用有icon/名称/分类/评分，未显示下载量或开发者 |
| [App4-AI](https://app4-ai.com/) | 首屏有独立banner图片，另叠App icon与身份 | 轮播含App名/Get；后续各组分别采用图标名、分类/评分/Get、排行/下载量等不同字段 |
| [APK3C](https://apk3c.com/) | 首批图片与普通App icon使用不同资源路径 | 首批有App名/分类/评分；后续推荐有icon/名称/分类/评分/GET，部分组更紧凑 |
| [APDownload](https://apdownload.com/app) | 当前首批滚动推荐使用App资源图与独立布局，不把字段中的cover一词直接判成独立Banner | 推荐有名称/分类/简述/下载量/评分/GET；分类卡还有实际分类数量；更新组有开发者等额外事实 |
| [App-loader](https://app-loader.com/) | 开场有推荐图块与主介绍；后续主要为App icon | 办公推荐含名称/分类/评分/下载量/开发者；排名行、紧凑组与文章另用不同投影 |

AppsInApps Banner样本：[Gmail artwork](https://appsinapps.com/static/index/hero-gmail.png)。App4-AI样本：[Google Pay Banner](https://resource.app4-ai.com/banner_com.google.android.apps.nbu.paisa.user.jpg)。Appstoreez样本：[Disney+图标](https://resource.appstoreez.com/com_disney_disneyplus.webp)。角色必须看实际图像与所在模块，不能从文件名cover或img存在就推断。

## AppsInApps：PC与393实看

| 模块 | 条目/字段 | 关系和跨端观察 |
| --- | --- | --- |
| 主精选 | 4个轮播实体；独立主视觉+icon、名称、评分、下载量、分类、入口 | PC图文左右，手机图上身份下；手机分类被隐藏，身份仍在；动作到detail |
| 次精选 | 4项；icon、名称、评分、下载量、分类、View | PC/手机均2×2；手机分类发生截断，不代表应照抄这一缺陷 |
| 周选 | 6项；icon、名称、评分、下载量、分类、Get | PC同排，手机横滑约2项+下一项露边；动作到detail |
| 趋势列表 | 5项；序号、icon、名称、分类、评分、方向箭头 | PC在周选旁，手机在下方；没有取得箭头或趋势的数据依据 |
| 用途分组 | 3组各4项；组主题、icon、简称 | PC并排，手机分组上下；See more到分类 |
| 工具推荐 | 9项；icon、名称、短卖点、分类、评分 | PC3×3，手机纵向；这里的摘要有功能说明用途 |
| 游戏 | 4项；icon、名称、评分 | PC横排/手机纵向；Play Now实际仍到下载型detail |
| 新条目 | 12项；icon、名称、分类、评分、NEW | 两端横滑；没有取得NEW的真实时间依据 |
| 文章 | 主文章+4次文章；编辑封面、类型、标题、日期，主项有摘要 | PC主次并列，手机先主后次；[封面样本](https://appsinapps.com/static/index/article-covers/mobile-games-rewards.png)约16:9，另于产品截图 |
| 分类 | 16项；分类图形、名称 | PC多列，手机两列；按真实分类跳转 |

## Appstoreez：PC与393实看

双精选为2项；普通应用15个位置；游戏20个位置；更新19个位置；免费应用18个位置；补充推荐11个位置。位置数含跨模块重复，补充推荐还出现同一App重复两次，不能当作理想去重标准。

PC普通应用6列、手机2列；游戏PC3列、手机1列；更新与免费组PC左右分栏、手机上下；补充推荐PC4列、手机1列。这些都是观察，不固定成新站列数。

更新、免费、补充推荐各带不同动作/状态词，但GET/UPDATE实际均进入detail，没有执行安装/更新。更新组未因此证明每项更新日期已核验；没有排序依据，不能把推荐栏目名当真实全局排名。

## 其余页面的字段核对来源

详细入口和已观察结构保留在 [原始参考核对](reference-audit-20261026.md)。详情中的身份、信息表、截图、正文、下载与推荐；version中的同一应用、渠道/文件条件、状态和返回；文章中的标题、正文、应用卡、相关内容；分类中的分类身份、结果/数量和控制，分别拆成模块合同。未发现某站某页不等于证明不存在，未实看的设备状态仍明确留空。

## 此轮落实的纠正

不再用“图标+名称+泛摘要”代替所有推荐卡；不闲置已取得的分类、评分、下载量等真实字段；不把产品截图排在背景上就当独立Banner；不把模块名或像素无溢出当内容架构和视觉完成。

参考的商业位、空链接、虚假认证、无依据趋势、排名和NEW都不提升为硬要求。原创风格与完整的数据组织必须同时成立。
