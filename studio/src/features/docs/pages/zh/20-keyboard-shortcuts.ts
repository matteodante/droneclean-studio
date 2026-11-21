import type { DocPageContent } from '../../docs-content'

const page = {
  order: 20,
  slug: 'keyboard-shortcuts',
  title: '键盘快捷键',
  description: '按分组列出的默认快捷键，以及如何搜索、重新绑定和重置它们。',
  category: 'Reference',
  sections: [
    {
      title: '播放',
      blocks: [
        {
          kind: 'table',
          headers: ['操作', '快捷键'],
          rows: [
            ['播放 / 暂停', '`Space`'],
            ['上一帧 / 下一帧', '`Left` / `Right`'],
            ['上一个 / 下一个吸附点', '`Up` / `Down`'],
            ['跳到开头 / 结尾', '`Home` / `End`'],
          ],
        },
      ],
    },
    {
      title: '编辑',
      blocks: [
        {
          kind: 'table',
          headers: ['操作', '快捷键'],
          rows: [
            ['在播放头处分割', '`Alt+C`'],
            ['在光标处分割', '`Shift+C`'],
            ['合并', '`Shift+J`'],
            ['删除 / 波纹删除', '`Delete` / `Ctrl+Delete`'],
            ['插入冻结帧', '`Shift+F`'],
            ['链接 / 取消链接片段', '`Ctrl+Alt+L` / `Alt+Shift+L`'],
            ['切换链接选择', '`Shift+L`'],
            ['微移 1 像素 / 10 像素', '`Shift+Arrow` / `Ctrl+Shift+Arrow`'],
          ],
        },
      ],
    },
    {
      title: '工具',
      blocks: [
        {
          kind: 'table',
          headers: ['工具', '快捷键'],
          rows: [
            ['选择', '`V`'],
            ['修剪编辑', '`T`'],
            ['剃刀', '`C`'],
            ['速率拉伸', '`R`'],
            ['滑移', '`Y`'],
            ['滑动', '`U`'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '波纹和滚动是**修剪编辑**工具的修剪行为，并不是各自拥有快捷键的独立工具。',
        },
      ],
    },
    {
      title: '历史记录、视图和剪贴板',
      blocks: [
        {
          kind: 'table',
          headers: ['操作', '快捷键'],
          rows: [
            ['撤销 / 重做', '`Ctrl+Z` / `Ctrl+Shift+Z`'],
            ['复制 / 剪切 / 粘贴', '`Ctrl+C` / `Ctrl+X` / `Ctrl+V`'],
            ['开关吸附 / 画布吸附', '`S` / `Shift+S`'],
            ['放大 / 缩小', '`Ctrl+=` / `Ctrl+-`'],
            ['适应窗口 / 100%', '`\\` / `Shift+\\`'],
            ['剪辑 / 调色 / Motion 工作区', '`Alt+1` / `Alt+2` / `Alt+3`'],
          ],
        },
      ],
    },
    {
      title: '标记与关键帧',
      blocks: [
        {
          kind: 'table',
          headers: ['操作', '快捷键'],
          rows: [
            ['添加 / 移除标记', '`M` / `Shift+M`'],
            ['上一个 / 下一个标记', '`[` / `]`'],
            ['清除关键帧', '`Shift+A`'],
            ['为所选的“剪辑”图层添加关键帧', '`K`'],
            ['关键帧曲线 / 表格 / 拆分视图', '`1` / `2` / `3`'],
            ['上一个 / 下一个属性关键帧', '`Alt+[` / `Alt+]`'],
            ['为当前属性开关自动关键帧', '`A`'],
            ['适应所选关键帧', '`F`'],
          ],
        },
      ],
    },
    {
      title: '源监视器与项目',
      blocks: [
        {
          kind: 'table',
          headers: ['操作', '快捷键'],
          rows: [
            ['标记入点 / 出点', '`I` / `O`'],
            ['清除入点/出点', '`Alt+X`'],
            ['渲染预览（入点到出点，或整个时间线）', '`Enter`'],
            ['插入 / 覆盖编辑', '`,` / `.`'],
            ['保存', '`Ctrl+S`'],
            ['导出', '`Ctrl+Shift+E`'],
            ['打开场景浏览器', '`Ctrl+Shift+F`'],
          ],
        },
      ],
    },
    {
      title: '自定义快捷键',
      blocks: [
        {
          kind: 'paragraph',
          text: '上面的每一个绑定都是出厂默认值。点击编辑器工具栏中的**键盘快捷键**按钮（键盘图标），打开重新设计的快捷键编辑器，把任意命令重新映射到你喜欢的按键。',
        },
        {
          kind: 'steps',
          items: [
            '按名称搜索命令，或筛选到**已自定义**、**冲突**或**未分配**分组。',
            '选择一个命令并点击**录制**，然后按住修饰键，再按下最后一个键。',
            '如果这个组合已被占用，编辑器会标出冲突，选择**覆盖**即可重新分配，或者换用其他按键。',
            '使用**解绑**可以清除绑定，也可以在主绑定之外再添加一个备用绑定。',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '使用**重置**可以恢复单个命令，使用**全部重置**则让所有快捷键恢复默认值。你还可以把绑定**导出**为预设文件，并在另一台电脑上**导入**。',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
