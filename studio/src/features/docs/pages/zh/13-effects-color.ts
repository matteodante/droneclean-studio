import type { DocPageContent } from '../../docs-content'

const page = {
  order: 13,
  slug: 'effects-color',
  title: '效果与调色',
  description: '添加并叠加 GPU 效果，用色轮和曲线调色，查看示波器，应用 LUT，以及进行局部校正。',
  category: 'Creative Tools',
  related: ['keyframes', 'shapes-masks', 'properties'],
  sections: [
    {
      title: '添加和管理效果',
      blocks: [
        {
          kind: 'steps',
          items: [
            '选中一个片段，打开“属性”中的**效果**部分。',
            '使用**添加效果**，然后搜索或从某个类别中挑选。你也可以添加内置的**预设**，或你自己保存的预设。',
            '用**上移**和**下移**调整效果堆叠的顺序，顺序会改变效果叠加的结果。',
            '可以在效果自己的面板中禁用、重置或移除它；数值参数可以设置关键帧。',
          ],
        },
      ],
    },
    {
      title: '效果目录',
      blocks: [
        {
          kind: 'table',
          headers: ['类别', '效果'],
          rows: [
            [
              '色彩',
              'Brightness, Contrast, Exposure, Saturation, Vibrance, Hue Shift, Temperature, Levels, Curves, Color Wheels, Gradient Map, LUT',
            ],
            ['模糊', 'Gaussian, Box, Motion, Radial, Zoom'],
            [
              '扭曲',
              'Pixelate, RGB Split, Twirl, Wave, Bulge/Pinch, Kaleidoscope, Mirror, Fluted Glass, Ripple Glass, Glass Mosaic, Blocks, Droste 等',
            ],
            [
              '风格化',
              'Vignette, Film Grain, Sharpen, Glow, Scanlines, CRT, VHS, Halftone, Dither, ASCII, Ink, Pixel Sort, Block Glitch, Color Glitch',
            ],
            ['键控', 'Chroma Key（去除绿幕和蓝幕）'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '所有效果都在 GPU（WebGPU）上渲染。近期新增的有 **Gradient Map**、**VHS**、**CRT**、**Droste**、**Block Glitch**、**Ripple Glass** 和 **Glass Mosaic** 扭曲效果、**Ink** 以及 **Pixel Sort**。',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '**ASCII** 可以使用你自己的字符来渲染：把 **Character Set** 设为**自定义**，输入你的**自定义字符**（字符序列按从最密到最淡排列），再选择**字体**（等宽、Courier、Consolas 或 Lucida Console）。内置字符集包括 ASCII 渐变、密集、二进制和符号。',
        },
      ],
    },
    {
      title: '颜色输入与吸管',
      blocks: [
        {
          kind: 'list',
          items: [
            '每个颜色控件都接受 **Hex** 值，可以直接输入到字段中（预览会随着输入实时更新）。',
            '在支持透明度的地方，字段接受 8 位十六进制值（`#rrggbbaa`），取色器还会增加一个 Alpha 滑块。',
            '点击**吸管**，可以从应用或预览中的任意位置取色；放大镜会跟随光标，帮你精确落在目标像素上，然后点击即可应用。',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '吸管是应用内置的取色器（而不是浏览器原生的），无需权限提示。调色工作区中的色轮使用的也是同一个工具。',
        },
      ],
    },
    {
      title: '在调色工作区中调色',
      blocks: [
        {
          kind: 'list',
          items: [
            '切换到**调色**工作区（`Alt+2`）并选中一个片段；即使尚未调色，色轮和曲线也已经就绪。',
            '**Color Wheels** 可以调整阴影、中间调、高光和偏移，并带有白平衡吸管和自动平衡。',
            '**曲线**可以编辑主通道、红、绿和蓝通道；点击曲线可添加控制点，双击控制点则将其移除。',
            '用**之前**、**之后**和**分屏**进行对比，并用**复制调色**和**粘贴调色**在片段之间复制风格。',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '**旁路调色**会预览未调色的画面，但绝不会影响导出。',
        },
      ],
    },
    {
      title: '查看示波器',
      blocks: [
        {
          kind: 'table',
          headers: ['示波器', '显示内容'],
          rows: [
            ['波形图', '从上到下的亮度和颜色分布'],
            ['RGB 分量图', '红、绿、蓝通道并排显示'],
            ['矢量示波器', '色相和饱和度'],
            ['直方图', '影调的分布'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '用**显示颜色示波器**切换示波器的显示。波形图和直方图还提供 RGB、单通道和亮度（Y）视图。',
        },
      ],
    },
    {
      title: 'LUT 与局部校正',
      blocks: [
        {
          kind: 'list',
          items: [
            '添加 **LUT (.cube)** 效果，选择**导入 .cube LUT**，然后用**强度**调节其混合程度。',
            '**Secondary Qualifier** 可以把校正限定在一定的色相、饱和度和亮度范围内。',
            '**Power Window** 可以把校正限制在椭圆或矩形蒙版内，并支持羽化和反转。',
            '添加**调整图层**，可以对它下方各轨道上的所有片段调色或应用效果。',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: '导入 LUT 需要基于 Chromium 的浏览器。',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
