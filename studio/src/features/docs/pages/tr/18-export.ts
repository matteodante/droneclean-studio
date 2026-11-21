import type { DocPageContent } from '../../docs-content'

const page = {
  order: 18,
  slug: 'export',
  title: 'Dışa Aktarma',
  description:
    'Tarayıcıda video veya ses işleyin, biçimleri ve aralığı seçin ve ön kontrol uyarılarını giderin.',
  category: 'Output',
  related: ['render-queue', 'text-captions-subtitles', 'troubleshooting'],
  sections: [
    {
      title: 'Dışa aktarmayı ayarlama',
      blocks: [
        {
          kind: 'steps',
          items: [
            '**Dışa Aktar** bölümünü açın (`Ctrl+Shift+E`) ve **Videoyu dışa aktar** veya **Sesi dışa aktar** seçeneğini seçin.',
            'Tüm projeyi ya da yalnızca bir bölüme ihtiyacınız varsa geçerli giriş/çıkış aralığını işleyin.',
            'Amaca uygun olması için **Çözünürlük** ve **Kalite** ayarlarını yapın: hızlı bir inceleme, paylaşılabilir bir dosya ya da son bir ana kopya.',
            'Ön kontrol uyarılarını giderin, ardından işleyin.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Daha yüksek çözünürlük ve kalite daha uzun sürer ve daha büyük dosyalar üretir.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Bir projede Main zaman çizelgesinden fazlası varsa, iletişim kutusunun üstündeki **Sekans** menüsü hangi zaman çizelgesinin dışa aktarılacağını seçer; kendi çözünürlüğü ve aralığıyla.',
        },
      ],
    },
    {
      title: 'Biçimler',
      blocks: [
        {
          kind: 'table',
          headers: ['Çıktı', 'Biçimler'],
          rows: [
            ['Video kapsayıcıları', 'MP4, MOV, WebM, MKV'],
            ['Yalnızca ses', 'MP3, AAC, WAV'],
            ['Yumuşak alt yazı parçası', 'WebM, MKV'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: "Hangi codec'lerin kullanılabileceği tarayıcınıza bağlıdır; biri yoksa DroneClean Studio uyarır veya geri döner.",
        },
      ],
    },
    {
      title: 'Altyazılar',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Bir video dışa aktarmasında transkript olduğunda **Altyazılar** denetimi, altyazıların nasıl dahil edileceğini seçer. Seçenekler, seçtiğiniz kapsayıcıya göre uyum sağlar.',
        },
        {
          kind: 'table',
          headers: ['Mod', 'Ne yapar'],
          rows: [
            ['**Kapalı**', 'Dışa aktarılan videoda altyazı yoktur.'],
            ['**Göm**', 'Altyazılar kareye çizilir; böylece her oynatıcıda görünür.'],
            [
              '**.srt dosyası** (`.srt`)',
              'Temiz video ve onunla birlikte indirilen ayrı bir `.srt` altyazı dosyası.',
            ],
            [
              '**Gömülü parça**',
              'Kapsayıcının içinde taşınan, açılıp kapatılabilen yumuşak bir alt yazı parçası.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Gömülü parça seçeneği yalnızca `WebM` ve `MKV` için görünür. `MP4` ve `MOV` biçimlerinde gömmeyi ya da ayrı bir dosyayı seçin veya açılıp kapatılabilen bir parça için kapsayıcıyı değiştirin.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Bazı oynatıcılar alt yazı parçalarını varsayılan olarak gizler; bu yüzden izleyicilerin bunları etkinleştirmesi gerekebilir.',
        },
      ],
    },
    {
      title: 'Ön kontroller',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Ön kontrol işlemeden önce çalışır ve yaygın engelleri işaretler: boş bir aralık, eksik medya, kullanılamayan bir codec, worker dışa aktarma yedeği, büyük bir dosya veya uzun bir işleme.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Hızlı bir doğrulama için tam işlemeye girişmeden önce kısa bir giriş/çıkış aralığını dışa aktarın.',
        },
      ],
    },
    {
      title: 'İşleme ve indirme',
      blocks: [
        {
          kind: 'list',
          items: [
            'İlerleme hazırlama, işleme, kodlama ve sonlandırma aşamalarından geçer ve istediğiniz zaman **İptal** edebilirsiniz.',
            'Worker dışa aktarma, mümkün olduğunda arka planda çalışır; ana iş parçacığı yedeği, sekmenin odakta ve sakin olmasını ister.',
            'Tamamlandığında dosyayı kaydetmek için **İndir** seçeneğini seçin; dosya ayrıca çalışma alanınızdaki dışa aktarmalar klasörüne de yazılır.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Dışa aktarma bitene kadar proje sekmesini açık tutun. Birkaç işlemeyi toplu yapmak için tek tek dışa aktarmak yerine onları **Render kuyruğuna** ekleyin.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
