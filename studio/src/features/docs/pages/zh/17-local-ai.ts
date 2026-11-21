import type { DocPageContent } from '../../docs-content'

const page = {
  order: 17,
  slug: 'local-ai',
  title: '本地 AI 工具',
  description: '在浏览器内运行的文本转语音、音乐生成和转录，并在本地缓存模型。',
  category: 'Creative Tools',
  related: ['scene-browser', 'text-captions-subtitles', 'audio'],
  sections: [
    {
      title: '本地 AI 如何运作',
      blocks: [
        {
          kind: 'list',
          items: [
            'AI 工具在你的浏览器中使用你自己的硬件运行，不会向任何服务器发送内容。',
            '第一次使用某个模型时会下载一次，之后缓存在本地以供复用。',
            '模型运行期间，状态标签会显示加载中、运行中、就绪和出错等状态。',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '有些工具需要 Chrome 或 Edge 113+（或 Safari 26+）以及 WebGPU 支持。首次下载模型时，体积可能很大。',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: '模型许可证约束的是你，而不是我们：用 MusicGen 生成的音乐仅限非商业用途（CC BY-NC 4.0），Supertonic 语音遵循 OpenRAIL-M 许可证，该许可证禁止某些用途。AI 标签页会在你生成之前给出提示。',
        },
      ],
    },
    {
      title: '文本转语音',
      blocks: [
        {
          kind: 'steps',
          items: [
            '打开 **AI** 标签页并展开**文本转语音**，然后输入或粘贴你的文稿。',
            '选择引擎（见下表），然后选择声音，并在支持时设置语速、语言和表现力标签。',
            '预览效果，然后点击**保存并插入**，在播放头处放入已链接的音频，或点击**保存到库**。',
          ],
        },
        {
          kind: 'table',
          headers: ['引擎', '语言', '运行于'],
          rows: [
            ['Kokoro', '英语', 'WebGPU'],
            ['MOSS Nano', '20 种语言', 'CPU'],
            ['Supertonic 3', '31 种语言', '本地 ONNX'],
          ],
        },
      ],
    },
    {
      title: '音乐生成',
      blocks: [
        {
          kind: 'list',
          items: [
            '展开**音乐生成**，用提示词描述这首曲目，或从“Lo-fi chill”“Upbeat EDM”等预设开始。',
            '以秒为单位设置长度，然后点击**生成音乐**；首次运行会下载模型并缓存。',
            '预览片段，然后**保存并插入**到时间线，或**保存到库**。',
          ],
        },
      ],
    },
    {
      title: '转录',
      blocks: [
        {
          kind: 'list',
          items: [
            '转录位于媒体库和转录工作流程中，与 AI 标签页分开。',
            '**Parakeet** 是速度很快的默认引擎，涵盖多种欧洲语言。',
            '也可以使用 Whisper 模型（Tiny、Base、Small、Large v3 Turbo），必要时 DroneClean Studio 会回退到 Whisper。',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '转录文本是字幕、转录搜索和填充词移除的基础，请尽早生成。',
        },
      ],
    },
    {
      title: '管理模型与运行时',
      blocks: [
        {
          kind: 'list',
          items: [
            '打开**存储**设置来管理本地 AI。',
            '使用**本地 AI 模型缓存**查看或清除已下载的模型，在下载损坏时很有用。',
            '使用**卸载本地模型**来释放运行时并腾出内存。',
            '如果你不再需要结果，可以取消耗时较长的任务。',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
