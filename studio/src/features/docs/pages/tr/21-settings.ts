import type { DocPageContent } from '../../docs-content'

const page = {
  order: 21,
  slug: 'settings',
  title: 'Ayarlar',
  description:
    'Genel, Zaman Çizelgesi, YZ, Depolama ve Gizlilik sekmeleri; ayrıca dilin ve kısayolların nerede ayarlandığı.',
  category: 'Reference',
  related: ['keyboard-shortcuts', 'workspaces'],
  sections: [
    {
      title: 'Sekmeler',
      blocks: [
        {
          kind: 'table',
          headers: ['Sekme', 'Neyi ayarlarsınız'],
          rows: [
            [
              'Genel',
              'Otomatik kaydetmenin açık/kapalı durumu ve aralığı (5–30 dk); geri alma geçmişi derinliği (10–200 adım); arayüz sesleri (açık/kapalı, ses düzeyi, ses teması).',
            ],
            [
              'Zaman Çizelgesi',
              'Varsayılan olarak yakalama; dalga biçimlerini ve film şeritlerini gösterme; içe aktarırken film şeritlerini çıkarma.',
            ],
            ['YZ', 'Altyazı örnekleme aralığı (saniye veya kare); varsayılan altyazı stili.'],
            [
              'Depolama',
              "Eksik proxy'leri oluşturma; proje önbelleğini temizleme; küçük resimleri yeniden oluşturma; proxy'leri silme; Yerel YZ'yi yönetme.",
            ],
            [
              'Gizlilik',
              'Çökme raporları ve anonim kullanım istatistikleri; her biri açık veya kapalı (siz izin verene kadar ikisi de kapalıdır); masaüstü uygulamasında ayrıca **Yeni sürümleri denetle** (varsayılan olarak açık).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Proje önbelleğini temizlemek yeniden üretilebilen verileri (dalga biçimleri, film şeritleri, GIF kareleri, çözülmüş ses) kaldırır; kaynak medyayı asla silmez. Varsayılanları geri yüklemek için iletişim kutusu başlığındaki **Sıfırla** düğmesini kullanın.',
        },
      ],
    },
    {
      title: 'Yeni sürümler',
      blocks: [
        {
          kind: 'paragraph',
          text: "Masaüstü uygulaması imzalı olmadığı için kendini güncelleyemez. Bunun yerine açılırken (günde en fazla bir kez) GitHub'dan en son sürümün numarasını ister ve daha yeni bir sürüm varsa **İndir** (o sürümün sayfasını tarayıcında açar) ve **Sonra** (yarına kadar gizler) düğmeleri olan küçük bir kart gösterir. Bir dışa aktarma işlenirken hiçbir şey görünmez. Bu, uygulamanın sen istemeden yaptığı tek istek; bu yüzden bir anahtarı var: **Ayarlar › Gizlilik › Yeni sürümleri denetle**, varsayılan olarak açık. GitHub IP adresini görür; seninle veya çalışmanla ilgili başka hiçbir şey gönderilmez ve anahtar kapalıyken hiçbir istek yapılmaz. Web editörü her zaman en son sürümdedir ve hiç denetleme yapmaz.",
        },
      ],
    },
    {
      title: 'Arayüz sesleri',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio, seçme, onaylama, açıp kapatma ve silme gibi eylemleri doğrulayan kısa, ince sentezlenmiş arayüz sesleri çalabilir. Bunlar **varsayılan olarak kapalıdır**, isteğe bağlıdır ve dışa aktarılan sesi asla etkilemez.',
        },
        {
          kind: 'steps',
          items: [
            '**Ayarlar** bölümünü açın ve **Genel** sekmesine gidin.',
            '**Arayüz sesleri** seçeneğini açın.',
            '**Ses düzeyi** ayarını zevkinize göre yapın (%0–100).',
            'Bir **Ses teması** seçin (**Signature**, **Velvet** veya **Crisp**) ve denemek için **Önizleme** düğmesini kullanın.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Önizleme oynatılırken sesler bastırılır; böylece dinlediğiniz sese karışmazlar. Dışa aktarmalar tasarım gereği sessizdir. Anahtarı açmak kısa bir onay sesi çalar.',
        },
      ],
    },
    {
      title: 'Çökme raporları ve kullanım istatistikleri',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio, siz izin vermedikçe sizin ya da çalışmanız hakkında hiçbir şey göndermez. İlk açılışta, sol alt köşedeki bir kartta **çökme raporları** ve **anonim kullanım istatistikleri** gönderilip gönderilmeyeceğini sorar; siz yanıtlayana kadar ve **İzin verme** seçeneğinden sonra hiçbir şey gönderilmez. Her ikisini de istediğiniz zaman **Ayarlar › Gizlilik** bölümünden değiştirin.',
        },
        {
          kind: 'table',
          headers: ['Rapor', 'Ne gönderilir', 'Nereye'],
          rows: [
            [
              'Çökme raporları',
              'Hata, editörün kodunda nerede olduğu, sürüm ve işletim sistemi. Yollar ve dosya adları, iletilerden çıkmadan önce kaldırılır.',
              "Sentry, AB'de",
            ],
            [
              'Kullanım istatistikleri',
              'Uygulamanın açıldığı, bir proje oluşturulduğu (boyutu ve kare hızı), bir dışa aktarmanın bittiği (biçimi, boyutu ve uzunluğu), bir YZ ajanının bağlandığı veya bir gölgenin kaldırıldığı (uzunluğu); bu kurulumun, istatistikleri kapattığınızda unutulan rastgele bir kimliği altında.',
              "PostHog, AB'de",
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Asla gönderilmeyenler: görüntüleriniz, kareler, dosya ve klasör adları, proje adları veya hesabınız. IP adresiniz saklanmaz. Masaüstü uygulaması yanıtınızı profil klasöründe, web editörü tarayıcınızda saklar.',
        },
      ],
    },
    {
      title: 'Klavye kısayollarını özelleştirme',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Klavye kısayolları tamamen özelleştirilebilir, ancak düzenleyici bu Ayarlar iletişim kutusu değil, araç çubuğundaki **Klavye Kısayolları** düğmesinden açılan kendi iletişim kutusudur. Etkileşimli bir ekran klavyesi, arama ve **Özel** / **Çakışmalar** / **Atanmamış** süzgeçleri, kaydederek yeniden atama, alternatif atamalar, komut başına ve **Tümünü Sıfırla** varsayılanları, çakışma algılama ve JSON ön ayarı **İçe Aktar** / **Dışa Aktar** özellikleri vardır.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Tam komut listesi ve adım adım yeniden atama anlatımı için **Klavye Kısayolları** sayfasına bakın.',
        },
      ],
    },
    {
      title: 'Başka yerde ayarlananlar',
      blocks: [
        {
          kind: 'list',
          items: [
            'Arayüz **dili** araç çubuğunda ayrı bir denetimdir, bu iletişim kutusunun parçası değildir; DroneClean Studio 10 dilde sunulur.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio şu anda tek bir koyu tema kullanır; tema seçici yoktur.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
