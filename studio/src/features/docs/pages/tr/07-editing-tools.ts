import type { DocPageContent } from '../../docs-content'

const page = {
  order: 7,
  slug: 'editing-tools',
  title: 'Kurgu Araçları',
  description:
    'Seçim, kesici, kırpma, slip, slide, hız uzatma ve ripple ile rolling kırpma davranışları.',
  category: 'Core Editing',
  related: ['timeline', 'keyboard-shortcuts', 'properties'],
  sections: [
    {
      title: 'Temel araçlar',
      blocks: [
        {
          kind: 'table',
          headers: ['Araç', 'Tuş', 'Kullanım'],
          rows: [
            ['Seçim', '`V`', 'Klipleri seçin, taşıyın ve düzenleyin.'],
            [
              'Kırpma düzenleme',
              '`T`',
              'Bir klibin nerede başlayıp bittiğini değiştirmek için kenarını sürükleyin.',
            ],
            ['Kesici', '`C`', 'Bir klibi tıkladığınız her yerden kesin.'],
            ['Hız uzatma', '`R`', 'Oynatma hızını değiştirerek süreyi değiştirin.'],
            ['Slip', '`Y`', 'Bir klibi yerinden oynatmadan içindeki kaynak kareleri değiştirin.'],
            ['Slide', '`U`', 'Bir klibi, komşu kesimleri ayarlayarak taşıyın.'],
          ],
        },
      ],
    },
    {
      title: 'Kırpma davranışları',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Ripple** kırpma bir kurguyu değiştirir ve sonraki tüm malzemeyi kaydırır; böylece toplam süre değişir.',
            '**Rolling** kırpma, iki komşu klip arasındaki kesimi taşır; toplam süre değişmez.',
            '**Slip** düzenlemesi, klibi veya komşularını taşımadan klibin içinde hangi kaynak karelerin göründüğünü değiştirir.',
            '**Slide** düzenlemesi, bir klibi parça boyunca taşırken komşu kesimleri otomatik olarak ayarlar.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ripple ve rolling, **Kırpma düzenleme** aracının davranışlarıdır; kendi kısayolları olan ayrı araçlar değildir.',
        },
      ],
    },
    {
      title: 'Klipleri senkron tutma',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Bağlı seçim** bir video klibini ve sesini birlikte taşır; `Shift+L` ile açıp kapatın.',
            'Bir ilişkinin değişmesi gerektiğinde klipleri `Ctrl+Alt+L` ile bağlayın, `Alt+Shift+L` ile bağlantıyı kaldırın.',
            'Bir parçadaki **Senkron kilidi**, ripple tarzı düzenlemeler sırasında zamanlamayı hizalı tutar.',
          ],
        },
      ],
    },
    {
      title: 'Yapısal düzenlemeler',
      blocks: [
        {
          kind: 'list',
          items: [
            'Tek bir kareyi tutmak için oynatma başlığına `Shift+F` ile bir **donmuş kare** ekleyin.',
            'Yoğun bir bölümü yeniden kullanmak veya sadeleştirmek için bir dizi klibi **bileşik klipte** gruplayın ya da bağımsız bir zaman çizelgesi olarak düzenlemek için **sekans** sekmesi olarak açın.',
            'Seçili görsel klipleri yapılandırılmış bir ızgaraya dizmek için **Bento düzeni** iletişim kutusunu kullanın.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
