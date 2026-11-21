import type { DocPageContent } from '../../docs-content'

const page = {
  order: 4,
  slug: 'editor',
  title: 'Editör Düzeni ve Gezinme',
  description:
    'Araç çubuğu, medya kenar çubuğu, önizleme monitörü, zaman çizelgesi, özellikler ve Kurgu, Renk ve Motion çalışma alanları.',
  category: 'Start',
  related: ['concepts', 'timeline', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Ana alanlar',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Editör araç çubuğu** (üstte): Projelere Dön, çalışma alanı sekmeleri, proje özellikleri, dil, Ayarlar, Klavye Kısayolları, Kaydet, Dışa Aktar ve Render kuyruğu.',
            '**Medya kenar çubuğu** (solda): varlıklarınız ve oluşturma araçları.',
            '**Önizleme monitörü**: geçerli kare; bindirmeler, maskeler, kapsamlar ve oynatma denetimleriyle birlikte.',
            '**Zaman Çizelgesi** (altta): parçalar, klipler, işaretçiler ve kurgu araçları.',
            '**Özellikler** paneli: seçtiğiniz klip veya klipleri düzenler.',
          ],
        },
      ],
    },
    {
      title: 'Medya kenar çubuğu sekmeleri',
      blocks: [
        {
          kind: 'table',
          headers: ['Sekme', 'İçerik'],
          rows: [
            [
              'Medya',
              "İçe aktarılan varlıklar, medya bilgisi, proxy'ler, transkriptler, altyazılar, bileşik klipler, eksik medya denetimleri",
            ],
            ['Metin', 'Tek aralıklı ve çok aralıklı şablonlardan metin klipleri'],
            ['Şekiller', 'Üretilmiş şekil öğeleri'],
            ['Efektler', 'Seçili klip için GPU efektleri'],
            ['Geçişler', 'Kesimlere sürüklenecek geçişler'],
            ['YZ', 'Yerel metinden sese ve müzik oluşturma'],
          ],
        },
      ],
    },
    {
      title: 'Çalışma alanları',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Kurgu** çalışma alanı (`Alt+1`), düzenleme, kırpma, metin, şekiller, efektler, geçişler ve önizleme için varsayılan kesim düzenidir.',
            '**Renk** çalışma alanı (`Alt+2`), seçili klip için renk çarkları, eğriler ve kapsamlarla renk düzenlemeye odaklanır.',
            '**Motion** çalışma alanı; katmanlı kompozisyonları, anahtar kareleri, grafikleri, ön ayarları ve prosedürel animasyonu bir araya getirir. Ayrıntılar için [Motion Çalışma Alanı](motion) sayfasına bakın.',
            "Kurgu'da görsel bir klip seçin ve yaygın ön ayarlar, uygulanan animasyon durumu, metin hareketi ve **Motion Klibi Oluştur** için Özellikler'deki **Animasyon** bölümünü açın.",
            'Çalışma alanlarını ortadaki araç çubuğu sekmelerinden değiştirin ya da `Alt+1`, `Alt+2` ve `Alt+3` tuşlarını kullanın.',
          ],
        },
      ],
    },
    {
      title: 'Yardım alma ve güvende kalma',
      blocks: [
        {
          kind: 'list',
          items: [
            'Genel, zaman çizelgesi, YZ ve depolama tercihleri için **Ayarlar** bölümünü açın.',
            'Komutlarda arama yapmak, tuşları yeniden atamak ve ön ayarları içe veya dışa aktarmak için **Klavye Kısayolları** bölümünü açın.',
            "`Ctrl+S` ile sık sık kaydedin; otomatik kaydetme, Ayarlar'da belirlediğiniz bir aralıkla da çalışabilir.",
            'Bir şey ters giderse Geri Al ve Yinele (`Ctrl+Z` ve `Ctrl+Shift+Z`) zaman çizelgesi düzenlemelerini kapsar.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
