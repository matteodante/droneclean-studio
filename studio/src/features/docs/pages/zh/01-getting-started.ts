import type { DocPageContent } from '../../docs-content'

const page = {
  order: 1,
  slug: 'getting-started',
  title: '快速入门',
  description:
    '了解 DroneClean Studio 是什么、浏览器需要满足哪些条件，以及从启动到导出的第一次剪辑。',
  category: 'Start',
  related: ['concepts', 'workspaces', 'export'],
  sections: [
    {
      title: 'DroneClean Studio 是什么',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio 是一款**本地优先**的视频编辑器，完全在浏览器中运行，无需账号，无需上传，也没有服务器渲染。剪辑、效果、调色、AI 工具和导出都在你自己的电脑上完成，使用的是你的 GPU 和 CPU。',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '你的媒体始终留在自己的设备上。DroneClean Studio 只链接原始文件，并把项目、缓存和导出文件写入你选择的**工作区文件夹**，不会向云端发送任何内容。',
        },
      ],
    },
    {
      title: '浏览器需要满足什么条件',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio 依赖较新的 Web API，因此推荐使用较新的 Chromium 内核浏览器。',
        },
        {
          kind: 'table',
          headers: ['浏览器', '状态'],
          rows: [
            ['Chrome / Edge 113+', '完全支持'],
            ['Brave', '启用 File System Access API 标志后可用'],
            ['Safari / Firefox', '暂不支持完整工作流程'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio 使用 File System Access API（工作区文件夹）、WebCodecs（解码与导出）、WebGPU（效果、调色、AI）和 OPFS（缓存）。请保持硬件加速开启，并及时更新 GPU 驱动。',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Brave 可能会阻止文件夹访问。请打开 `brave://flags/#file-system-access-api`，将其设为 **Enabled**，然后重新启动 Brave。',
        },
      ],
    },
    {
      title: '你的第一次剪辑',
      blocks: [
        {
          kind: 'steps',
          items: [
            '在受支持的浏览器中打开 DroneClean Studio，出现提示时选择一个你可读写的**工作区文件夹**。',
            '在“项目”页面点击**新建项目**，设置这次剪辑的分辨率和帧率。',
            '打开**媒体**标签页，点击**导入**添加文件，或直接把媒体拖进媒体库。',
            '把媒体面板中的片段拖到时间线的轨道上。',
            '按 `Space` 播放，按 `Left` 和 `Right` 逐帧前进或后退。',
            '剪辑过程中随时按 `Ctrl+S` 保存，完成后点击**导出**渲染成片。',
          ],
        },
      ],
    },
    {
      title: '确认设置正常',
      blocks: [
        {
          kind: 'list',
          items: [
            '工作区选择器能够打开，并接受普通文件夹（而不是受保护的系统位置）。',
            '导入的媒体会在媒体面板中显示为带缩略图的卡片。',
            '按 `Space` 后，时间线开始播放。',
            '导出面板能够打开，且预检未报告任何阻止导出的问题。',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '如果任何一步失败，请在**故障排除**页面查找对应的症状。',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
