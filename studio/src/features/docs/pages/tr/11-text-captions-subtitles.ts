import type { DocPageContent } from '../../docs-content'

const page = {
  order: 11,
  slug: 'text-captions-subtitles',
  title: 'Metin, Altyazılar ve Alt Yazılar',
  description:
    'Metin kliplerini ekleyin ve biçimlendirin, transkriptten altyazı oluşturun ve gömülü alt yazı parçalarını içe aktarın.',
  category: 'Creative Tools',
  related: ['motion-library', 'motion', 'shapes-masks', 'properties', 'local-ai'],
  sections: [
    {
      title: 'Birbiriyle ilişkili üç şey',
      blocks: [
        {
          kind: 'table',
          headers: ['Tür', 'Nedir', 'Nereden başlar'],
          rows: [
            [
              'Metin klibi',
              'İçine yazı yazdığınız, bağımsız bir zaman çizelgesi öğesi',
              'Metin sekmesi',
            ],
            [
              'Altyazılar',
              'Bir video veya ses klibinin üzerinde yer alan, üretilmiş satırlar',
              'Bir klip transkripti',
            ],
            [
              'Alt yazılar',
              'Zaman çizelgesindeki bir ipucu parçası',
              'Gömülü bir parça veya birleştirilmiş altyazılar',
            ],
          ],
        },
      ],
    },
    {
      title: 'Metin klibi ekleme ve biçimlendirme',
      blocks: [
        {
          kind: 'steps',
          items: [
            '**Metin** sekmesini açın, ardından metni oynatma başlığına yerleştirmek için **Metin ekle** düğmesine ya da bir şablona tıklayın; bir şablonu zaman çizelgesine veya tuvale de sürükleyebilirsiniz.',
            'Bir düzen (**Tek**, **2 aralık**, **3 aralık**) ve Clean, Lower Third, Cinematic veya Neon gibi bir stil ön ayarı seçin.',
            '**Metin** bölümünde yazı tipini, boyutu (8–500 px), kalınlığı, rengi, arka planı, hizalamayı, aralığı, satır yüksekliğini, dolguyu ve yarıçapı ayarlayın.',
            '**Efektler** altında gölge veya çizgi ekleyin; metni **Metin animasyonu** altında canlandırın.',
          ],
        },
      ],
    },
    {
      title: 'Metin animasyonu',
      blocks: [
        {
          kind: 'paragraph',
          text: '**Metin animasyonu** bölümünde (metin özelliklerinde ya da seçili katmanın **Motion** kitaplığında) her karakter, sözcük veya satır bağımsız olarak canlandırılabilir. Metin animasyonu canlı ve prosedürel kalır; yönetmeniz gereken katman anahtar kareleri yoktur.',
        },
        {
          kind: 'steps',
          items: [
            'Bir metin klibi seçin ve **Metin animasyonu** bölümünü açın.',
            '**Giriş**, **Çıkış** veya **Döngü** satırından bir ön ayar seçin. **Giriş** klibin başında, **Çıkış** klibin sonunda oynar; **Döngü** ikisinin arasında sürekli çalışır.',
            'Kaldırmak için etkin ön ayara yeniden tıklayın (veya ✕ işaretine); her satırda tek bir ön ayar olur.',
            'Etkin ön ayarın altında beliren denetimleri ayarlayın.',
            "Motion'da, süresini değiştirmek için bir metin hareketi bandının kenarını sürükleyin ya da kaydırmak için bir Giriş veya Çıkış bandını klip kenarından uzağa sürükleyin.",
          ],
        },
        {
          kind: 'table',
          headers: ['Denetim', 'Ne yapar'],
          rows: [
            [
              'Uygulandığı yer',
              'Her ön ayarın canlandırdığı birim: Karakter, Sözcük, Satır veya Tüm klip.',
            ],
            ['Süre', 'Her birimin animasyonunun kare cinsinden uzunluğu.'],
            ['Kademe', 'Çağlayan etkisi için her birim arasındaki kare cinsinden gecikme.'],
            ['Sıra', 'Hangi birimin önce canlandığı: İleri, Geri, Ortadan dışa veya Rastgele.'],
            ['Yoğunluk', 'Efekt gücünü yüzde 0 ile 200 arasında ölçekler.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '**Uygulanan** listesi her canlı metin hareketi yuvasını gösterir. Oynatma başlığını zaman çizelgesindeki bandına taşımak için bir girdiyi seçin.',
        },
      ],
    },
    {
      title: 'Transkriptten altyazı',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Klip için Medya kitaplığından veya Transkript panelinden bir transkript oluşturun.',
            "Klip bağlam menüsünden **Altyazı oluştur** seçeneğini kullanın (ya da DroneClean Studio'nun transkript altyazılarını otomatik etkinleştirmesine izin verin).",
            'İpucu zamanlamasını ve metnini düzenleyin; **Altyazı** bölümünde bir stil ön ayarı seçin (Netflix, YouTube, Bold Yellow, Outlined, TikTok).',
            'Altyazı rengini, boyutunu, dikey konumunu ve isteğe bağlı bir arka planı ayarlayın.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Transkript altyazılarını bağımsız bir alt yazı bölümüne dönüştürmek için **Altyazıları segmente birleştir** seçeneğini kullanın.',
        },
      ],
    },
    {
      title: 'Gömülü ve içe aktarılan alt yazılar',
      blocks: [
        {
          kind: 'list',
          items: [
            'Bir dosyayı alt yazı parçaları için taramak üzere bir medya kartında **Gömülü altyazıları çıkar** seçeneğini kullanın.',
            "**Gömülü altyazılar** iletişim kutusunda bir parça seçin; her satır dilini, codec'ini ve ipucu sayısını gösterir.",
            'İpuçlarını zaman çizelgesine alt yazı bölümü olarak eklemek için parçayı ekleyin.',
            'Her ipucunun başlangıcını, bitişini ve metnini **Altyazı** bölümünde düzenleyin; tüm ipucu için İtalik, Kalın veya Altı çizili ayarlayın.',
          ],
        },
      ],
    },
    {
      title: 'Dışa aktarmada alt yazılar',
      blocks: [
        {
          kind: 'note',
          tone: 'info',
          text: 'Transkript altyazılarını alt yazı parçası olarak eklemek için dışa aktarma ayarlarında **Altyazıları göm** seçeneğini açın (MP4, MKV, WebM). Bazı oynatıcılar alt yazı parçalarını varsayılan olarak gizler; bu yüzden izleyicilerin bunları açması gerekebilir.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
