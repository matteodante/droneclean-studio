import type { DocPageContent } from '../../docs-content'

const page = {
  order: 2,
  slug: 'workspaces',
  title: '工作区与存储',
  description: '工作区文件夹如何运作、文件存放在哪里、权限，以及缓存维护。',
  category: 'Start',
  related: ['concepts', 'projects', 'troubleshooting'],
  sections: [
    {
      title: '工作区模型',
      blocks: [
        {
          kind: 'list',
          items: [
            '**工作区**是磁盘上的一个文件夹，DroneClean Studio 会从中读取数据，也会向其中写入数据。',
            'DroneClean Studio 生成的所有内容都放在这里：项目文件、媒体元数据、缩略图、波形、转录文本、场景数据、AI 资源、缓存和导出文件。',
            '导入的源媒体不会复制到工作区中，DroneClean Studio 只记录指向每个文件原位置的链接。',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '工作区就是一个真实的文件夹，因此你可以像处理其他目录一样对它进行备份、同步或移动。',
        },
      ],
    },
    {
      title: '选择和切换工作区',
      blocks: [
        {
          kind: 'list',
          items: [
            '首次启动时，DroneClean Studio 会在打开编辑器之前要求你选择一个工作区。',
            '请选择一个你拥有权限的普通文件夹，例如“文档”中的某个文件夹，并避开受保护的系统位置。',
            '使用**工作区**控件可以添加、切换或移除已知的工作区。',
            '切换只会改变 DroneClean Studio 使用的文件夹，不会移动你的源媒体。',
          ],
        },
      ],
    },
    {
      title: '权限与重新连接',
      blocks: [
        {
          kind: 'paragraph',
          text: '出于安全考虑，浏览器可能会在两次会话之间让文件夹权限过期。',
        },
        {
          kind: 'list',
          items: [
            '当 DroneClean Studio 显示**重新连接你的工作区**时，点击**重新连接**，并授予对同一文件夹的读写权限。',
            '如果访问被拒绝，请重新选择该文件夹，并在浏览器弹出提示时允许访问。',
            '如果文件夹已被移动、重命名或删除，请改选其他文件夹。',
          ],
        },
      ],
    },
    {
      title: '缺失媒体',
      blocks: [
        {
          kind: 'list',
          items: [
            '“缺失媒体”表示 DroneClean Studio 目前无法读取一个或多个已链接的源文件。',
            '如果文件只是需要重新获得浏览器权限，请使用**授予访问权限**。',
            '如果文件或其所在文件夹被移动，请使用**定位**或**定位文件夹**。',
            '使用**浏览其他文件夹**，让 DroneClean Studio 指向媒体的新副本。',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: '只有在打算稍后重新链接文件时才使用**离线工作**；在此之前，片段会一直保持为失效的引用。',
        },
      ],
    },
    {
      title: '移动项目与清理缓存',
      blocks: [
        {
          kind: 'list',
          items: [
            '使用**导出项目**可以把项目及其媒体打包成便携的压缩包，供其他工作区导入。',
            '项目缓存操作会清除可重新生成的数据，例如波形、胶片条、GIF 帧和已解码的音频。',
            '在存储设置中，你还可以重新生成缩略图、生成缺失的代理，以及删除代理。',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '清理缓存绝不会删除你的源媒体；当项目需要时，DroneClean Studio 会重新生成预览。',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
