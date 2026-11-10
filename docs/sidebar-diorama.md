# 侧栏魁地奇场景

场景来自用户提供的 `quidditch-hogwarts-diorama` 项目，保留其 Three.js r160 本地库和可读场景源码，资源位于 `assets/quidditch/`。Three.js 的 MIT 版权头保留在 `vendor/three.min.js` 中。

## 入口和显示方式

- 完整场景：`/assets/quidditch/index.html`，保留天气、比赛、声音和暂停控制。声音默认关闭。
- 侧栏场景：同一页面加 `?embed=1`，使用透明背景，占满侧栏宽度，隐藏完整界面和底部说明、按钮，保留球场和球员动画。
- `_includes/sidebar-diorama.html` 在导航与社交链接之间插入入口；`_sass/layout/_sidebar-diorama.scss` 控制尺寸和布局。
- 宽度至少 992 px、高度至少 760 px 时显示；较矮的桌面窗口压缩场景高度，小屏幕保留导航空间，也不会初始化场景 iframe。
- `assets/js/sidebar-diorama.js` 等场景进入可视区域后加载并默认播放，通过校验来源的消息控制动画。页面或组件不可见时停止动画，重新可见后恢复。
- 嵌入模式关闭动态阴影、限制渲染分辨率并将刷新率上限设为 20 FPS。完整场景保持原有画质。
- `preview.png` 是场景画布的透明截图，在加载完成前、JavaScript 禁用或 WebGL 不可用时显示。

## 维护与验证

直接修改 `index.html`、`scene.js` 和 `embed.css` 即可，Jekyll 将这些文件原样复制到站点，无需额外构建流程。场景更新后，使用嵌入模式在 480 × 360 视口重新截图画布，更新 `preview.png`。

除项目 `AGENTS.md` 中的检查外，浏览器中验证：场景自动播放、不可见时暂停、侧栏空间充足、深色背景、移动端不加载 iframe、无 WebGL 时的静态图，以及完整场景的天气切换。

原项目声明本作品为《哈利·波特》世界观的非商业同人创作，相关名称与设定的权利归其权利人所有。
