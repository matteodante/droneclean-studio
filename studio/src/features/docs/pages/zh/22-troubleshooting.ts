import type { DocPageContent } from '../../docs-content'

const page = {
  order: 22,
  slug: 'troubleshooting',
  title: '故障排除',
  description: '针对浏览器、工作区、媒体、WebGPU、本地 AI 和导出问题的解决办法。',
  category: 'Reference',
  related: ['workspaces', 'export'],
  sections: [
    {
      title: '浏览器与工作区',
      blocks: [
        {
          kind: 'table',
          headers: ['症状', '解决办法'],
          rows: [
            [
              '浏览器不受支持，或没有工作区选择器',
              '使用 Chrome 或 Edge 113+，它们支持 DroneClean Studio 所需的 API。',
            ],
            [
              'Brave 无法选择文件夹',
              '启用 `brave://flags/#file-system-access-api` 并重新启动 Brave。',
            ],
            ['权限被拒绝', '选择一个你可以编辑的普通文件夹，然后允许读写访问。'],
            [
              '重新打开时要求重新连接',
              '对同一个文件夹选择**重新连接**；如果它已被移动，请选择其他文件夹。',
            ],
          ],
        },
      ],
    },
    {
      title: '媒体与导入',
      blocks: [
        {
          kind: 'table',
          headers: ['症状', '解决办法'],
          rows: [
            [
              '缺失媒体',
              '用**授予访问权限**、**定位**、**定位文件夹**或**浏览其他文件夹**重新链接。',
            ],
            ['导入失败或编解码器不受支持', '尝试浏览器支持的其他格式，或先对文件转码。'],
            ['从 URL 导入失败', '确保链接指向媒体文件本身，而不是嵌入该文件的网页。'],
            ['预览或波形已过时', '重新生成缩略图或代理，或在存储设置中清除项目缓存。'],
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: '只有在打算稍后重新链接文件时才使用**离线工作**，在此之前，片段会一直保持为失效的引用。',
        },
      ],
    },
    {
      title: 'WebGPU 与本地 AI',
      blocks: [
        {
          kind: 'table',
          headers: ['症状', '解决办法'],
          rows: [
            [
              '效果、示波器或 AI 不可用',
              'WebGPU 可能已关闭，请使用较新的 Chrome 或 Edge，更新 GPU 驱动，并保持硬件加速开启。',
            ],
            [
              '模型下载缓慢或失败',
              '保持标签页打开，在稳定的网络下重试；如果下载损坏，请清除**本地 AI 模型缓存**。',
            ],
            ['AI 工作期间内存不足', '使用**卸载本地模型**来释放运行时。'],
            ['LUT 导入被阻止', 'LUT (.cube) 导入需要基于 Chromium 的浏览器。'],
          ],
        },
      ],
    },
    {
      title: '导出',
      blocks: [
        {
          kind: 'table',
          headers: ['症状', '解决办法'],
          rows: [
            ['预检提示编解码器不可用', '选择其他编解码器或格式，或降低分辨率或画质。'],
            [
              '工作线程导出不可用',
              '保持标签页在前台，避免大量操作；把动画图片项目替换为视频片段可能有帮助。',
            ],
            [
              '导出文件很大或速度很慢',
              '先导出较短的入点/出点范围，降低分辨率或画质，并腾出磁盘空间。',
            ],
            [
              '导出无法开始',
              '处理所有阻止导出的预检警告，然后试着导出一小段范围，确认流程能正常运行。',
            ],
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
