import type { DocPageContent } from '../../docs-content'

const page = {
  order: 12,
  slug: 'audio',
  title: 'Ses Düzenleme',
  description:
    'Seslendirme kaydedin; klip kazancını, solmaları, perdeyi, klip başına ekolayzeri, mikseri ve sayaçları ayarlayın; sessizlik ve dolgu sözcüklerini temizleyin.',
  category: 'Creative Tools',
  related: ['properties', 'local-ai'],
  sections: [
    {
      title: 'Bir klibi ayarlama',
      blocks: [
        {
          kind: 'paragraph',
          text: "Bir klip seçin ve Özellikler'de **Ses** sekmesini açın.",
        },
        {
          kind: 'table',
          headers: ['Denetim', 'Aralık'],
          rows: [
            ['Kazanç', '-60 dB ile +12 dB (−60 dB klibi fiilen sessize alır)'],
            ['Açılma / Kapanma', 'Her biri 0 ile 5 saniye'],
            ['Perde', 'Hızdan bağımsız olarak Yarım Sesler ve cent'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Ses düzeyi çizgisini ve solma tutamaçlarını zaman çizelgesinde doğrudan klibin üzerinde de sürükleyebilirsiniz; ayrıca **Kazanç**, bir klip boyunca artıp azalması için anahtar karelenebilir.',
        },
      ],
    },
    {
      title: 'Perde ve ton',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Perde** denetimleri, klip hızını değiştirmeden perdeyi kaydırır. Bunun yerine hızı değiştirmek için Video sekmesindeki **Hız** ayarını kullanın.',
            '**Ekolayzer** bölümü, ton şekillendirme için her kliple birlikte bir eğri düzenleyici sunar.',
          ],
        },
      ],
    },
    {
      title: 'Mikser ve sayaçlar',
      blocks: [
        {
          kind: 'list',
          items: [
            'Oynatırken stereo düzeylerini izlemek ve kırpılmayı yakalamak için ses **Sayaçlarını** açın.',
            'Proje genelinde düzeyleri dengelemek için **Mikseri** kullanın.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Önizlemedeki monitör ses düzeyi yalnızca yerel oynatmayı etkiler ve dışa aktarılan miksajı asla değiştirmez.',
        },
      ],
    },
    {
      title: 'Seslendirme kaydetme',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Zaman çizelgesi araç çubuğundaki **Seslendirme kaydet** (mikrofon) düğmesi, anlatımı projenizle eş zamanlı kaydeder. Kayıt **zaman çizelgesi oynarken** çalışır ve biten çekim, başladığınız oynatma başlığı konumuna sabitlenmiş yeni bir ses parçasına yerleşir.',
        },
        {
          kind: 'steps',
          items: [
            'Oynatma başlığını seslendirmenin başlaması gereken yere getirin.',
            '**Mikrofon** düğmesine tıklayın; zaman çizelgesi oynamaya başlar ve kayıt başlar.',
            'Oynatma başlığını ve mikrofonu birlikte durdurmak için **Kaydı duraklat**, devam etmek için **Kaydı sürdür**, bitirip klibi yeni bir ses parçasına bırakmak için **Durdur ve kaydet** seçeneğini kullanın.',
            'Hiçbir şey eklemeden çekimi atmak için **Kaydı iptal et** düğmesine (✕) tıklayın.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Bir giriş aygıtı seçmek ve kaydı ayarlamak için **Mikrofon ayarları** bölümünü (düğmenin yanındaki ▾) açın. Oradaki düzey göstergesi canlıdır; böylece kayıttan önce mikrofonunuzu kontrol edebilirsiniz.',
        },
        {
          kind: 'table',
          headers: ['Ayar', 'Ne yapar'],
          rows: [
            ['Gürültü bastırma', 'Sabit arka plan gürültüsünü azaltır. Varsayılan olarak açıktır.'],
            ['Otomatik kazanç', 'Sesinizi tutarlı bir düzeyde tutar. Varsayılan olarak açıktır.'],
            [
              'Kayıt sırasında zaman çizelgesini sessize al',
              'Hoparlör sesinin mikrofona karışmaması için zaman çizelgesi monitörünü susturur. Varsayılan olarak açıktır.',
            ],
            [
              'Senkron kaydırma',
              "Giriş gecikmesini telafi etmek için kaydedilen klibi daha erkene veya geriye kaydırır (±1000 ms'ye kadar).",
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Proje sesinizin mikrofona asla girmemesi için kulaklık kullanın; böylece anlatım yaparken miksajı duymak için **Kayıt sırasında zaman çizelgesini sessize al** ayarını kapatabilirsiniz.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Kayıt sırasında konum arama devre dışıdır; `Space` tuşuna basmak ya da zaman çizelgesinin sonuna ulaşmak çekimi bitirir. Bu, kaydı oynatma başlığına kilitli tutar; böylece senkronizasyondan asla kayamaz.',
        },
      ],
    },
    {
      title: 'Diyalogu temizleme',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Sessizliği kaldır** sessiz aralıkları bulur ve keser; **Minimum sessizlik** ayarı bir boşluğun ne kadar uzun olması gerektiğini belirler ve iletişim kutusu ne kadarının kaldırılacağını tahmin eder.',
            '**Dolgu sözcüklerini kaldır**, transkriptten ve sesten "ııı" ve "eee" gibi sözcükleri algılar ve kaldırır.',
            'Her iki araç da kaldıracağı aralıkları gösterir; böylece düzenlemeyi uygulamadan önce önizleyebilirsiniz.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Transkript dolgu sözcüğü algılamasını iyileştirir; en iyi sonuç için önce bir tane oluşturun.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
