import type { DocPageContent } from '../../docs-content'

const page = {
  order: 23,
  slug: 'reference',
  title: 'Başvuru',
  description: 'Desteklenen biçimler ve bu kılavuzda kullanılan terimlerin sözlüğü.',
  category: 'Reference',
  related: ['concepts', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Biçimler',
      blocks: [
        {
          kind: 'table',
          headers: ['Kullanım', 'Türler'],
          rows: [
            ['İçe aktarma', 'Video, ses, görüntü, GIF, SVG, üretilmiş varlıklar, bileşik klipler'],
            ['Video dışa aktarma', 'MP4, MOV, WebM, MKV'],
            ['Ses dışa aktarma', 'MP3, AAC, WAV'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Codec desteği, tarayıcınızın neyi çözüp kodlayabildiğine bağlıdır.',
        },
      ],
    },
    {
      title: 'Kurgu terimleri',
      blocks: [
        {
          kind: 'table',
          headers: ['Terim', 'Anlamı'],
          rows: [
            [
              'Giriş/çıkış aralığı',
              'Kaynak düzenlemeleri ve dışa aktarma aralıkları için kullanılan, işaretlenmiş bir başlangıç ve bitiş.',
            ],
            [
              'Kaynak payı',
              'Bir klip kenarının ötesindeki yedek kareler; kırpmalar ve geçişler için gereklidir.',
            ],
            [
              'Ripple düzenleme',
              'Zaman çizelgesinde yer açmak veya kapatmak için sonraki malzemeyi kaydıran düzenleme.',
            ],
            ['Rolling düzenleme', 'İki komşu klip arasındaki kesimi taşıyan düzenleme.'],
            ['Slip düzenleme', 'Klibi taşımadan klibin içindeki kaynak kareleri değiştirir.'],
            ['Slide düzenleme', 'Bir klibi, komşu kesimlerini ayarlayarak taşır.'],
          ],
        },
      ],
    },
    {
      title: 'Özellik terimleri',
      blocks: [
        {
          kind: 'table',
          headers: ['Terim', 'Anlamı'],
          rows: [
            ['Çalışma alanı', "DroneClean Studio'nun okuyup yazdığı klasör."],
            [
              'Proxy',
              'Daha akıcı oynatma için kullanılan, ağır medyanın üretilmiş hafif bir kopyası.',
            ],
            [
              'Bileşik klip',
              'Zaman çizelgesinin tek bir yeniden kullanılabilir medya öğesinde gruplanmış bir bölümü.',
            ],
            [
              'Ayar katmanı',
              'Efektleri ve renk düzenlemesi altındaki kliplere uygulanan bir katman.',
            ],
            ['Anahtar kare', 'Bir özelliği canlandırmak için belirli bir zamanda ayarlanan değer.'],
            ['LUT', 'Bir renk dönüşümü uygulayan arama tablosu (.cube).'],
            [
              'Yama hedefi',
              'Bir kaynak monitörü düzenlemesinin gönderildiği zaman çizelgesi parçası.',
            ],
            ['Render kuyruğu', 'Tek tek işlenen dışa aktarmaların sıralı listesi.'],
            ['Ön kontrol', 'Bir dışa aktarma başlamadan önce çalışan hazırlık denetimi.'],
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
