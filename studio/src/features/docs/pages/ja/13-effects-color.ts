import type { DocPageContent } from '../../docs-content'

const page = {
  order: 13,
  slug: 'effects-color',
  title: 'エフェクトとカラー',
  description:
    'GPU エフェクトの追加と重ね掛け、ホイールとカーブによるグレーディング、スコープの読み方、LUT の適用、補正範囲の限定を説明します。',
  category: 'Creative Tools',
  related: ['keyframes', 'shapes-masks', 'properties'],
  sections: [
    {
      title: 'エフェクトの追加と管理',
      blocks: [
        {
          kind: 'steps',
          items: [
            'クリップを選択し、プロパティの**エフェクト**セクションを開きます。',
            '**エフェクトを追加**を使い、検索するかカテゴリから選びます。組み込みの**プリセット**や、保存した自分のプリセットも追加できます。',
            '**上へ移動**と**下へ移動**でスタックの順序を変更します。順序によってエフェクトの合成結果が変わります。',
            'エフェクトのパネルから、無効化、リセット、削除ができます。数値のパラメーターにはキーフレームを設定できます。',
          ],
        },
      ],
    },
    {
      title: 'エフェクトカタログ',
      blocks: [
        {
          kind: 'table',
          headers: ['カテゴリ', 'エフェクト'],
          rows: [
            [
              'カラー',
              'Brightness、Contrast、Exposure、Saturation、Vibrance、Hue Shift、Temperature、Levels、Curves、Color Wheels、Gradient Map、LUT',
            ],
            ['ぼかし', 'Gaussian、Box、Motion、Radial、Zoom'],
            [
              '歪み',
              'Pixelate、RGB Split、Twirl、Wave、Bulge/Pinch、Kaleidoscope、Mirror、Fluted Glass、Ripple Glass、Glass Mosaic、Blocks、Droste ほか',
            ],
            [
              'スタイル化',
              'Vignette、Film Grain、Sharpen、Glow、Scanlines、CRT、VHS、Halftone、Dither、ASCII、Ink、Pixel Sort、Block Glitch、Color Glitch',
            ],
            ['キーイング', 'Chroma Key（グリーンバック・ブルーバックの除去）'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'すべてのエフェクトは GPU（WebGPU）でレンダリングされます。最近追加されたものには、**Gradient Map**、**VHS**、**CRT**、**Droste**、**Block Glitch**、歪みの **Ripple Glass** と **Glass Mosaic**、**Ink**、**Pixel Sort** があります。',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '**ASCII** は独自の文字でもレンダリングできます。**Character Set** を**カスタム**に設定し、**カスタム文字**を入力して（濃い順から薄い順に並べます）、**フォント**（Monospace、Courier、Consolas、Lucida Console）を選びます。組み込みのセットには、ASCII Ramp、Dense、Binary、Symbols があります。',
        },
      ],
    },
    {
      title: 'カラー入力とスポイト',
      blocks: [
        {
          kind: 'list',
          items: [
            'すべてのカラーコントロールは **16進数**の値を受け付けます。フィールドに直接入力すると、プレビューが入力と同時に更新されます。',
            '透明度に対応している場所では、フィールドは 8桁の16進数（`#rrggbbaa`）を受け付け、ピッカーにはアルファスライダーが加わります。',
            '**スポイト**をクリックすると、アプリ内やプレビューのどこからでも色を取得できます。拡大鏡がカーソルに付いてくるので、狙ったピクセルに合わせてクリックすれば適用されます。',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'スポイトはアプリ内蔵のサンプラーで（ブラウザー標準のものではありません）、許可の確認は不要です。カラーワークスペースのホイールにも同じツールが使われています。',
        },
      ],
    },
    {
      title: 'カラーワークスペースでのグレーディング',
      blocks: [
        {
          kind: 'list',
          items: [
            '**カラー**ワークスペース（`Alt+2`）に切り替えてクリップを選択します。グレードがまだなくても、ホイールとカーブをすぐに使えます。',
            '**カラーホイール**では、シャドウ、中間調、ハイライト、オフセットを調整できます。ホワイトバランスのピッカーとオートバランスも備えています。',
            '**カーブ**では、マスター、レッド、グリーン、ブルーの各チャンネルを編集できます。カーブをクリックするとポイントを追加し、ポイントをダブルクリックすると削除します。',
            '**前**、**後**、**分割**で比較でき、**グレーディングをコピー**と**グレーディングをペースト**でクリップ間でルックをコピーできます。',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '**グレーディングをバイパス**は、グレーディング前の映像をプレビューしますが、書き出しには影響しません。',
        },
      ],
    },
    {
      title: 'スコープの読み方',
      blocks: [
        {
          kind: 'table',
          headers: ['スコープ', '表示内容'],
          rows: [
            ['ウェーブフォーム', '輝度と色の分布を上下方向に表示'],
            ['RGBパレード', '赤、緑、青のチャンネルを横に並べて表示'],
            ['ベクトルスコープ', '色相と彩度'],
            ['ヒストグラム', '階調の分布'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'スコープは**カラースコープを表示**で切り替えます。ウェーブフォームとヒストグラムには、RGB、単一チャンネル、輝度（Y）の表示もあります。',
        },
      ],
    },
    {
      title: 'LUT と補正範囲の限定',
      blocks: [
        {
          kind: 'list',
          items: [
            '**LUT (.cube)** エフェクトを追加して**.cube LUT を読み込む**を選び、**強度**を設定して馴染ませます。',
            '**セカンダリークオリファイア**は、色相、彩度、輝度の範囲を指定して補正をかけます。',
            '**パワーウィンドウ**は、補正を楕円または長方形のマスクに限定し、ぼかしと反転も使えます。',
            '**調整レイヤー**を追加すると、その下のトラックにあるすべてのクリップに、グレーディングやエフェクトをまとめて適用できます。',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'LUT のインポートには、Chromium ベースのブラウザーが必要です。',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
