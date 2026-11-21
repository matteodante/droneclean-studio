import type { DocPageContent } from '../../docs-content'

const page = {
  order: 19,
  slug: 'render-queue',
  title: '渲染队列',
  description: '将多个导出加入队列，把一次渲染拆分成多个片段，管理队列，并找到已保存的文件。',
  category: 'Output',
  related: ['export'],
  sections: [
    {
      title: '将导出加入队列',
      blocks: [
        {
          kind: 'list',
          items: [
            '在导出对话框中，选择**添加到队列**，而不是立即渲染。',
            '可以把整个项目或当前范围加入队列。',
            '随时可以通过工具栏中的**渲染队列**按钮打开队列，该按钮会显示实时的任务数量。',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '队列中的导出会逐个渲染，并保存到你工作区中的导出文件夹。',
        },
      ],
    },
    {
      title: '分割为片段',
      blocks: [
        {
          kind: 'list',
          items: [
            '**分割为片段**会把一次渲染变成多个任务。',
            '使用**每个标记一个片段**，可以在时间线标记处断开渲染。',
            '也可以按固定的秒数分成等长的块。',
          ],
        },
      ],
    },
    {
      title: '管理队列',
      blocks: [
        {
          kind: 'list',
          items: [
            '**暂停**和**继续**队列，以控制渲染的时机。',
            '将排队的任务**上移**或**下移**，以改变它的顺序。',
            '**取消**正在运行或排队的任务，**重试**失败的任务，并**移除**已完成的任务。',
            '任务状态显示为排队中、渲染中、完成、失败或已取消；使用**清除已完成**或**清除全部**来整理。',
          ],
        },
      ],
    },
    {
      title: '已保存的导出',
      blocks: [
        {
          kind: 'list',
          items: [
            '切换到**已保存**标签页，查看已完成的文件。',
            '可以在那里下载或删除已保存的导出。',
            '这些文件存放在你工作区内的这个项目文件夹中。',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
