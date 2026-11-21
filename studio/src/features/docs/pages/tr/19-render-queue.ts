import type { DocPageContent } from '../../docs-content'

const page = {
  order: 19,
  slug: 'render-queue',
  title: 'Render Kuyruğu',
  description:
    'Birden çok dışa aktarmayı sıraya alın, bir işlemeyi bölümlere ayırın, kuyruğu yönetin ve kayıtlı dosyaları bulun.',
  category: 'Output',
  related: ['export'],
  sections: [
    {
      title: 'Dışa aktarmaları sıraya alma',
      blocks: [
        {
          kind: 'list',
          items: [
            'Dışa Aktar iletişim kutusundan hemen işlemek yerine **Kuyruğa ekle** seçeneğini seçin.',
            'Tüm projeyi ya da geçerli aralığı sıraya alın.',
            'Kuyruğu istediğiniz zaman, canlı bir iş sayısı gösteren araç çubuğundaki **Render kuyruğu** düğmesinden açın.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Sıradaki dışa aktarmalar tek tek işlenir ve çalışma alanınızdaki dışa aktarmalar klasörüne kaydedilir.',
        },
      ],
    },
    {
      title: 'Bölümlere ayırma',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Bölümlere ayır**, tek bir işlemeyi birkaç işe dönüştürür.',
            'İşlemeyi zaman çizelgesi işaretçilerinizde bölmek için **İşaretçi başına bir bölüm** seçeneğini kullanın.',
            'Ya da belirli bir saniye sayısındaki sabit parçalara bölün.',
          ],
        },
      ],
    },
    {
      title: 'Kuyruğu yönetme',
      blocks: [
        {
          kind: 'list',
          items: [
            'İşlemenin ne zaman yapılacağını denetlemek için kuyruğu **Duraklat** ve **Sürdür** seçenekleriyle yönetin.',
            'Sıradaki bir işin sırasını değiştirmek için onu **Yukarı** veya **Aşağı** taşıyın.',
            'Çalışan ya da sıradaki bir işi **İptal** edin, başarısız olanı **Yeniden dene** ve biten işleri **Kaldır**.',
            'İş durumu Sırada, İşleniyor, Bitti, Başarısız veya İptal edildi olarak görünür; düzenlemek için **Bitenleri temizle** veya **Tümünü temizle** seçeneğini kullanın.',
          ],
        },
      ],
    },
    {
      title: 'Kayıtlı dışa aktarmalar',
      blocks: [
        {
          kind: 'list',
          items: [
            'Tamamlanan dosyaları görmek için **Kaydedilenler** sekmesine geçin.',
            'Buradan bir kayıtlı dışa aktarmayı indirin veya silin.',
            'Dosyalar, çalışma alanınızın içindeki bu proje klasöründe durur.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
