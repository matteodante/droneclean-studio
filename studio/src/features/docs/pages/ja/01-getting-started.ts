import type { DocPageContent } from '../../docs-content'

const page = {
  order: 1,
  slug: 'getting-started',
  title: 'はじめに',
  description:
    'DroneClean Studio の概要、ブラウザーの要件、起動から書き出しまでの最初の編集手順を説明します。',
  category: 'Start',
  related: ['concepts', 'workspaces', 'export'],
  sections: [
    {
      title: 'DroneClean Studio とは',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio は、ブラウザー上だけで動作する**ローカルファースト**の動画編集ソフトです。アカウント登録もアップロードもサーバーでのレンダリングも不要で、編集、エフェクト、カラー、AIツール、書き出しのすべてが、お使いのマシンの GPU と CPU で実行されます。',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'メディアはお使いのデバイスから出ません。DroneClean Studio は元のファイルへのリンクを保持し、プロジェクト、キャッシュ、書き出したファイルは、ご自身で選んだ**ワークスペースフォルダ**に保存されます。クラウドには何も送信されません。',
        },
      ],
    },
    {
      title: 'ブラウザーの要件',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio は最新の Web API を利用するため、サポート対象は最新の Chromium 系ブラウザーです。',
        },
        {
          kind: 'table',
          headers: ['ブラウザー', '対応状況'],
          rows: [
            ['Chrome / Edge 113 以降', '完全に対応'],
            ['Brave', 'File System Access API のフラグを有効にすれば動作'],
            ['Safari / Firefox', 'すべての機能を使う用途には未対応'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio は、File System Access API（ワークスペースフォルダ）、WebCodecs（デコードと書き出し）、WebGPU（エフェクト、カラー、AI）、OPFS（キャッシュ）を使用します。ハードウェアアクセラレーションを有効にし、GPU ドライバーを最新の状態に保ってください。',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Brave ではフォルダーへのアクセスがブロックされることがあります。`brave://flags/#file-system-access-api` を開いて**有効**に設定し、Brave を再起動してください。',
        },
      ],
    },
    {
      title: '最初の編集',
      blocks: [
        {
          kind: 'steps',
          items: [
            'サポート対象のブラウザーで DroneClean Studio を開き、案内に従って読み書きできる**ワークスペースフォルダ**を選びます。',
            'プロジェクトページで**新規プロジェクト**を選び、編集に使う解像度とフレームレートを設定します。',
            '**メディア**タブを開き、**インポート**でファイルを追加します。ライブラリにメディアを直接ドラッグしても追加できます。',
            'メディアパネルからクリップをタイムラインのトラックにドラッグします。',
            '`Space` で再生し、`Left` と `Right` で1フレームずつ移動します。',
            '作業中は `Ctrl+S` で保存し、完成したら**書き出し**を選んで動画をレンダリングします。',
          ],
        },
      ],
    },
    {
      title: 'セットアップの確認',
      blocks: [
        {
          kind: 'list',
          items: [
            'ワークスペースの選択画面が開き、通常のフォルダー（保護されたシステムの場所ではないもの）を受け付ける。',
            'インポートしたメディアが、サムネイル付きのカードとしてメディアパネルに表示される。',
            '`Space` を押すと、タイムラインから再生が始まる。',
            '書き出しが開き、事前チェックで問題が報告されない。',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'いずれかの手順がうまくいかない場合は、該当する症状を **トラブルシューティング**ページで確認してください。',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
