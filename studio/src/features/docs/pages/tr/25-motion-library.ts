import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15.5,
  slug: 'motion-library',
  title: 'Hareketi uygulama ve yeniden kullanma',
  description:
    'Düzenlenebilir ön ayarlar uygulayın, canlı davranışlar ekleyin, metin hareketini ayarlayın ve animasyonu yeniden kullanmak için kaydedin.',
  category: 'Creative Tools',
  related: ['motion', 'keyframes', 'properties', 'text-captions-subtitles'],
  sections: [
    {
      title: 'Doğru animasyon alanını seçme',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio, iki yerde tek bir animasyon sistemi kullanır. Bir sekans klibini düzenlerken derli toplu **Animasyon** sekmesini kullanın ya da katmanlı kompozisyon çalışması için **Motion** bölümünü açın.',
        },
        {
          kind: 'table',
          headers: ['Alan', 'Ne için kullanılır'],
          rows: [
            [
              'Kurgu > Animasyon',
              'Yaygın ön ayarlar, uygulanan animasyon durumu, metin hareketi ve bir Motion Klibi oluşturma veya yeniden açma',
            ],
            [
              'Motion > Hareket kitaplığı',
              'Tam ön ayar kataloğu, canlı davranışlar, kayıtlı animasyonlar ve seçili katman denetimleri',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: "Bir veya daha fazla Kurgu klibi seçin ve bunları katmanlı bir kompozisyonun içinde korumak için **Motion Klibi Oluştur** seçeneğini seçin. Var olan bir Motion Klibi seçin ve katmanlarını düzenlemek için **Motion'da Aç** seçeneğini seçin.",
        },
      ],
    },
    {
      title: 'Düzenlenebilir bir ön ayar uygulama',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Bir veya daha fazla klip ya da Motion katmanı seçin.',
            '**Giriş**, **Çıkış** veya **Vurgu** altından bir ön ayar seçin.',
            '**Uygularken** ayarını, aynı amaçlı hareketi değiştirmek için **Bölgeyi değiştir**, mevcut anahtar kareleri korumak için **Katman ekle** olarak belirleyin.',
            'Üretilen anahtar kareleri ayarlamak için özellik satırlarını veya değer grafiğini açın.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '**Uygulanan** bölümü, elle eklenen anahtar kareleri ve her ön ayar uygulamasını ayrı ayrı listeler. Oynatma başlığını ilk anahtar karesine taşımak için bir girdiyi seçin.',
        },
      ],
    },
    {
      title: 'Canlı bir davranış ekleme',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Canlı davranışlar, anahtar kare oluşturmadan oynatma sırasında hesaplanır. Ayarlanabilir hareket için canlı bırakın ya da kare düzeyinde denetime ihtiyaç duyduğunuzda pişirin.',
        },
        {
          kind: 'table',
          headers: ['Davranış', 'Sonuç'],
          rows: [
            ['Float drift', 'Konumu ve döndürmeyi kaydırır'],
            ['Sway', 'İleri geri döndürür'],
            ['Breath pulse', 'Boyutu ve opaklığı değiştirir'],
            ['Spin', 'Sürekli döndürür'],
            ['Micro shake', 'Tohumlanmış konum ve döndürme titremesi ekler'],
          ],
        },
        {
          kind: 'list',
          items: [
            'Bir davranışı varsayılan ayarlarla uygulamak için davranış karosunu seçin.',
            'Uygulanan denetimlerinden **Yoğunluk** ve **Süre** ayarlarını yapın.',
            'Prosedürel hareketin nerede çalıştığını görmek için Motion zaman çizelgesindeki taralı banda bakın.',
            'Her klibi aynı anda hareket ettirmek yerine fazlarını kaydırmak için bir davranışı birkaç kliba uygulayın.',
          ],
        },
      ],
    },
    {
      title: 'Metin hareketini zaman çizelgesinde ayarlama',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Metin hareketi; karakterleri, sözcükleri, satırları veya tüm klibi, canlı **Giriş**, **Çıkış** ve **Döngü** yuvaları üzerinden canlandırır.',
        },
        {
          kind: 'list',
          items: [
            'Bir metin klibi seçin, ardından **Animasyon** sekmesinde veya Hareket kitaplığında her yuva için bir ön ayar seçin.',
            "Süresini değiştirmek için Motion'da bir metin hareketi bandının kenarını sürükleyin.",
            'Başlangıcını veya bitişini kaydırmak için bir **Giriş** ya da **Çıkış** bandını klip kenarından uzağa sürükleyin.',
            'Oynatma başlığını banda taşımak için **Uygulanan** girdisini seçin.',
          ],
        },
      ],
    },
    {
      title: 'Uygulanan animasyonu inceleme ve temizleme',
      blocks: [
        {
          kind: 'list',
          items: [
            'Elle eklenen anahtar kareleri, üretilen anahtar kareleri, canlı davranışları ve metin hareketini ayırt etmek için **Uygulanan** bölümünü kullanın.',
            'İlgisiz anahtar kareleri silmeden tek bir ön ayar uygulamasını kaldırın.',
            'Bir canlı davranışı veya metin hareketi yuvasını kendi satırından kaldırın.',
            'Bir kırpma anahtarları klibin dışında bıraktığında, yalnızca park edilmiş o anahtar kareleri silmek için **Animasyonu kırp** seçeneğini kullanın.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: "**Animasyonu kırp** saklanan animasyonu değiştirir. Kaldırılan anahtarları geri istiyorsanız bildirimdeki eylemi veya Geri Al'ı kullanın.",
        },
      ],
    },
    {
      title: 'Hareketi pişirme, kaydetme ve yeniden kullanma',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Canlı katman davranışlarını düzenlenebilir özellik anahtarlarına örneklemek için **Anahtar karelere pişir** seçeneğini seçin.',
            'Saklamak istediğiniz animasyonu içeren bir klip seçin.',
            '**Animasyonu kaydet** seçeneğini seçin, bir ad girin ve proje kitaplığına kaydedin.',
            'Kayıtlı animasyonu uyumlu başka bir kliba veya katmana uygulayın.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Kayıtlı animasyonlar düzenlenebilir anahtar kareleri, canlı katman davranışlarını, metin hareketini ya da bunların bir birleşimini içerebilir. Dışa aktarılan projeler, kayıtlı animasyon kitaplığını da taşır.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
