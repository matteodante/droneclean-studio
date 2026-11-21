import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15,
  slug: 'keyframes',
  title: 'Anahtar karelerle canlandırma',
  description:
    'Dönüşüm, kırpma, metin, efekt ve ses değerlerini anahtar kareler, yavaşlama eğrileri ve eğri düzenleyiciyle canlandırın.',
  category: 'Creative Tools',
  related: ['motion', 'motion-library', 'properties', 'effects-color'],
  sections: [
    {
      title: 'Anahtar karelerin nerede düzenleneceğini seçme',
      blocks: [
        {
          kind: 'paragraph',
          text: "Kurgu, anahtar kare çalışmasını derli toplu tutar. Motion ise daha derin zamanlama ve eğri çalışması için tam katman dope sheet'ini ve grafiği sunar.",
        },
        {
          kind: 'table',
          headers: ['Alan', 'Anahtar kare iş akışı'],
          rows: [
            [
              'Kurgu',
              "Bir klip seçin ve etkin özelliği için bir anahtar eklemek üzere `K` tuşuna basın. Ön ayarlar ve uygulanan durum için Özellikler'de **Animasyon** bölümünü açın.",
            ],
            [
              'Motion',
              'Özellik satırları, anahtar kare elmasları, bölüm yavaşlama eğrisi ve satır içi bir değer grafiği için bir katmanı genişletin.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: "Motion'da ortak oynatma başlığı, seçim, yakalama, cetvel, özellik şeritleri ve grafik aynı zaman eksenini kullanır.",
        },
      ],
    },
    {
      title: 'Anahtar kare ekleme',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Oynatma başlığını anahtar eklemek istediğiniz kareye getirin.',
            'Bir parametrenin yanına bir değer yazıp `Enter` tuşuna basın ya da parametre satırındaki **elmasa** tıklayın.',
            'Aralarında hareket oluşturmak için başka bir kareye gidin ve ikinci bir değer ayarlayın.',
            'Sonraki değer değişikliklerini otomatik yakalamak için zamanlayıcı simgesiyle **otomatik anahtarı** açın veya `A` tuşuna basın.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Bir geçiş bölgesinin içine ya da oynatma başlığı klip sınırlarının dışındayken anahtar kare ekleyemezsiniz; elmas orada devre dışıdır.',
        },
      ],
    },
    {
      title: 'Nelerin canlandırılabileceği',
      blocks: [
        {
          kind: 'table',
          headers: ['Klip türü', 'Canlandırılabilir değerler'],
          rows: [
            [
              'Tüm görsel klipler',
              'X / Y konumu, genişlik, yükseklik, döndürme, opaklık, köşe yarıçapı',
            ],
            ['Video', 'Çapa noktası, dört kırpma kenarı, kırpma yumuşaklığı ve ses düzeyi eklenir'],
            [
              'Metin',
              'Ön ayar ölçeği, yazı tipi boyutu, satır yüksekliği, dolgu, arka plan yarıçapı, gölge ve çizgi eklenir',
            ],
            ['Ses', 'Desibel cinsinden ses düzeyi'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Efektler de kendi canlandırılabilir parametrelerini getirir; her kaydırıcının yanındaki anahtar kare düğmesine bakın.',
        },
      ],
    },
    {
      title: 'Hareketi şekillendirme',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Yavaşlama düzenleyicisini** açmak için iki anahtar kare arasındaki **bağlantıya** tıklayın.',
            'Hazır eğrilere **Kübik** ve **Yay** altından göz atın. **Tümü**, **Giriş**, **Çıkış** veya **Giriş/Çıkış** ile süzün.',
            'Önceki değeri bir sonraki anahtara kadar korumak için **Tut** seçeneğini seçin.',
            'Eğriyi doğrudan şekillendirmek için **Düzenle** seçeneğine geçin: grafikteki iki denetim tutamacını sürükleyin ya da tam değerleri yazın. Yaylar **gerilim**, **sürtünme** ve **kütle** ayarlarını sunar ve gerçek sekmelerini önizler.',
            'Zamanlamayı canlı önizlemede **Konum**, **Ölçek**, **Rotate** veya **Opaklık** üzerinde hissedin ve döngüyü **Duraklat** ile durdurun.',
            'İnce ayar yapılmış bir eğriyi **Save As** ile **özel ön ayar** olarak kaydedin, sonra **Update** ile güncelleyin ya da geldiği ön ayara **Sıfırla** ile dönün. Özel ön ayarlar cihazınızda saklanır ve her projede görünür.',
            'Anahtar kareleri kopyalayın, kesin, yapıştırın ve silin; grupları çerçeveyle seçin, yeniden zamanlamak için sürükleyin, çoğaltmak için `Alt` tuşuyla sürükleyin.',
          ],
        },
      ],
    },
    {
      title: 'Değer grafiğinde çalışma',
      blocks: [
        {
          kind: 'list',
          items: [
            'Eğrisini düzenlemek için açılır listeden bir özellik seçin ya da diğerlerini soluk bindirme eğrileri olarak görmek için tümünde bırakın. Etkin özelliğin anahtar kare sayısı yanında gösterilir.',
            'Grafik, etiketli bir **ızgara** çizer (kareler veya saniyeler yatayda, değerler dikeyde); böylece konumları bir bakışta okuyabilirsiniz.',
            'Eğriyi **Fit to content** ile çerçeveleyin ya da görünümü **Yakınlaştır** / **Uzaklaştır** ve fare tekerleğiyle kaydırın. **Reset view** varsayılan sığdırmaya döner.',
            '**Önceki** / **sonraki** oklarla anahtarlar arasında ilerleyin, ardından seçili anahtar kare için tam bir kare (**F**) ve değer (**V**) yazın.',
            'Bir anahtar kareyi sürüklerken tek eksene kilitlemek için **Shift**, ince ayar için **Alt** tuşunu basılı tutun.',
          ],
        },
      ],
    },
    {
      title: 'Üretilmiş hareketi dönüştürme ve temizleme',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Kayma, nefes, sarsıntı ve dönüş gibi canlı davranışlar, özellik anahtarları oluşturmadan oynatma sırasında hesaplanır.',
        },
        {
          kind: 'list',
          items: [
            'Canlı katman davranışlarını düzenlenebilir anahtarlara dönüştürmek için **Anahtar karelere pişir** seçeneğini seçin.',
            'Elle eklenen anahtarlara veya üretilmiş bir ön ayarın ilk karesine gitmek için **Uygulanan** bölümünü kullanın.',
            'Bir klip kırpması, saklanan anahtarları görünür süresinin dışında bıraktığında **Animasyonu kırp** seçeneğini kullanın.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ön ayarlar, canlı davranışlar, metin hareketi, pişirme ve kayıtlı animasyonlar için [Hareketi uygulama ve yeniden kullanma](motion-library) sayfasını okuyun.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
