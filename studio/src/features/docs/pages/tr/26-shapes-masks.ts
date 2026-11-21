import type { DocPageContent } from '../../docs-content'

// order 11.5 places this right after Text, Captions, and Subtitles in Creative Tools.
const page = {
  order: 11.5,
  slug: 'shapes-masks',
  title: 'Şekiller ve Maskeler',
  description:
    'Şekil öğeleri ekleyin, kalem aracıyla özel yollar çizin ve herhangi bir şekli klip maskesi olarak kullanın.',
  category: 'Creative Tools',
  related: ['motion', 'properties', 'effects-color', 'keyframes'],
  sections: [
    {
      title: 'Şekil ekleme',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Şekiller** sekmesini açın ve bir şekli oynatma başlığına eklemek için tıklayın ya da belirli bir parçaya sürükleyin.',
            'Yerleşik şekiller: **Dikdörtgen**, **Daire**, **Elips**, **Üçgen**, **Yıldız**, **Çokgen** ve **Kalp**.',
            'Yeni bir şekil tuvale göre boyutlandırılmış ve seçili olarak gelir; konumlandırmaya ve biçimlendirmeye hazırdır.',
          ],
        },
      ],
    },
    {
      title: 'Şekli biçimlendirme',
      blocks: [
        {
          kind: 'table',
          headers: ['Denetim', 'Notlar'],
          rows: [
            ['Tür', 'Yedi şekil türü arasında geçiş yapın.'],
            ['Dolgu', 'Düz renk veya degrade dolgu.'],
            [
              'Kontur G. / Kontur',
              "Dış çizgi genişliği (0–50 px) ve rengi (genişlik 0'ın üzerindeyken gösterilir).",
            ],
            [
              'Çizgi Ucu / Çizgi Birleşimi',
              'Çizgi uçları ve bağlı çizgi parçalarının buluşma biçimi.',
            ],
            [
              'Yolları Kırp',
              'Bir yolun yalnızca bir bölümünü çizmek için Başlangıç, Bitiş ve Ofset denetimleri.',
            ],
            ['İnceltme', 'İnceltilmiş bir çizgi için başlangıç ve bitiş genişlikleri.'],
            ['Yarıçap', 'Dikdörtgen, üçgen, yıldız ve çokgen için köşe yuvarlama (0–100 px).'],
            ['Noktalar / İç Y.', 'Yıldız ve çokgen için nokta sayısı ve iç yarıçap.'],
            ['Yön', 'Bir üçgenin hangi yöne baktığı.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Konum, boyut, döndürme ve opaklık Dönüşüm denetimlerinde yer alır ve çoğu değer anahtar karelenebilir; bkz. [Anahtar Kare Animasyonu](keyframes).',
        },
      ],
    },
    {
      title: "Motion'da yol köşelerini canlandırma",
      blocks: [
        {
          kind: 'steps',
          items: [
            'Şekli **Motion** içinde açın ve özellik satırlarını genişletin.',
            'Önizlemede yol noktalarını seçin.',
            'Yalnızca o noktalara anahtar eklemek için **Selected vertices**, her noktayı açığa çıkarmak için **All vertices** seçeneğini seçin.',
            'Köşe koordinatlarına anahtar ekleyin ve yolu yeniden şekillendirmeden önce oynatma başlığını taşıyın.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Yol Geometrisi anahtarları yol topolojisini kilitler. İlk köşeyi eklemeden, kaldırmadan, yeniden sıralamadan veya değiştirmeden önce bunları kaldırın.',
        },
      ],
    },
    {
      title: 'Kalem aracıyla özel yol çizme',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Şekiller sekmesinde özel bir yol şekli çizmek için **Kalem** aracını seçin.',
            'Noktalar yerleştirmek için önizlemeye tıklayın; eğri (bezier) tutamaçları çekmek için bir noktaya tıklayıp sürükleyin.',
            'Backspace son noktayı kaldırır, Escape iptal eder.',
            'En az üç nokta varken onaylamak için **Finish Shape** seçeneğini (ya da **İptal**) seçin.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Bir yolu sonradan yeniden şekillendirmek için onu seçin ve **Yolu Düzenle** seçeneğini kullanın: noktaları ve tutamaçları sürükleyin, bir nokta eklemek için bir kenara çift tıklayın ve bir noktayı **Corner** ile **Bezier** arasında dönüştürün. İşiniz bitince **Tamam** seçeneğini seçin.',
        },
      ],
    },
    {
      title: 'Bir şekli maske olarak kullanma',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Şekli, maskelemek istediğiniz klibin **üstündeki** bir parçaya yerleştirin.',
            'Şekil bölümünde **Maske Olarak Kullan** seçeneğini açın.',
            'Bir **Maske Türü** seçin: sert kenarlar için **Klip**, yumuşak kenarlar için **Alfa**.',
            'Bir Alfa maskesi için kenarı yumuşatmak üzere **Yumuşatma** ayarını yapın; şeklin alanını göstermek yerine gizlemek için **Ters çevir** seçeneğini kullanın.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Bir maske, şekil geometrisine göre altındaki parçalardaki her şeyi etkiler. Yumuşatma yalnızca Alfa maskelere uygulanır; Klip maskeleri sert kenarlı kalır.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Bir maskeyi düzenlerken veya kalemle çizerken editörün geri kalanı kilitlidir; devam etmek için maske düzenlemeyi bitirin veya çıkın.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
