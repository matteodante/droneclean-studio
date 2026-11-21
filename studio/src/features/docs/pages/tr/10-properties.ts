import type { DocPageContent } from '../../docs-content'

const page = {
  order: 10,
  slug: 'properties',
  title: 'Klip Özellikleri',
  description: 'Dönüşüm, kırpma, opaklık ve karışım ile her klip türüne özgü denetimler.',
  category: 'Core Editing',
  related: ['audio', 'text-captions-subtitles', 'effects-color', 'keyframes'],
  sections: [
    {
      title: 'Seçim paneli nasıl yönlendirir',
      blocks: [
        {
          kind: 'list',
          items: [
            'Tüm özelliklerini düzenlemek için tek bir klip seçin.',
            'Ortak bir özelliği hepsinde birden değiştirmek için birkaç klip seçin.',
            'Panel, yalnızca geçerli seçime uygulanan özellik grupları için sekmeler gösterir.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '**Karışık** değeri, seçili klipler o ayarı şu anda paylaşmıyor demektir; değiştirmek hepsine tek bir değer uygular.',
        },
      ],
    },
    {
      title: 'Görsel klipler için ortak denetimler',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Dönüşüm**: konum, boyut, döndürme ve çapa noktası.',
            '**Kırpma**: her kenarı içeri doğru kırpma ve kırpma kenarı için bir yumuşaklık denetimi.',
            '**Opaklık** ve **Karışım**: bir klibi soldurun ve altındaki katmanların üzerine nasıl bileşileceğini seçin.',
            '**Video**: video klipleri için oynatma hızı ve ilgili zamanlama.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Birçok sayısal denetim canlandırılabilir; değerin yanındaki anahtar kare düğmesine bakın.',
        },
      ],
    },
    {
      title: 'Türe özgü denetimler',
      blocks: [
        {
          kind: 'table',
          headers: ['Klip türü', 'Denetimler'],
          rows: [
            [
              'Ses',
              'Kazanç, giriş/çıkış solması, perde ve klip başına ekolayzer (bkz. Ses Düzenleme).',
            ],
            [
              'Metin',
              'İçerik, yazı tipi, boyut, renk, hizalama, arka plan, aralık, efektler ve animasyon (bkz. Metin sayfası).',
            ],
            ['Şekil', 'Şekil türü, yol, dolgu, çizgi, maske ve yumuşatma.'],
            ['Altyazı', 'İpucu zamanlaması ve metni ile altyazı stili ön ayarları.'],
            ['Renk', 'Çarklar, eğriler ve renk düzenleme araçları (bkz. Efektler ve Renk).'],
          ],
        },
      ],
    },
    {
      title: 'İşaretçiler',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Özellikler paneli, projedeki her işaretçiyi **İşaretçiler** başlığı altında, zamana göre sıralı olarak listeler. Liste her zaman kullanılabilir: hiçbir şey seçili değilken tuval ayarlarının altında, bir işaretçi seçiliyken işaretçi düzenleyicisinin altında görünür; böylece neyin seçili olduğundan bağımsız olarak işaretçilerinize göz atabilir ve ulaşabilirsiniz.',
        },
        {
          kind: 'list',
          items: [
            'Her satır işaretçi rengini, etiketini (yoksa varsayılan bir adı) ve zaman kodunu gösterir.',
            'Bir satırı etkin işaretçi yapmak ve oynatma başlığını o noktaya atlatmak için satırı seçin.',
            'Yalnızca o işaretçiyi kaldırmak için satırdaki çöp kutusu simgesini kullanın.',
            '**Tümünü temizle** her işaretçiyi bir kerede kaldırır.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Oynatma başlığına işaretçi bırakmak için `M` tuşuna basın. Liste boşken bu ipucunu gösterir.',
        },
        {
          kind: 'paragraph',
          text: 'Bir işaretçiyi seçmek, listenin üstünde düzenleyicisini açar; burada **Kare** konumunu değiştirebilir, **Etiket** alanını düzenleyebilir ve **Renk** değerini hazır bir renk örneğinden ayarlayabilir ya da varsayılana sıfırlayabilirsiniz. **Zaman** alanı işaretçi zaman kodunu salt okunur gösterir; **İşaretçiyi Sil** onu kaldırır.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
