import type { DocPageContent } from '../../docs-content'

const page = {
  order: 22,
  slug: 'troubleshooting',
  title: 'Sorun Giderme',
  description:
    'Tarayıcı, çalışma alanı, medya, WebGPU, yerel YZ ve dışa aktarma sorunları için çözümler.',
  category: 'Reference',
  related: ['workspaces', 'export'],
  sections: [
    {
      title: 'Tarayıcı ve çalışma alanı',
      blocks: [
        {
          kind: 'table',
          headers: ['Belirti', 'Çözüm'],
          rows: [
            [
              'Desteklenmeyen tarayıcı ya da çalışma alanı seçici yok',
              "DroneClean Studio'nun ihtiyaç duyduğu API'leri destekleyen Chrome veya Edge 113+ kullanın.",
            ],
            [
              'Brave klasör seçemiyor',
              "`brave://flags/#file-system-access-api` bayrağını etkinleştirin ve Brave'i yeniden başlatın.",
            ],
            [
              'İzin reddedildi',
              'Düzenleyebileceğiniz sıradan bir klasör seçin, ardından okuma ve yazma erişimine izin verin.',
            ],
            [
              'Yeniden açıldığında yeniden bağlanmanız isteniyor',
              'Aynı klasör için **Yeniden bağlan** seçeneğini seçin; klasör taşındıysa başka bir klasör seçin.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Medya ve içe aktarma',
      blocks: [
        {
          kind: 'table',
          headers: ['Belirti', 'Çözüm'],
          rows: [
            [
              'Eksik medya',
              '**Erişim ver**, **Bul**, **Klasörü bul** veya **Başka klasöre göz at** ile yeniden bağlayın.',
            ],
            [
              'İçe aktarma başarısız oldu ya da codec desteklenmiyor',
              'Tarayıcının desteklediği başka bir biçim deneyin ya da dosyayı önce dönüştürün.',
            ],
            [
              "URL'den içe aktarma başarısız",
              'Bağlantının, medyayı gömen bir sayfaya değil, medya dosyasının kendisine işaret ettiğinden emin olun.',
            ],
            [
              'Eski önizlemeler veya dalga biçimleri',
              "Küçük resimleri veya proxy'leri yeniden oluşturun ya da Depolama ayarlarında proje önbelleğini temizleyin.",
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: '**Çevrimdışı çalış** seçeneğini yalnızca dosyaları sonra yeniden bağlamak istiyorsanız kullanın; o zamana kadar klipler bozuk referans olarak kalır.',
        },
      ],
    },
    {
      title: 'WebGPU ve yerel YZ',
      blocks: [
        {
          kind: 'table',
          headers: ['Belirti', 'Çözüm'],
          rows: [
            [
              'Efektler, kapsamlar veya YZ kullanılamıyor',
              'WebGPU kapalı olabilir; güncel Chrome veya Edge kullanın, GPU sürücülerini güncelleyin ve donanım hızlandırmayı açık tutun.',
            ],
            [
              'Bir model indirmesi yavaş ya da başarısız',
              'Sekmeyi açık tutun, kararlı bir bağlantıda yeniden deneyin ve bir indirme bozuksa **Yerel YZ Model Önbelleğini** temizleyin.',
            ],
            [
              'YZ çalışması sırasında bellek yetersiz',
              'Çalışma zamanlarını bırakmak için **Yerel Modelleri Boşalt** seçeneğini kullanın.',
            ],
            [
              'LUT içe aktarma engellendi',
              'LUT (.cube) içe aktarma, Chromium tabanlı bir tarayıcı gerektirir.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Dışa aktarma',
      blocks: [
        {
          kind: 'table',
          headers: ['Belirti', 'Çözüm'],
          rows: [
            [
              'Ön kontrolde codec kullanılamıyor',
              'Başka bir codec veya biçim seçin ya da çözünürlüğü veya kaliteyi düşürün.',
            ],
            [
              'Worker dışa aktarma kullanılamıyor',
              'Sekmeyi odakta tutun ve yoğun etkileşimden kaçının; animasyonlu görüntü öğelerini video kliplerle değiştirmek yardımcı olabilir.',
            ],
            [
              'Büyük veya yavaş dışa aktarma',
              'Daha kısa bir giriş/çıkış aralığı dışa aktarın, çözünürlüğü veya kaliteyi düşürün ve önce disk alanı açın.',
            ],
            [
              'Dışa aktarma başlamıyor',
              'Engelleyici ön kontrol uyarılarını giderin, ardından işlem hattının çalıştığını doğrulamak için kısa bir aralık deneyin.',
            ],
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
