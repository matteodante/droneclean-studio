import type { DocPageContent } from '../../docs-content'

const page = {
  order: 6,
  slug: 'timeline',
  title: 'Temel Zaman Çizelgesi Kurgusu',
  description:
    'Parçalar, klip ekleme, seçim, bölme ve birleştirme, silme, yakalama, işaretçiler, aralıklar, sekanslar ve yakınlaştırma.',
  category: 'Core Editing',
  related: ['editing-tools', 'preview', 'media', 'export', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Parçalar',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Video parçaları** görsel öğeleri taşır: video, görüntü, metin, şekil, altyazı ve ayar katmanları.',
            '**Ses parçaları** ses kliplerini ve video dosyalarına bağlı sesi taşır.',
            'Daha fazla yere ihtiyaç duyduğunuzda **Video parçası ekle** veya **Ses parçası ekle** seçeneğiyle parça ekleyin.',
            'Parça denetimleri arasında **Kilit**, **Solo**, **Etkinleştir/Devre dışı bırak** (görünürlük) ve senkron kilidi bulunur.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Parça grupları tek seviye derinliğindedir ve başlık gibi davranır; sessize alma, görünürlük ve kilit, bir gruptan altındaki parçalara geçer.',
        },
      ],
    },
    {
      title: 'Klip ekleme ve düzenleme',
      blocks: [
        {
          kind: 'list',
          items: [
            'Medya panelinden bir klibi bir video ya da ses parçasına sürükleyin.',
            'Klipleri taşımak ve yeniden düzenlemek için **Seçim** aracını (`V`) kullanın.',
            '**Bağlı seçim**, bir video klibini ve sesini birlikte hareket ettirir; yalnızca birini düzenlemek için bağlantıyı kaldırın.',
            'Seçili bir öğeyi `Shift+Arrow` (1 px) veya `Ctrl+Shift+Arrow` (10 px) ile kaydırın.',
          ],
        },
      ],
    },
    {
      title: 'Bölme, birleştirme ve silme',
      blocks: [
        {
          kind: 'list',
          items: [
            'Oynatma başlığında `Alt+C` ile bölün ya da tıkladığınız her yerden kesmek için **Kesici** aracını (`C`) kullanın.',
            'Aynı klibin bitişik bölümlerini `Shift+J` ile birleştirin.',
            '**Sil** bir boşluk bırakır; **Ripple sil** (`Ctrl+Delete`) klibi kaldırır ve boşluğu kapatır.',
            'Klipleri bir araya çekip bir parçadaki boş alanı kaldırmak için **Tüm boşlukları kapat** seçeneğini kullanın.',
          ],
        },
      ],
    },
    {
      title: 'Yakalama, işaretçiler ve aralıklar',
      blocks: [
        {
          kind: 'list',
          items: [
            'Klipler yakındaki kesimlere, işaretçilere ve oynatma başlığına yapışsın diye yakalamayı `S` ile açıp kapatın.',
            'Notlar ve zamanlama referansları için `M` ile işaretçi ekleyin; işaretçiler arasında `[` ve `]` ile atlayın.',
            'Önizleme ve dışa aktarma için bir aralık belirlemek üzere bir giriş noktası (`I`) ve bir çıkış noktası (`O`) ayarlayın; bunları `Alt+X` ile temizleyin.',
          ],
        },
      ],
    },
    {
      title: 'Sekanslar (çoklu zaman çizelgesi)',
      blocks: [
        {
          kind: 'paragraph',
          text: '**Sekans**, kendi parçaları, klipleri, işaretçileri ve giriş/çıkış aralığı olan, kendi başına bir zaman çizelgesidir. Zaman çizelgesinin üstündeki sekme çubuğu **Main** zaman çizelgesini ve tüm sekansları listeler; hangisini düzenlediğinizi değiştirmek için bir sekmeye tıklayın.',
        },
        {
          kind: 'list',
          items: [
            'Sekme çubuğunun sonundaki **+** düğmesiyle bir sekans oluşturun; kendi sekmesi olarak açılır.',
            'Sekanslar arasında bir sekmeye tıklayarak geçin; **Main** sekmesi her zaman ilktir.',
            'Bir sekmeyi **yeniden adlandırmak** için çift tıklayın ya da **Rename**, **Close tab** ve **Delete sequence** için sekme seçenekleri menüsünü (⋮) kullanın.',
            '**Close tab** yalnızca sekmeyi kaldırır; sekans Medya panelinde ve ona başvuran tüm kliplerde kullanılabilir kalır. **Delete sequence** onu, ona başvuran tüm kliplerle birlikte tamamen kaldırır (geri alınabilir).',
            'Bir **bileşik klip** sekans sekmesi olarak açılabilir: Medya panelinde bir bileşik klibe sağ tıklayın ve bağımsız bir zaman çizelgesi olarak düzenlemek için **Sekme olarak aç** seçeneğini seçin.',
            'Bir sekansı, klip olarak iç içe yerleştirmek için zaman çizelgesine bırakın (**Sekans** etiketli); sekmesine geçmek için o klibe çift tıklayın.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Her sekans kendi işaretçilerini, giriş/çıkış aralığını, görünümünü ve geri alma geçmişini tutar; sekmeler arasında geçmek bunları asla karıştırmaz.',
        },
      ],
    },
    {
      title: 'Yakınlaştırma ve geri alma',
      blocks: [
        {
          kind: 'list',
          items: [
            "`Ctrl+=` ve `Ctrl+-` ile yakınlaştırın, tüm kurguyu `\\` ile sığdırın ve `Shift+\\` ile %100'e dönün.",
            'Yakınlaştırma yalnızca görünümü değiştirir, klip zamanlamasını asla değiştirmez.',
            "`Ctrl+Z` ile geri alın, `Ctrl+Shift+Z` ile yineleyin; geri alma geçmişi derinliği Ayarlar'da yapılandırılabilir.",
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
