import type { DocPageContent } from '../../docs-content'

const page = {
  order: 17,
  slug: 'local-ai',
  title: 'Yerel YZ Araçları',
  description:
    'Tarayıcı içinde metinden sese, müzik oluşturma ve transkripsiyon; yerel model önbelleğiyle.',
  category: 'Creative Tools',
  related: ['scene-browser', 'text-captions-subtitles', 'audio'],
  sections: [
    {
      title: 'Yerel YZ nasıl çalışır',
      blocks: [
        {
          kind: 'list',
          items: [
            'YZ araçları tarayıcınızda, kendi donanımınızı kullanarak çalışır; hiçbir şey sunucuya gönderilmez.',
            'Bir modeli ilk kullandığınızda bir kez indirilir ve sonra yeniden kullanım için yerel olarak önbelleğe alınır.',
            'Bir model çalışırken bir durum rozeti yükleniyor, etkin, hazır ve hata durumlarını gösterir.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Bazı araçlar Chrome veya Edge 113+ (ya da Safari 26+) ve WebGPU desteği gerektirir. İlk model indirmesi büyük olabilir.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Model lisansları bizi değil sizi bağlar: MusicGen ile üretilen müzik yalnızca ticari olmayan kullanım içindir (CC BY-NC 4.0) ve Supertonic konuşması, bazı kullanımları yasaklayan OpenRAIL-M lisansı altındadır. YZ sekmesi, üretmeden önce bunu belirtir.',
        },
      ],
    },
    {
      title: 'Metinden sese',
      blocks: [
        {
          kind: 'steps',
          items: [
            '**YZ** sekmesini açın ve **Metinden Sese** bölümünü genişletin, ardından metninizi yazın ya da yapıştırın.',
            'Bir motor seçin (tabloya bakın), ardından bir ses seçin ve desteklenen yerlerde hızı, dili ve ifade etiketlerini ayarlayın.',
            'Sonucu önizleyin, ardından bağlı sesi oynatma başlığına bırakmak için **Kaydet ve Ekle** seçeneğini ya da **Kitaplığa Kaydet** seçeneğini kullanın.',
          ],
        },
        {
          kind: 'table',
          headers: ['Motor', 'Diller', 'Çalıştığı yer'],
          rows: [
            ['Kokoro', 'İngilizce', 'WebGPU'],
            ['MOSS Nano', '20 dil', 'CPU'],
            ['Supertonic 3', '31 dil', 'Yerel ONNX'],
          ],
        },
      ],
    },
    {
      title: 'Müzik oluşturma',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Müzik Oluşturma** bölümünü genişletin ve parçayı bir istemle tarif edin ya da Lo-fi chill veya Upbeat EDM gibi bir ön ayardan başlayın.',
            'Uzunluğu saniye cinsinden belirleyin, ardından **Müzik Oluştur** düğmesine tıklayın; ilk çalıştırmada model indirilir ve önbelleğe alınır.',
            'Klibi önizleyin, ardından zaman çizelgesine **Kaydet ve Ekle** seçeneğini ya da **Kitaplığa Kaydet** seçeneğini kullanın.',
          ],
        },
      ],
    },
    {
      title: 'Transkripsiyon',
      blocks: [
        {
          kind: 'list',
          items: [
            'Transkripsiyon, YZ sekmesinden ayrı olarak Medya kitaplığında ve Transkript iş akışında yer alır.',
            '**Parakeet** hızlı varsayılan motordur ve birçok Avrupa dilini kapsar.',
            "Whisper modelleri (Tiny, Base, Small, Large v3 Turbo) de kullanılabilir ve gerektiğinde DroneClean Studio Whisper'a geri döner.",
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Transkript; altyazıları, transkript aramasını ve dolgu sözcüğü kaldırmayı besler. Bir tane erken oluşturun.',
        },
      ],
    },
    {
      title: 'Modelleri ve çalışma zamanlarını yönetme',
      blocks: [
        {
          kind: 'list',
          items: [
            "Yerel YZ'yi yönetmek için **Depolama** ayarlarını açın.",
            'İndirilen modelleri incelemek veya temizlemek için **Yerel YZ Model Önbelleği** bölümünü kullanın; bir indirme bozuksa işe yarar.',
            'Çalışma zamanlarını bırakıp belleği boşaltmak için **Yerel Modelleri Boşalt** seçeneğini kullanın.',
            'Sonuca artık ihtiyacınız yoksa uzun işler iptal edilebilir.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
