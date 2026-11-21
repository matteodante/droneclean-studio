import type { DocPageContent } from '../../docs-content'

const page = {
  order: 3,
  slug: 'projects',
  title: 'Projeler',
  description:
    'Projeleri oluşturun, yapılandırın, çoğaltın, düzenleyin, çöpe atın, geri yükleyin ve taşıyın.',
  category: 'Start',
  related: ['workspaces', 'editor'],
  sections: [
    {
      title: 'Proje oluşturma ve yapılandırma',
      blocks: [
        {
          kind: 'list',
          items: [
            'Projeler sayfasından **Yeni Proje** düğmesiyle bir proje oluşturun.',
            'Proje adını, açıklamasını, çözünürlüğünü, kare hızını ve arka plan rengini belirleyin.',
            'Çözünürlük ve kare hızı, dışa aktarma tuvalini ve zaman çizelgesinin zamanlamasını belirler; bu yüzden onları hedef teslimatınıza göre seçin.',
            'Proje özelliklerine daha sonra editör araç çubuğundan yeniden bakabilirsiniz.',
          ],
        },
      ],
    },
    {
      title: 'Tuval boyutu ve en boy oranı',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Tuval, videonuzun içinde oluşturulduğu ve dışa aktarıldığı kareyi belirler. Proje oluştururken bir boyut seçin ya da kurgu sırasında istediğiniz zaman **Tuval** panelinden değiştirin.',
        },
        {
          kind: 'paragraph',
          text: '**Yeni Proje** ekranında **Çözünürlük** bölümü, yaygın platformlar için hazır ön ayarlar sunar. Her ön ayar kartı piksel boyutunu ve en boy oranını gösterir. Tam bir genişlik ve yükseklik yazmak için **Özel** seçeneğini seçin.',
        },
        {
          kind: 'table',
          headers: ['Ön ayar', 'Çözünürlük', 'En boy oranı'],
          rows: [
            ['YouTube 1080p', '`1920x1080`', '`16:9` yatay'],
            ['Shorts / TikTok / Reels', '`1080x1920`', '`9:16` dikey'],
            ['Instagram Kare', '`1080x1080`', '`1:1` kare'],
            ['Instagram Portre', '`1080x1350`', '`4:5` portre'],
            ['Twitter/X', '`1200x675`', '`16:9` yatay'],
            ['LinkedIn', '`1200x627`', 'yatay'],
            ['Özel', 'Kendi değerleriniz', 'Girdiğiniz herhangi bir oran'],
          ],
        },
        {
          kind: 'paragraph',
          text: 'Proje oluşturulduktan sonra boyutu değiştirmek için:',
        },
        {
          kind: 'steps',
          items: [
            'Özellikler kenar çubuğunda **Tuval** panelinin görünmesi için hiçbir klibi seçili bırakmayın.',
            'Kare genişliğini ve yüksekliğini piksel olarak ayarlamak için **W** ve **H** alanlarını düzenleyin.',
            'Genişlik ile yüksekliği çevirmek için **Değiştir** düğmesini kullanın; örneğin yatay bir projeyi dikeye çevirebilirsiniz.',
            'Tuvali `1920x1080` değerine döndürmek için **Sıfırla** düğmesini kullanın.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Boyutlar çift sayılara yuvarlanır ve `320x240` ile `7680x4320` arasında olabilir. Tuval değiştiğinde mevcut klipler konumlarını ve ölçeklerini korur; bu yüzden yeni karenin dışında kalan her şeyi yeniden konumlandırın.',
        },
      ],
    },
    {
      title: 'Proje listesini düzenleme',
      blocks: [
        {
          kind: 'list',
          items: [
            'Projeleri ada göre arayın; liste büyüdükçe sıralayın veya süzün.',
            'En son üzerinde çalıştığınız projeyi fark etmek için küçük resimleri ve üst verileri kullanın.',
            'Etkin çalışma alanı Projeler sayfasında gösterilir; böylece projelerin nerede saklandığını her zaman bilirsiniz.',
            'Orijinale dokunmadan bir varyasyon oluşturmak için **Çoğalt** seçeneğini kullanın.',
          ],
        },
      ],
    },
    {
      title: 'Çöp kutusu ve geri yükleme',
      blocks: [
        {
          kind: 'list',
          items: [
            'Bir projeyi silmek onu hemen kaldırmaz, **Çöp Kutusu** içine taşır.',
            'Bir projeyi, çöp kutusunda durduğu sürece Çöp Kutusu bölümünden geri yükleyin.',
            '**Çöp kutusunu boşalt** seçeneği, çöpteki projeleri ve yalnızca onların başvurduğu medyayı kalıcı olarak siler.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Kalıcı silme geri alınamaz; bu yüzden çöp kutusunu boşaltmadan önce adı doğrulayın.',
        },
      ],
    },
    {
      title: 'Çalışmayı çalışma alanları arasında taşıma',
      blocks: [
        {
          kind: 'list',
          items: [
            'Projeyi medyasıyla birlikte paketleyen bir paket oluşturmak için **Projeyi Dışa Aktar** seçeneğini kullanın.',
            'Aynı kurguyu başka bir makinede ya da klasörde sürdürmek için paketi başka bir çalışma alanına içe aktarın.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Paketler, bir projeyi başkasına vermenin güvenli yoludur; çünkü bağlı medyayı zaman çizelgesiyle birlikte taşırlar.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
