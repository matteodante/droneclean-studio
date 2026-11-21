import type { DocPageContent } from '../../docs-content'

const page = {
  order: 18,
  slug: 'export',
  title: '导出',
  description: '在浏览器中渲染视频或音频，选择格式和范围，并处理预检警告。',
  category: 'Output',
  related: ['render-queue', 'text-captions-subtitles', 'troubleshooting'],
  sections: [
    {
      title: '设置导出',
      blocks: [
        {
          kind: 'steps',
          items: [
            '打开**导出**（`Ctrl+Shift+E`），然后选择**导出视频**或**导出音频**。',
            '渲染整个项目，或者在只需要某一段时渲染当前的入点/出点范围。',
            '设置**分辨率**和**画质**以符合目标：快速审阅、可分享的文件，还是最终母版。',
            '处理所有预检警告，然后开始渲染。',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '更高的分辨率和画质需要更长的时间，生成的文件也更大。',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '当项目中除了主时间线之外还有其他时间线时，对话框顶部会出现**序列**菜单，用于选择要导出哪条时间线，并按它自己的分辨率和范围导出。',
        },
      ],
    },
    {
      title: '格式',
      blocks: [
        {
          kind: 'table',
          headers: ['输出', '格式'],
          rows: [
            ['视频容器', 'MP4、MOV、WebM、MKV'],
            ['仅音频', 'MP3、AAC、WAV'],
            ['软字幕轨道', 'WebM、MKV'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '有哪些编解码器可用取决于你的浏览器；当某个编解码器不可用时，DroneClean Studio 会发出警告或自动回退。',
        },
      ],
    },
    {
      title: '字幕',
      blocks: [
        {
          kind: 'paragraph',
          text: '当视频导出带有转录文本时，**字幕**控件决定如何包含字幕。可选项会根据你选择的容器而变化。',
        },
        {
          kind: 'table',
          headers: ['模式', '作用'],
          rows: [
            ['**关闭**', '导出的视频中不含字幕。'],
            ['**烧录**', '字幕被绘制进画面，因此在所有播放器中都会显示。'],
            ['**独立** `.srt`', '干净的视频，外加一个随之下载的独立 `.srt` 字幕文件。'],
            ['**内嵌轨道**', '容器内携带的可开关软字幕轨道。'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '内嵌轨道选项只会出现在 `WebM` 和 `MKV` 中。在 `MP4` 和 `MOV` 中，请选择烧录或独立文件，或者更换容器以获得可开关的轨道。',
        },
        {
          kind: 'note',
          tone: 'info',
          text: '有些播放器默认会隐藏字幕轨道，因此观众可能需要手动启用。',
        },
      ],
    },
    {
      title: '预检',
      blocks: [
        {
          kind: 'paragraph',
          text: '预检会在渲染之前运行，并标出常见的阻碍：范围为空、媒体缺失、编解码器不可用、回退到主线程导出、文件过大或渲染时间过长。',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '想做个快速检查，可以先导出一小段入点/出点范围，再决定是否进行完整渲染。',
        },
      ],
    },
    {
      title: '渲染与下载',
      blocks: [
        {
          kind: 'list',
          items: [
            '进度依次经过准备、渲染、编码和收尾，你可以随时点击**取消**。',
            '可用时，工作线程导出会在后台运行；回退到主线程时，则要求标签页保持在前台且不被打扰。',
            '完成后，选择**下载**保存文件，该文件同时也会写入你工作区中的导出文件夹。',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: '在导出完成之前，请保持项目标签页处于打开状态。如果要批量渲染多个任务，请把它们添加到**渲染队列**，而不是一个一个地导出。',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
