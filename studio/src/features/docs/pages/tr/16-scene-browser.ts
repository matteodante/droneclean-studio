import type { DocPageContent } from '../../docs-content'

const page = {
  order: 16,
  slug: 'scene-browser',
  title: 'Sahne Tarayıcı ve YZ Analizi',
  description:
    'Sahneleri altyazılamak için medyayı yerel olarak analiz edin, ardından anahtar sözcüğe, anlama veya renge göre arayın.',
  category: 'Creative Tools',
  related: ['media', 'local-ai', 'source-monitor'],
  sections: [
    {
      title: 'YZ ile analiz etme',
      blocks: [
        {
          kind: 'list',
          items: [
            "Medya kitaplığından bir klip için ya da Sahne Tarayıcı'nın **Analiz et** menüsünden **YZ ile analiz et** seçeneğini çalıştırın.",
            'İşlem tamamen sizin makinenizde çalışır: sahneleri algılar, her birini altyazılar, bir renk paleti çıkarır ve metin ile görüntü gömmeleri oluşturur.',
            'Altyazısı olmayan klipler için **Yeni medyayı analiz et** seçeneğini, her şeyi yenilemek için **Tümünü yeniden analiz et** seçeneğini seçin.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Sonuçlar içeriğe göre önbelleğe alınır; böylece aynı medya yeniden analiz edilmek yerine yeniden kullanılır.',
        },
      ],
    },
    {
      title: "Sahne Tarayıcı'yı açma",
      blocks: [
        {
          kind: 'list',
          items: [
            "Sahne Tarayıcı'yı medya kitaplığından ya da `Ctrl+Shift+F` ile açın.",
            'YZ ile analiz etme işleminin ürettiği YZ altyazılarında ve sahne verilerinde arama yapar.',
            'Kapsamı analiz edilmiş tüm medya veya tek bir klip olarak belirleyin; **Alaka düzeyi**, **Zaman damgası** veya **Medya adı** ile sıralayın.',
            'Gezinmeye ya da taramaya uygun olması için **Liste görünümü** ile **Izgara görünümü** arasında geçiş yapın.',
          ],
        },
      ],
    },
    {
      title: 'Arama modları',
      blocks: [
        {
          kind: 'table',
          headers: ['Mod', 'Eşleşme ölçütü'],
          rows: [
            [
              'Anahtar sözcük',
              'Bir altyazıdaki tam sözcükler; belirli bir nesne veya etiket için iyidir.',
            ],
            [
              'Anlamsal',
              'Anlam; bu yüzden "suyun üzerinde gün batımı" ilgili sahneleri bulur (ilk kullanımda küçük bir model indirilir, ~22 MB).',
            ],
            ['Renk', 'Benzer bir palet; kitaplık paletinden bir renk örneği seçin.'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Sonuçlar Güçlü, İyi veya Orta eşleşme rozetleri taşır ve eşleşmenin anahtar sözcük, anlam, görsel benzerlik ya da renkle olduğunu belirtir.',
        },
      ],
    },
    {
      title: 'Bir sonucu kullanma',
      blocks: [
        {
          kind: 'list',
          items: [
            'Bir sahneyi kaynak monitöründe önizlemek için tıklayın.',
            'O anı kurgunuza eklemek için bir sahneyi zaman çizelgesine sürükleyin.',
            'Hiçbir şey bulunamazsa klibin analiz edildiğinden emin olun; yalnızca analiz edilmiş medyada arama yapılabilir.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
